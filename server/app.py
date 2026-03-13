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
stream_to_hardware = False

def calculate_plot(equation: str):
    """
    Evaluates a mathematical equation like z = sin(x) + cos(y)
    Returns a 16x16x16 RGB array.
    """
    voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
    
    # Safe eval setup
    allowed_names = {
        "x": None, "y": None, 
        "sin": np.sin, "cos": np.cos, "tan": np.tan, "sqrt": np.sqrt,
        "exp": np.exp, "abs": np.abs, "pi": np.pi, "e": np.e
    }
    
    try:
        # Scale x, y from -pi to pi for nicer plots
        x = np.linspace(-np.pi, np.pi, CUBE_SIZE)
        y = np.linspace(-np.pi, np.pi, CUBE_SIZE)
        X, Y = np.meshgrid(x, y)
        
        allowed_names["x"] = X
        allowed_names["y"] = Y
        
        # Evaluate Z
        Z = eval(equation, {"__builtins__": {}}, allowed_names)
        
        # Normalize Z to 0-15
        if np.max(Z) != np.min(Z):
            Z_norm = (Z - np.min(Z)) / (np.max(Z) - np.min(Z)) * (CUBE_SIZE - 1)
        else:
            Z_norm = np.zeros_like(Z) + CUBE_SIZE // 2
            
        Z_indices = np.round(Z_norm).astype(int)
        
        # Fill voxels (Simple gradient coloring based on Z height)
        for i in range(CUBE_SIZE):
            for j in range(CUBE_SIZE):
                z_idx = Z_indices[i, j]
                if 0 <= z_idx < CUBE_SIZE:
                    # R, G, B based on coordinate position for a cool effect
                    r = int((i / 15.0) * 255)
                    g = int((j / 15.0) * 255)
                    b = int((z_idx / 15.0) * 255)
                    voxels[i, j, z_idx] = [r, g, b]
                    
        return voxels
    except Exception as e:
        print(f"Error evaluating equation: {e}")
        return np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)

def send_frame_to_esp32(voxels: np.ndarray, ip: str, port: int):
    """
    Sends the 16x16x16 voxel array to the ESP32 via UDP.
    Splits the data into 16 packets (one per Z-layer) as per our C++ struct:
    struct { uint8_t layerIndex; uint8_t rgbData[768]; }
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    for z in range(CUBE_SIZE):
        layer_data = bytearray()
        layer_data.append(z) # layer index
        
        # Flatten the 16x16 plane for this layer
        for y in range(CUBE_SIZE):
            for x in range(CUBE_SIZE):
                voxel = voxels[x, y, z]
                layer_data.extend(voxel)
                
        sock.sendto(layer_data, (ip, port))

@app.post("/api/update_plot")
async def update_plot(config: PlotConfig):
    global current_voxels, ESP32_IP
    ESP32_IP = config.esp32_ip
    current_voxels = calculate_plot(config.equation)
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

# Background task for UDP streaming to avoid blocking the API
async def stream_task():
    while True:
        if stream_to_hardware:
            send_frame_to_esp32(current_voxels, ESP32_IP, ESP32_PORT)
            # Send at roughly ~30fps 
            await asyncio.sleep(1/30.0)
        else:
            await asyncio.sleep(0.1)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(stream_task())
