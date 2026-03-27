from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import numpy as np
import socket
import asyncio
from contextlib import asynccontextmanager
import ast

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create the streaming task
    task = asyncio.create_task(stream_task())
    yield
    # Shutdown: Cancel the task
    task.cancel()

app = FastAPI(lifespan=lifespan)

# Mount the static directory for the Web UI
app.mount("/static", StaticFiles(directory="static"), name="static")

# ESP32 IP configuration (Can be updated via UI or hardcoded)
ESP32_IP = "192.168.1.100" # Change to actual IP
ESP32_PORT = 12345
CUBE_SIZE = 8

class PlotConfig(BaseModel):
    equations: list[str]
    colors: list[str]
    esp32_ip: str

# Global state
current_voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
current_equations = ["z = 4 * sin(sqrt(x**2 + y**2) - t * 2)"]
current_colors = ["#ff3c3c"]
stream_to_hardware = False
t = 0.0
is_playing = True
playback_speed = 1.0

# Pre-compute static geometry grids to save CPU during rapid frame calculations
COORD_MIN, COORD_MAX = 0.0, 5.0
COORD_RANGE = COORD_MAX - COORD_MIN
ls = np.linspace(COORD_MIN, COORD_MAX, CUBE_SIZE)
X3, Y3, Z3 = np.meshgrid(ls, ls, ls, indexing='ij')
X_2d, Y_2d = np.meshgrid(ls, ls, indexing='ij')

# Indices maps for explicitly targeting mask planes
I_IDX, J_IDX = np.indices((CUBE_SIZE, CUBE_SIZE))

class TimeConfig(BaseModel):
    t_val: float = None
    is_playing: bool = None
    playback_speed: float = None

class RewriteLogic(ast.NodeTransformer):
    def visit_BoolOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, ast.And):
            result = node.values[0]
            for val in node.values[1:]:
                result = ast.BinOp(left=result, op=ast.BitAnd(), right=val)
            return result
        elif isinstance(node.op, ast.Or):
            result = node.values[0]
            for val in node.values[1:]:
                result = ast.BinOp(left=result, op=ast.BitOr(), right=val)
            return result
        return node

def numpy_safe_eval(eq_str, env):
    try:
        tree = ast.parse(str(eq_str).strip(), mode='eval')
        tree = RewriteLogic().visit(tree)
        ast.fix_missing_locations(tree)
        compiled = compile(tree, filename='<ast>', mode='eval')
        return eval(compiled, {"__builtins__": {}}, env)
    except Exception as e:
        raise ValueError(f"Evaluation failed: {e}")

