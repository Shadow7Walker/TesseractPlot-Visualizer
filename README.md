# HoloPlot Studio PRO: 3D LED Voxel Controller

HoloPlot Studio PRO is an advanced, high-performance software suite and firmware architecture designed to control a physical 16x16x16 (4096 LED) pseudo-holographic matrix. 

The project allows users to render, animate, and customize multi-layered mathematical 3D plots in a real-time web simulator, and seamlessly stream that data to physical LED hardware over a local network.

## 🌟 Core Features

- **Universal 3D Math Engine**: Powered by Python's `numpy`, the backend breaks free of standard `z = f(x,y)` limitations. You can graph across any plane (`x=`, `y=`, `z=`) interchangeably or combine them.
- **Volumetric Implicit Geometry**: Native support for inequalities (e.g., `x**2 + y**2 + z**2 < 16`) allows you to effortlessly render solid 3D geometric shapes like spheres, cones, and cylinders in space.
- **Desmos-Style Layering**: Render multiple intersecting plots simultaneously. The UI dynamically supports adding layers, each independently evaluated and composited into the matrix.
- **Interactive Color Picking**: Every equation layer features a native HTML5 color picker. Easily map distinct `#HEX` colors to specific mathematical volumes for clean visual separation.
- **Physics Timeline (`t`) & Playback**: A continuous, animated time variable `t` permeates all equations. Smoothly scrub through time, pause visualizations mid-frame to inspect them, or distort playback speed from `-3.0x` to `+5.0x`.
- **Live "Digital Twin" Simulator**: A responsive, dark-themed Web App built on **Three.js** accurately mimics the 16x16x16 physical matrix (complete with transparent tubes). Evaluate LED states, Ampere draw estimates, and physical voxel paths *before* turning on the physical hardware.

---

## 🏗️ System Architecture

The project is elegantly divided into three independent layers working in perfect unison:

### 1. The FastAPI Backend (`server/app.py`)
- Takes arbitrary string equations and safely evaluates them against an absolute `[-5.0, 5.0]` 3-dimensional coordinate space.
- Calculates distances, mappings, and volume intersections at roughly 30 to 60 frames per second using vectorized numpy arrays.
- Maintains a stateful timeline (`t`) via a native Python `asyncio` background lifespan context.
- Packages final byte matrices into custom UDP payloads structured specifically for hardware parsing efficiency.

### 2. The Interactive Web UI (`server/static/`)
- Pure HTML, modern CSS, and vanilla JS (`main.js`). No build steps or Node framework bloat required.
- Maintains a fully asynchronous WebSocket connection to the Python backend to display real-time physical states with near-zero latency.
- Completely localized (Three.js and OrbitControls operate offline).

### 3. ESP32 Parallel Hardware Firmware (`esp32_firmware/src/main.cpp`)
- Built on the legendary **FastLED** library.
- Due to the massive bandwidth required by 4096 LEDs, the firmware is configured to split data output perfectly across **16 parallel GPIO pins**. Each pin independently drives 256 LEDs.
- Runs an optimized UDP packet listener. The backend maps physical wire routing (vertical zig-zags) so the microcontroller simply dumps incoming 768-byte sequential chunks directly into hardware memory without expensive math.

---

## 🔌 Hardware Construction Guidelines

To build the 16x16x16 physical cube correctly, adhere to these critical constraints:

1. **LED Specs:** Use WS2812B or SK6812 IP30 strips spaced at 100 LEDs/meter to fit exactly 16 LEDs into a 16cm transparent acrylic tube.
2. **Parallel Wiring:** You MUST wire 16 independent data wires from 16 ESP32 output pins to the start of each of the 16 individual planes. Do not attempt a single 4096 daisy chain (framerate drops to <8 FPS).
3. **5V Level Shifting:** The ESP32 logic is 3.3V. You must route the 16 data channels through an SN74AHCT125N (or similar) level shifter to boost them to the 5V required by the LEDs.
4. **Heavy Power Injection:** A 40A to 60A 5V power supply is required. **You must inject 5V and GND directly from thick copper busbars into the start and end of *every single 16-led strip***. Do not pass main power through the thin copper pads of the strip, or they will ignite.

---

## 🚀 Getting Started

### 1. Flash the ESP32
Open `esp32_firmware/src/main.cpp` using PlatformIO or Arduino IDE.
Update the WiFi `ssid` and `password`. Attach your LEDs and flash. Give it a static IP on your router if possible.

### 2. Start the Backend Server
Requires Python 3.10+ and the `uv` package manager.
```bash
cd ./server/
uv sync
uv run uvicorn app:app --port 8000
```
*(If you do not have `uv`, install it via `pip install uv` or visit astral.sh)*

### 3. Open the Dashboard
Navigate to `http://localhost:8000/static/index.html` in any modern web browser.
Enter mathematical volumes, pick colors, hit **Render**, and when you're ready, toggle **Stream to Hardware**!