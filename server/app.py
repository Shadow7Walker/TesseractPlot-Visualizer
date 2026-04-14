from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import numpy as np
import serial
import socket
import asyncio
from contextlib import asynccontextmanager
import ast

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create the rendering task
    task = asyncio.create_task(stream_task())
    yield
    # Shutdown: Cancel the task and close any open serial connection
    task.cancel()
    if active_serial and active_serial.is_open:
        active_serial.close()

app = FastAPI(lifespan=lifespan)

# Mount the static directory for the Web UI
app.mount("/static", StaticFiles(directory="static"), name="static")

# ESP32 Connection State
active_serial = None
active_udp_sock = None
WIFI_TARGET = None  # (ip, port)
stream_mode = "usb"  # "usb" or "wifi"
CUBE_SIZE = 8
WIFI_PORT = 8888

def open_serial(port_name):
    """Open a serial connection to the given COM port. Returns True on success."""
    global active_serial
    close_serial()
    if port_name and port_name.strip():
        try:
            active_serial = serial.Serial(port_name, 921600, timeout=1)
            print(f"Serial connected: {port_name} @ 921600 baud")
            return True
        except Exception as e:
            print(f"Serial connection failed ({port_name}): {e}")
            active_serial = None
            return False
    return False

def close_serial():
    """Close any open serial connection."""
    global active_serial
    if active_serial and active_serial.is_open:
        active_serial.close()
        print("Serial connection closed.")
    active_serial = None

def open_wifi(ip):
    """Initialize a UDP socket for WiFi streaming. Returns True on success."""
    global active_udp_sock, WIFI_TARGET
    close_wifi()
    if ip and ip.strip():
        try:
            active_udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Set to non-blocking to prevent frame delay on network hiccups
            active_udp_sock.setblocking(False)
            WIFI_TARGET = (ip, WIFI_PORT)
            print(f"📡 WiFi UDP Socket initialized. Streaming to {ip}:{WIFI_PORT}")
            return True
        except Exception as e:
            print(f"WiFi socket creation failed: {e}")
            active_udp_sock = None
            return False
    return False

def close_wifi():
    """Close the UDP socket."""
    global active_udp_sock, WIFI_TARGET
    if active_udp_sock:
        active_udp_sock.close()
        print("WiFi connection closed.")
    active_udp_sock = None
    WIFI_TARGET = None

class PlotConfig(BaseModel):
    equations: list[str]
    colors: list[str]

# Global state
current_voxels = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3), dtype=np.uint8)
current_equations = ["z = 4 * sin(sqrt(x**2 + y**2) - t * 2)"]
current_colors = ["#ff3c3c"]
stream_to_hardware = False
t = 0.0
is_playing = True
playback_speed = 1.0
frame_seq = 0
last_sent_voxels = None

# Pre-compute static geometry grids to save CPU during rapid frame calculations
COORD_MIN, COORD_MAX = 1.0, 8.0
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

    def visit_Compare(self, node):
        self.generic_visit(node)
        # Convert strict equality '==' to 'abs(left - right) < 0.8' to support volumetric 
        # thickness for all implicit & explicit geometry constraints
        if len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
            sub_op = ast.BinOp(left=node.left, op=ast.Sub(), right=node.comparators[0])
            abs_call = ast.Call(
                func=ast.Name(id='abs', ctx=ast.Load()),
                args=[sub_op], keywords=[]
            )
            new_node = ast.Compare(
                left=abs_call, ops=[ast.Lt()], 
                comparators=[ast.Constant(value=0.8)]
            )
            return ast.copy_location(new_node, node)
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
        
    import re
    def clean_eq(e):
        e = e.replace('^', '**')
        # Convert standalone '=' to '==' for python eval compatibility (prevents SyntaxError on single equals)
        e = re.sub(r'(?<![<>!=])=(?!=)', '==', e)
        return e

    for idx, eq in enumerate(equations):
        try:
            eq = clean_eq(eq).strip()
            if not eq: continue
            
            mask = np.zeros((CUBE_SIZE, CUBE_SIZE, CUBE_SIZE), dtype=bool)

            # Unified 3D Volumetric Evaluation
            # Since RewriteLogic intercepts '==' and converts it to a volumetric constraint, 
            # and converts 'and'/'or' to '&'/'|', EVERY equation now natively computes as a boolean mask!
            mask_val = numpy_safe_eval(eq, allowed_3d)
            if np.isscalar(mask_val):
                if mask_val: mask = np.ones_like(mask)
            else:
                mask = mask_val

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

