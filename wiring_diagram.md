# ESP32 to LED Wiring Diagram

This layout illustrates how to safely and effectively distribute power and data to your 16 LED data lines across 4096 LEDs. 

> [!CAUTION]
> **Power Injection**: The 5V and GND lines must be connected to both the beginning AND the end of each strip (or frequently throughout) to prevent voltage drop and dimming. **Do not** daisy-chain the 5V power sequentially through all 4096 LEDs.

```mermaid
graph TD
    %% Define components
    PSU["Heavy Duty 5V Power Supply<br/>(e.g. 5V 60A)"]
    ESP["ESP32 Microcontroller<br/>(Powered via USB or 5V VIN)"]
    LS["3.3V to 5V Level Shifters<br/>(e.g. SN74AHCT125N)"]
    
    %% Group LED strips
    subgraph LED Matrix Structure [4096 WS2812B LEDs]
        S1["Strip 1 (256 LEDs)"]
        S2["Strip 2 (256 LEDs)"]
        Sdots["Strips 3 to 15..."]
        S16["Strip 16 (256 LEDs)"]
    end
    
    %% Common Ground Connections
    PSU -- "GND (Thick Wire)" --> ESP
    PSU -- "GND (Thick Wire)" --> LS
    PSU -- "GND (Thick Busbar)" --> S1 & S2 & Sdots & S16
    
    %% 5V Power Connections
    PSU -- "5V (Thick Busbar to BOTH ends of strip)" --> S1 & S2 & Sdots & S16
    PSU -- "5V VCC" --> LS
    
    %% Data Connections (3.3V logic from ESP32 to Level Shifter)
    ESP -- "GPIO 2 (Pin 1)" --> LS
    ESP -- "GPIO 4 (Pin 2)" --> LS
    ESP -- "Remaining GPIOs..." --> LS
    ESP -- "GPIO 19 (Pin 16)" --> LS
    
    %% Data Connections (5V logic from Level Shifter to LEDs)
    LS -- "Data In (5V Logic)" ::: data --> S1
    LS -- "Data In (5V Logic)" ::: data --> S2
    LS -- "Data In (5V Logic)" ::: data --> S16

    classDef default fill:#1e293b,stroke:#94a3b8,color:#f8fafc;
    classDef power fill:#ef4444,stroke:#dc2626,color:#fff;
    classDef ground fill:#0f172a,stroke:#475569,color:#fff;
    classDef data stroke:#3b82f6,stroke-width:2px;
```

### Important Wiring Notes:

1. **Common Ground**: It is absolutely critical that the Ground (GND) of your ESP32, the Level Shifter, the Power Supply, and the LED strips are all tied together. If they do not share a common ground, the data signals will be corrupted and the LEDs will flicker wildly.
2. **Level Shifter**: The ESP32 outputs a 3.3V data signal, but WS2812B LEDs expect a 5V data signal. Using an SN74AHCT125N or similar logic level shifter ensures stable, flicker-free data transmission to the first LED of each strip.
3. **Thick Busbars**: Due to the high current (Amperage) drawn by the LED strips, use thick copper wire (like 12 AWG or 14 AWG) from the Power Supply to run alongside your setup, and "tap" into these busbars to inject power into the strips with thinner wire.
