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
    equations: list[str]
    esp32_ip: str

# Global state
current_voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
current_equations = ["z = 4 * sin(sqrt(x**2 + y**2) - t * 2)"]
stream_to_hardware = False
t = 0.0
is_playing = True
playback_speed = 1.0

class TimeConfig(BaseModel):
    t_val: float = None
    is_playing: bool = None
    playback_speed: float = None

def calculate_plot(equations: list[str], current_t: float):
    """
    Evaluates one or multiple mathematical equations.
    Supports explicit z=, y=, x= definitions, as well as implicit inequalities.
    """
    voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
    
    coord_min, coord_max = -5.0, 5.0
    coord_range = coord_max - coord_min
    ls = np.linspace(coord_min, coord_max, CUBE_SIZE)
    
    # 3D Grid
    X3, Y3, Z3 = np.meshgrid(ls, ls, ls, indexing='ij')
    allowed_3d = {
        "x": X3, "y": Y3, "z": Z3,
        "sin": np.sin, "cos": np.cos, "tan": np.tan, "sqrt": np.sqrt,
        "exp": np.exp, "abs": np.abs, "pi": np.pi, "e": np.e, "t": current_t
    }
    
    # 2D Grid
    X_2d, Y_2d = np.meshgrid(ls, ls, indexing='ij')
    
    colors = [
        (255, 60, 60),   # Red-ish
        (60, 255, 60),   # Green-ish
        (60, 60, 255),   # Blue-ish
        (255, 255, 60),  # Yellow
        (255, 60, 255)   # Magenta
    ]
    
    def clean_eq(e):
        return e.replace('^', '**')

    for idx, eq in enumerate(equations):
        try:
            eq = clean_eq(eq).strip()
            if not eq: continue
            
            mask = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), dtype=bool)

            # Explicit z = ...
            if eq.startswith("z=") or eq.startswith("z ="):
                rhs = eq.split("=", 1)[1]
                env = dict(allowed_3d, x=X_2d, y=Y_2d, z=None)
                Z_val = eval(rhs, {"__builtins__": {}}, env)
                if np.isscalar(Z_val):
                    Z_val = np.full_like(X_2d, Z_val)
                z_idx = np.round((Z_val - coord_min) / coord_range * (CUBE_SIZE - 1)).astype(int)
                for i in range(CUBE_SIZE):
                    for j in range(CUBE_SIZE):
                        if 0 <= z_idx[i, j] < CUBE_SIZE:
                            mask[i, j, z_idx[i, j]] = True

            # Explicit y = ...
            elif eq.startswith("y=") or eq.startswith("y ="):
                rhs = eq.split("=", 1)[1]
                env = dict(allowed_3d, x=X_2d, z=Y_2d, y=None)
                Y_val = eval(rhs, {"__builtins__": {}}, env)
                if np.isscalar(Y_val):
                    Y_val = np.full_like(X_2d, Y_val)
                y_idx = np.round((Y_val - coord_min) / coord_range * (CUBE_SIZE - 1)).astype(int)
                for i in range(CUBE_SIZE):
                    for k in range(CUBE_SIZE):
                        if 0 <= y_idx[i, k] < CUBE_SIZE:
                            mask[i, y_idx[i, k], k] = True

            # Explicit x = ...
            elif eq.startswith("x=") or eq.startswith("x ="):
                rhs = eq.split("=", 1)[1]
                env = dict(allowed_3d, y=X_2d, z=Y_2d, x=None)
                X_val = eval(rhs, {"__builtins__": {}}, env)
                if np.isscalar(X_val):
                    X_val = np.full_like(X_2d, X_val)
                x_idx = np.round((X_val - coord_min) / coord_range * (CUBE_SIZE - 1)).astype(int)
                for j in range(CUBE_SIZE):
                    for k in range(CUBE_SIZE):
                        if 0 <= x_idx[j, k] < CUBE_SIZE:
                            mask[x_idx[j, k], j, k] = True

            # Inequalities (3D evaluation)
            elif any(op in eq for op in ['<', '>', '<=', '>=']):
                mask_val = eval(eq, {"__builtins__": {}}, allowed_3d)
                if np.isscalar(mask_val):
                    if mask_val: mask = np.ones_like(mask)
                else:
                    mask = mask_val

            # Implicit equality
            elif '=' in eq:
                lhs, rhs = eq.split('=', 1)
                val = eval(f"abs(({lhs}) - ({rhs}))", {"__builtins__": {}}, allowed_3d)
                if np.isscalar(val):
                    val = np.full_like(mask, val, dtype=float)
                mask = val < 0.8 # default implicit thickness
            
            # Fallback (Auto-assume explicit z)
            else:
                rhs = eq
                env = dict(allowed_3d, x=X_2d, y=Y_2d, z=None)
                Z_val = eval(rhs, {"__builtins__": {}}, env)
                if np.isscalar(Z_val):
                    Z_val = np.full_like(X_2d, Z_val)
                z_idx = np.round((Z_val - coord_min) / coord_range * (CUBE_SIZE - 1)).astype(int)
                for i in range(CUBE_SIZE):
                    for j in range(CUBE_SIZE):
                        if 0 <= z_idx[i, j] < CUBE_SIZE:
                            mask[i, j, z_idx[i, j]] = True

            # Apply colors based on mask
            base_color = colors[idx % len(colors)]
            for i in range(CUBE_SIZE):
                for j in range(CUBE_SIZE):
                    for k in range(CUBE_SIZE):
                        if mask[i, j, k]:
                            r = int(base_color[0] * (0.4 + 0.6 * (k / 15.0)))
                            g = int(base_color[1] * (0.4 + 0.6 * (k / 15.0)))
                            b = int(base_color[2] * (0.4 + 0.6 * (k / 15.0)))
                            voxels[i, j, k] = [r, g, b]

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
    global current_equations, ESP32_IP, t
    ESP32_IP = config.esp32_ip
    current_equations = config.equations
    return {"status": "success", "message": "Plot updated"}

@app.post("/api/update_time")
async def update_time(config: TimeConfig):
    global t, is_playing, playback_speed
    if config.t_val is not None:
        t = config.t_val
    if config.is_playing is not None:
        is_playing = config.is_playing
    if config.playback_speed is not None:
        playback_speed = config.playback_speed
    return {"status": "success", "t": t, "is_playing": is_playing, "speed": playback_speed}

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
    global current_voxels, t, current_equations
    while True:
        if is_playing:
            t += (0.05 * playback_speed)
            
        current_voxels = calculate_plot(current_equations, t)
        
        if stream_to_hardware:
            send_frame_to_esp32(current_voxels, ESP32_IP, ESP32_PORT)
            
        # Run rendering loop at roughly ~30fps 
        await asyncio.sleep(1/30.0)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(stream_task())
