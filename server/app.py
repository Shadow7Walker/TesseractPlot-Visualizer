from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import numpy as np
import socket
import asyncio
import json

app = FastAPI()

# Mount the static directory for the Web UI
app.mount("/static", StaticFiles(directory="static"), name="static")

# ESP32 IP configuration (Can be updated via UI or hardcoded)
ESP32_IP = "192.168.1.100" # Change to actual IP
ESP32_PORT = 12345
CUBE_SIZE = 16

class PlotConfig(BaseModel):
    equation: str
    esp32_ip: str

# Global state
current_voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
current_equation = "sin(sqrt(x**2 + y**2))"
stream_to_hardware = False
t = 0.0

def calculate_plot(equations_str: str, current_t: float):
    """
    Evaluates one or multiple comma-separated mathematical equations.
    e.g. "sin(x) + cos(y) - t", "cos(x*y) + t"
    Returns a 16x16x16 RGB array containing overlayed plots.
    """
    voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
    
    # Safe eval setup
    allowed_names = {
        "x": None, "y": None, 
        "sin": np.sin, "cos": np.cos, "tan": np.tan, "sqrt": np.sqrt,
        "exp": np.exp, "abs": np.abs, "pi": np.pi, "e": np.e, "t": current_t
    }
    
    # Scale x, y from -pi to pi
    x = np.linspace(-np.pi, np.pi, CUBE_SIZE)
    y = np.linspace(-np.pi, np.pi, CUBE_SIZE)
    X, Y = np.meshgrid(x, y)
    
    allowed_names["x"] = X
    allowed_names["y"] = Y
    
    # Split by comma
    equations = [eq.strip() for eq in equations_str.split(',') if eq.strip()]
    
    colors = [
        (255, 60, 60),   # Red-ish
        (60, 255, 60),   # Green-ish
        (60, 60, 255),   # Blue-ish
        (255, 255, 60),  # Yellow
        (255, 60, 255)   # Magenta
    ]
    
    for idx, eq in enumerate(equations):
        try:
            # Evaluate Z
            Z = eval(eq, {"__builtins__": {}}, allowed_names)
            
            # Normalize Z to 0-15
            if np.max(Z) != np.min(Z):
                Z_norm = (Z - np.min(Z)) / (np.max(Z) - np.min(Z)) * (CUBE_SIZE - 1)
            else:
                Z_norm = np.zeros_like(Z) + CUBE_SIZE // 2
                
            Z_indices = np.round(Z_norm).astype(int)
            base_color = colors[idx % len(colors)]
            
            # Fill voxels 
            for i in range(CUBE_SIZE):
                for j in range(CUBE_SIZE):
                    z_idx = Z_indices[i, j]
                    if 0 <= z_idx < CUBE_SIZE:
                        # Adding depth shading to base color
                        r = int(base_color[0] * (0.4 + 0.6 * (z_idx / 15.0)))
                        g = int(base_color[1] * (0.4 + 0.6 * (z_idx / 15.0)))
                        b = int(base_color[2] * (0.4 + 0.6 * (z_idx / 15.0)))
                        voxels[i, j, z_idx] = [r, g, b]
                        
        except Exception as e:
            print(f"Error evaluating equation '{eq}': {e}")
            
    return voxels

def send_frame_to_esp32(voxels: np.ndarray, ip: str, port: int):
    """
    Sends the 16x16x16 voxel array to the ESP32 via UDP.
    Splits the data into 16 packets. To match physical vertical tubes, 
    each packet contains one X-plane (16 tubes of 16 LEDs).
    We assume the 16 tubes on a single ESP32 pin are wired in a Z-axis zig-zag.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    for x in range(CUBE_SIZE):
        packet_data = bytearray()
        packet_data.append(x) # chunk index (0 to 15), sent to a single ESP32 pin
        
        for y in range(CUBE_SIZE):
            # Zig-zag wiring on the Z axis:
            # Even Y rows go bottom-to-top (0 to 15), odd Y rows go top-to-bottom (15 to 0)
            z_range = range(CUBE_SIZE) if y % 2 == 0 else range(CUBE_SIZE - 1, -1, -1)
            
            for z in z_range:
                voxel = voxels[x, y, z]
                packet_data.extend(voxel)
                
        sock.sendto(packet_data, (ip, port))

@app.post("/api/update_plot")
async def update_plot(config: PlotConfig):
    global current_equation, ESP32_IP, t
    ESP32_IP = config.esp32_ip
    current_equation = config.equation
    t = 0.0
    return {"status": "success", "message": "Plot updated"}

@app.post("/api/toggle_stream")
async def toggle_stream(data: dict):
    global stream_to_hardware
    stream_to_hardware = data.get("stream", False)
    return {"status": "success", "streaming": stream_to_hardware}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Send current voxel state to UI at ~30fps
            flat_voxels = current_voxels.flatten().tolist()
            await websocket.send_text(json.dumps({"voxels": flat_voxels}))
            await asyncio.sleep(1/30.0)
    except Exception as e:
        print(f"WebSocket Client disconnected: {e}")

# Background task for rendering animations and UDP streaming
async def stream_task():
    global current_voxels, t, current_equation
    while True:
        # Step forward in time and generate the new 3D frame
        t += 0.05
        current_voxels = calculate_plot(current_equation, t)
        
        if stream_to_hardware:
            send_frame_to_esp32(current_voxels, ESP32_IP, ESP32_PORT)
            
        # Run rendering loop at roughly ~30fps 
        await asyncio.sleep(1/30.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(stream_task())
