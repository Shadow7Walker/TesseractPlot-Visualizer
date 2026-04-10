# Tesseract Plot Studio: Pro 8x8x8 Voxel Controller

Tesseract Plot Studio is a high-performance 3D visualization suite designed to control an 8x8x8 pseudo-holographic LED matrix. It features a real-time "Digital Twin" simulator and high-speed streaming capabilities for physical hardware.

## 🌟 Core Features

- **Dual-Mode Streaming**: Seamlessly switch between **USB-C Serial (921,600 Baud)** for zero-latency hardwired control and **WiFi UDP** for wireless freedom.
- **Universal 3D Math Engine**: Graph any mathematical volume across `x`, `y`, or `z` planes using vectorized `numpy` evaluation.
- **Volumetric Implicit Geometry**: Native support for inequalities (e.g., `x**2 + y**2 + z**2 < 16`) to render solid geometric volumes.
- **Physics Timeline (`t`)**: A continuous time variable allows for smooth 3D animations, with playback controls ranging from -3.0x to +5.0x.
- **Digital Twin Simulator**: Built on **Three.js**, the UI accurately mimics the physical 8-strip matrix, including reflections and power draw estimates.

---

## 🏗️ System Architecture

### 1. Dual-Protocol Backend (`server/app.py`)
- Evaluates mathematical strings into discrete RGB voxel matrices at ~30 FPS.
- Supports **Serial Binary Streaming** (1 header byte + 192 RGB bytes per chunk).
- Supports **UDP Network Streaming** for wireless ESP32 installations.

### 2. Interactive Web UI (`server/static/`)
- Pure HTML/CSS/JS with a dark-mode, glassmorphic aesthetic.
- Features a **Logic-Lock** tabbed interface for clear separation between USB and WiFi hardware targets.

### 3. ESP32 Dual-Mode Firmware (`esp32_firmware_dual.ino`)
- **Zigzag & Skip Mapping**: Specifically designed for a physical build using 8 strips of 73 LEDs each.
- **Protocol**: Maps 64 logical voxels into 73 physical LEDs per strip (1 skip + 8 active pattern).
- **AP Mode WiFi**: The ESP32 creates its own network (`TesseractPlotx0001`) so you can stream reliably anywhere without a router.

---

## 🔌 Hardware Construction

### Strip Assembly (8 Strips)
Each physical strip contains **73 LEDs** configured as a vertical zigzag:
- **Pattern**: `[Skip LED] -> [8 Active LEDs ↑] -> [Skip LED] -> [8 Active LEDs ↓] ...`
- **Total**: 9 skip LEDs (for tube-to-tube corners) and 64 active LEDs per strip.

### Wiring Layout (Pins chosen for soldering clearance)
The firmware is optimized for the following ESP32 pins to allow maximum space between solder joints:

```
                    ┌──────────┐
                    │  USB-C   │
                    └──────────┘
       Left                              Right
      ┌─────┐                          ┌─────┐
  1   │ 3V3 │                          │ VIN │   1
  2   │ GND │                          │ GND │   2
  3   │ D15 │ ← Strip 5                │ D13 │   3  ← Strip 1
  4   │ D2  │  Status LED              │ D12 │   4   skip
  5   │ D4  │                          │ D14 │   5  ← Strip 2
  6   │ D16 │ ← Strip 6 (yours!)       │ D27 │   6
  7   │ D17 │                          │ D26 │   7  ← Strip 3
  8   │ D5  │                          │ D25 │   8
  9   │ D18 │                          │ D33 │   9  ← Strip 4
 10   │ D19 │ ← Strip 7                │ D32 │  10
 11   │ D21 │                          │ D35 │  11   input only
 12   │ RX0 │  serial                  │ D34 │  12   input only
 13   │ TX0 │  serial                  │ VN  │  13   input only
 14   │ D22 │                          │ VP  │  14   input only
 15   │ D23 │ ← Strip 8                │ EN  │  15
      └─────┘                          └─────┘
```

---

## 🚀 Getting Started

1. **Flash Firmware**: Open `esp32_firmware_dual.ino`.
2. **Connect to WiFi**: Connect your laptop directly to the **TesseractPlotx0001** WiFi network (Password: `pass1234`). Note: You will lose internet connection on this interface.
3. **Launch Server**:
   ```bash
   cd ./server/
   uv run uvicorn app:app --port 8000
   ```
4. **Open Simulator**: Go to `http://localhost:8000/static/index.html`.
5. **Link Hardware**: 
   - **USB**: Select the **USB** tab, enter your COM port, and click **Start Streaming**.
   - **WiFi**: Select the **WiFi** tab, enter **`192.168.4.1`**, and click **Start Streaming**.