def calculate_plot(equations: list[str], hex_colors: list[str], current_t: float):
    """
    Evaluates one or multiple mathematical equations.
    Supports explicit z=, y=, x= definitions, as well as implicit inequalities.
    """
    voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
    
    allowed_3d = {
        "x": X3, "y": Y3, "z": Z3,
        "sin": np.sin, "cos": np.cos, "tan": np.tan, "sqrt": np.sqrt,
        "exp": np.exp, "abs": np.abs, "pi": np.pi, "e": np.e, "t": current_t,
        "clip": np.clip
    }
    
    parsed_colors = []
    for hex_c in hex_colors:
        h = hex_c.lstrip('#')
        # fallback to red if parsing fails
        if len(h) != 6: parsed_colors.append((255, 60, 60))
        else: parsed_colors.append(tuple(int(h[i:i+2], 16) for i in (0, 2, 4)))
        
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
                Z_val = numpy_safe_eval(rhs, env)
                if np.isscalar(Z_val): Z_val = np.full_like(X_2d, Z_val)
                z_idx = np.round((Z_val - COORD_MIN) / COORD_RANGE * (CUBE_SIZE - 1)).astype(int)
                valid = (z_idx >= 0) & (z_idx < CUBE_SIZE)
                mask[I_IDX[valid], J_IDX[valid], z_idx[valid]] = True

            # Explicit y = ...
            elif eq.startswith("y=") or eq.startswith("y ="):
                rhs = eq.split("=", 1)[1]
                env = dict(allowed_3d, x=X_2d, z=Y_2d, y=None)
                Y_val = numpy_safe_eval(rhs, env)
                if np.isscalar(Y_val): Y_val = np.full_like(X_2d, Y_val)
                y_idx = np.round((Y_val - COORD_MIN) / COORD_RANGE * (CUBE_SIZE - 1)).astype(int)
                valid = (y_idx >= 0) & (y_idx < CUBE_SIZE)
                mask[I_IDX[valid], y_idx[valid], J_IDX[valid]] = True

            # Explicit x = ...
            elif eq.startswith("x=") or eq.startswith("x ="):
                rhs = eq.split("=", 1)[1]
                env = dict(allowed_3d, y=X_2d, z=Y_2d, x=None)
                X_val = numpy_safe_eval(rhs, env)
                if np.isscalar(X_val): X_val = np.full_like(X_2d, X_val)
                x_idx = np.round((X_val - COORD_MIN) / COORD_RANGE * (CUBE_SIZE - 1)).astype(int)
                valid = (x_idx >= 0) & (x_idx < CUBE_SIZE)
                mask[x_idx[valid], I_IDX[valid], J_IDX[valid]] = True

            # Inequalities (3D evaluation)
            elif any(op in eq for op in ['<', '>', '<=', '>=']):
                mask_val = numpy_safe_eval(eq, allowed_3d)
                if np.isscalar(mask_val):
                    if mask_val: mask = np.ones_like(mask)
                else:
                    mask = mask_val

            # Implicit equality
            elif '=' in eq:
                lhs, rhs = eq.split('=', 1)
                val = numpy_safe_eval(f"abs(({lhs}) - ({rhs}))", allowed_3d)
                if np.isscalar(val): val = np.full_like(mask, val, dtype=float)
                mask = val < 0.8 # default implicit thickness
            
            # Fallback (Auto-assume explicit z)
            else:
                rhs = eq
                env = dict(allowed_3d, x=X_2d, y=Y_2d, z=None)
                Z_val = numpy_safe_eval(rhs, env)
                if np.isscalar(Z_val): Z_val = np.full_like(X_2d, Z_val)
                z_idx = np.round((Z_val - COORD_MIN) / COORD_RANGE * (CUBE_SIZE - 1)).astype(int)
                valid = (z_idx >= 0) & (z_idx < CUBE_SIZE)
                mask[I_IDX[valid], J_IDX[valid], z_idx[valid]] = True

            # Vectorized Matrix Color application
            base_color = parsed_colors[idx % len(parsed_colors)] if parsed_colors else (255, 255, 255)
            
            k_vals = np.arange(CUBE_SIZE)
            shading = 0.4 + 0.6 * (k_vals / 7.0)
            
            colored_z = np.outer(shading, base_color).astype(np.uint8) # Shape: (8, 3)
            color_grid = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
            color_grid[:] = colored_z # Broadcasts exactly matching Z dimension mapping natively
            
            voxels[mask] = color_grid[mask]

        except Exception as e:
            print(f"Error evaluating equation '{eq}': {e}")
            
    return voxels

def send_frame_to_esp32(voxels: np.ndarray, ip: str, port: int):
    """
    Sends the 8x8x8 voxel array to the ESP32 via UDP.
    Splits the data into 8 packets. To match physical vertical tubes, 
    each packet contains one X-plane (8 tubes of 8 LEDs).
    We assume the 8 tubes on a single ESP32 pin are wired in a Z-axis zig-zag.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    
    # Vectorized zig-zag Z axis on odd Y rows
    voxels_zig_zag = voxels.copy()
    voxels_zig_zag[:, 1::2, :, :] = voxels_zig_zag[:, 1::2, ::-1, :]
    
    for x in range(CUBE_SIZE):
        packet_data = bytearray([x]) + voxels_zig_zag[x].tobytes()
        sock.sendto(packet_data, (ip, port))

@app.post("/api/update_plot")
async def update_plot(config: PlotConfig):
    global current_equations, current_colors, ESP32_IP, t
    ESP32_IP = config.esp32_ip
    current_equations = config.equations
    current_colors = config.colors
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
            await websocket.send_json({"voxels": flat_voxels})
            await asyncio.sleep(1/30.0)
    except Exception as e:
        print(f"WebSocket Client disconnected: {e}")

# Background task for rendering animations and UDP streaming
async def stream_task():
    global current_voxels, t, current_equations, current_colors
    while True:
        if is_playing:
            t += (0.05 * playback_speed)
            
        current_voxels = calculate_plot(current_equations, current_colors, t)
        
        if stream_to_hardware:
            send_frame_to_esp32(current_voxels, ESP32_IP, ESP32_PORT)
            
        # Run rendering loop at roughly ~30fps 
        await asyncio.sleep(1/30.0)