async def send_frame_to_esp32(voxels: np.ndarray):
    """
    Sends the 8x8x8 voxel array to the ESP32 via either USB Serial or WiFi UDP.
    Sends 8 packets (one per strip/X-plane), each 194 bytes:
      1 byte frame sync + 1 byte chunk index + 64 voxels * 3 RGB = 194 bytes.
    """
    global active_serial, active_udp_sock, WIFI_TARGET, stream_mode, frame_seq, last_sent_voxels
    
    # Only increment frame sequence if the plot actually changed physically.
    # This acts as an automatic protocol "healing" mechanism. If the ESP32 loses a chunk
    # while the plot is stationary, the next duplicate frame blast allows it to patch the holes.
    if last_sent_voxels is None or not np.array_equal(voxels, last_sent_voxels):
        frame_seq = (frame_seq + 1) % 256
        last_sent_voxels = voxels.copy()

    # the floor (StripIndex = Height (Y), RowIndex = Depth (Z), LedIndex = Width (X)).
    # We invert Mathematical X and Z axes to match specific hardware positioning,
    # then transpose Mathematical (X, Y, Z) mapping to -> Physical (Y, Z, X).
    hw_voxels = np.flip(voxels, axis=(0, 2))
    hw_voxels = np.ascontiguousarray(np.transpose(hw_voxels, (1, 2, 0, 3)))

    if stream_mode == "usb":
        if not active_serial or not active_serial.is_open:
            return
        
        for x in range(CUBE_SIZE):
            plane_data = hw_voxels[x]
            packet_data = bytearray([frame_seq, x]) + plane_data.tobytes()
            try:
                active_serial.write(packet_data)
            except Exception as e:
                print(f"Serial write error: {e}")
                close_serial()
                break
                
    elif stream_mode == "wifi":
        if not active_udp_sock or not WIFI_TARGET:
            return
            
        for x in range(CUBE_SIZE):
            plane_data = hw_voxels[x]
            packet_data = bytearray([frame_seq, x]) + plane_data.tobytes()
            try:
                active_udp_sock.sendto(packet_data, WIFI_TARGET)
            except Exception as e:
                # To prevent log spam, we only print occasionally or just pass. 
                # But for debugging, let's print the actual error if it happens.
                print(f"UDP send error: {e}")
                pass

@app.post("/api/update_plot")
async def update_plot(config: PlotConfig):
    global current_equations, current_colors
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
    global stream_to_hardware, stream_mode
    want_stream = data.get("stream", False)
    mode = data.get("mode", "usb")
    port = data.get("port", "")
    
    if want_stream:
        stream_mode = mode
        if mode == "usb":
            success = open_serial(port)
            if not success:
                return {"status": "error", "message": f"Could not open Serial {port}"}
        elif mode == "wifi":
            success = open_wifi(port)
            if not success:
                return {"status": "error", "message": f"Could not init WiFi at {port}"}
        stream_to_hardware = True
    else:
        stream_to_hardware = False
        close_serial()
        close_wifi()
    
    return {"status": "success", "streaming": stream_to_hardware, "mode": stream_mode}

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

# Background task for rendering animations and hardware streaming
async def stream_task():
    global current_voxels, t, current_equations, current_colors
    while True:
        if is_playing:
            t += (0.05 * playback_speed)
            
        current_voxels = calculate_plot(current_equations, current_colors, t)
        
        if stream_to_hardware:
            await send_frame_to_esp32(current_voxels)
            
        # Run rendering loop at roughly ~45fps, allowing some headroom for calc
        await asyncio.sleep(1/45.0)
