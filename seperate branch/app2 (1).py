from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import numpy as np
import serial
import socket
import asyncio
from contextlib import asynccontextmanager
import ast
import re

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(stream_task())
    yield
    task.cancel()
    if active_serial and active_serial.is_open:
        active_serial.close()

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ESP32 Connection State
active_serial = None
active_udp_sock = None
WIFI_TARGET = None
stream_mode = "usb"
CUBE_SIZE = 8
WIFI_PORT = 8888

def open_serial(port_name):
    global active_serial
    close_serial()
    if port_name and port_name.strip():
        try:
            active_serial = serial.Serial(port_name, 921600, timeout=1)
            print(f"Serial connected: {port_name} @ 921600 baud")
            return True
        except Exception as e:
            print(f"Serial connection failed: {e}")
            active_serial = None
    return False

def close_serial():
    global active_serial
    if active_serial and active_serial.is_open:
        active_serial.close()
    active_serial = None

def open_wifi(ip):
    global active_udp_sock, WIFI_TARGET
    close_wifi()
    if ip and ip.strip():
        try:
            active_udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            active_udp_sock.setblocking(False)
            WIFI_TARGET = (ip, WIFI_PORT)
            print(f"WiFi UDP Socket initialized: {ip}:{WIFI_PORT}")
            return True
        except Exception as e:
            print(f"WiFi socket failed: {e}")
            active_udp_sock = None
    return False

def close_wifi():
    global active_udp_sock, WIFI_TARGET
    if active_udp_sock:
        active_udp_sock.close()
    active_udp_sock = None
    WIFI_TARGET = None

# FIXED: Added brightness so the server accepts it
class PlotConfig(BaseModel):
    equations: list[str]
    colors: list[str]
    coord_min: float = -3.5  
    coord_max: float = 3.5   
    brightness: float = 0.2  

class TimeConfig(BaseModel):
    t_val: float = None
    is_playing: bool = None
    playback_speed: float = None

# Global State
current_voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
current_equations = ["z = sin(sqrt(x**2 + y**2) - t) * 2"]
current_colors = ["#ff3c3c"]
current_coord_min = -3.5
current_coord_max = 3.5
current_brightness = 0.2  # FIXED: Added to global state
stream_to_hardware = False
t = 0.0
is_playing = True
playback_speed = 1.0
frame_seq = 0
last_sent_voxels = None

class RewriteLogic(ast.NodeTransformer):
    def __init__(self, thickness):
        self.thickness = thickness

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

    def visit_Compare(self, node):
        self.generic_visit(node)
        if len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
            sub_op = ast.BinOp(left=node.left, op=ast.Sub(), right=node.comparators[0])
            abs_call = ast.Call(
                func=ast.Name(id='abs', ctx=ast.Load()),
                args=[sub_op], keywords=[]
            )
            new_node = ast.Compare(
                left=abs_call, ops=[ast.Lt()], 
                comparators=[ast.Constant(value=self.thickness)]
            )
            return ast.copy_location(new_node, node)
        return node

def numpy_safe_eval(eq_str, env, thickness):
    try:
        tree = ast.parse(str(eq_str).strip(), mode='eval')
        tree = RewriteLogic(thickness).visit(tree)
        ast.fix_missing_locations(tree)
        compiled = compile(tree, filename='<ast>', mode='eval')
        return eval(compiled, {"__builtins__": {}}, env)
    except Exception as e:
        raise ValueError(f"Evaluation failed: {e}")

def clean_eq(e):
    e = e.replace('^', '**')
    e = re.sub(r'(?<![<>!=])=(?!=)', '==', e)
    return e

def calculate_plot(equations, hex_colors, current_t, c_min, c_max, brightness = 1.0):
    voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
    
    ls = np.linspace(c_min, c_max, CUBE_SIZE)
    X3, Y3, Z3 = np.meshgrid(ls, ls, ls, indexing='ij')
    
    span = c_max - c_min
    step_size = span / (CUBE_SIZE - 1) if CUBE_SIZE > 1 else 1.0
    voxel_thickness = step_size * 0.55 
    
    allowed_3d = {
        "x": X3, "y": Y3, "z": Z3,
        "sin": np.sin, "cos": np.cos, "tan": np.tan, "sqrt": np.sqrt,
        "exp": np.exp, "abs": np.abs, "pi": np.pi, "e": np.e, "t": current_t,
        "clip": np.clip
    }
    
    parsed_colors = []
    for hex_c in hex_colors:
        h = hex_c.lstrip('#')
        if len(h) != 6: parsed_colors.append((255, 60, 60))
        else: 
            r, g, b = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
            parsed_colors.append((int(r * brightness), int(g * brightness), int(b * brightness)))

    for idx, eq in enumerate(equations):
        try:
            eq = clean_eq(eq).strip()
            if not eq: continue
            
            mask = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), dtype=bool)
            mask_val = numpy_safe_eval(eq, allowed_3d, voxel_thickness)
            
            if np.isscalar(mask_val):
                if mask_val: mask = np.ones_like(mask)
            else:
                mask = mask_val

            base_color = parsed_colors[idx % len(parsed_colors)] if parsed_colors else (255, 255, 255)
            
            k_vals = np.arange(CUBE_SIZE)
            shading = 0.4 + 0.6 * (k_vals / 7.0)
            
            colored_z = np.outer(shading, base_color).astype(np.uint8)
            color_grid = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
            color_grid[:] = colored_z 
            
            voxels[mask] = color_grid[mask]

        except Exception as e:
            pass 
            
    return voxels

async def send_frame_to_esp32(voxels: np.ndarray):
    global active_serial, active_udp_sock, WIFI_TARGET, stream_mode, frame_seq, last_sent_voxels
    
    if last_sent_voxels is None or not np.array_equal(voxels, last_sent_voxels):
        frame_seq = (frame_seq + 1) % 256
        last_sent_voxels = voxels.copy()

    hw_voxels = np.flip(voxels, axis=(0, 2))
    hw_voxels = np.ascontiguousarray(np.transpose(hw_voxels, (1, 2, 0, 3)))

    if stream_mode == "usb" and active_serial and active_serial.is_open:
        for x in range(CUBE_SIZE):
            packet_data = bytearray([frame_seq, x]) + hw_voxels[x].tobytes()
            try: active_serial.write(packet_data)
            except: close_serial(); break
                
    elif stream_mode == "wifi" and active_udp_sock and WIFI_TARGET:
        for x in range(CUBE_SIZE):
            packet_data = bytearray([frame_seq, x]) + hw_voxels[x].tobytes()
            try: active_udp_sock.sendto(packet_data, WIFI_TARGET)
            except: pass

@app.post("/api/update_plot")
async def update_plot(config: PlotConfig):
    global current_equations, current_colors, current_coord_min, current_coord_max, current_brightness
    current_equations = config.equations
    current_colors = config.colors
    current_coord_min = config.coord_min
    current_coord_max = config.coord_max
    current_brightness = config.brightness
    return {"status": "success"}

@app.post("/api/update_time")
async def update_time(config: TimeConfig):
    global t, is_playing, playback_speed
    if config.t_val is not None: t = config.t_val
    if config.is_playing is not None: is_playing = config.is_playing
    if config.playback_speed is not None: playback_speed = config.playback_speed
    return {"status": "success", "t": t}

@app.post("/api/toggle_stream")
async def toggle_stream(data: dict):
    global stream_to_hardware, stream_mode
    want_stream = data.get("stream", False)
    mode = data.get("mode", "usb")
    port = data.get("port", "")
    
    if want_stream:
        stream_mode = mode
        if mode == "usb":
            if not open_serial(port): return {"status": "error", "message": "Serial failed"}
        elif mode == "wifi":
            if not open_wifi(port): return {"status": "error", "message": "WiFi failed"}
        stream_to_hardware = True
    else:
        stream_to_hardware = False
        close_serial()
        close_wifi()
    return {"status": "success"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"voxels": current_voxels.flatten().tolist()})
            await asyncio.sleep(1/30.0)
    except: pass

async def stream_task():
    global current_voxels, t
    while True:
        if is_playing:
            t += (0.05 * playback_speed)
        
        # FIXED: Pass current_brightness into the loop!
        current_voxels = calculate_plot(
            current_equations, current_colors, t, 
            current_coord_min, current_coord_max,
            current_brightness
        )
        if stream_to_hardware:
            await send_frame_to_esp32(current_voxels)
            
        await asyncio.sleep(1/45.0)