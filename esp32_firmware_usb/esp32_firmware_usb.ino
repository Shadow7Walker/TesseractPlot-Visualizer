#include <Arduino.h>
#include <FastLED.h>

// --- LED Settings ---
#define NUM_LEDS_PER_STRIP 73   // Physical LEDs per strip (including wall skip LEDs)
#define NUM_ACTIVE_PER_ROW 8    // Active LEDs per tube
#define NUM_ROWS 8              // Y rows per strip
#define NUM_VOXELS_PER_STRIP 64 // 8 rows * 8 LEDs = 64 active LEDs
#define NUM_STRIPS 8

// Total physical LEDs across all 8 strips
CRGB leds[NUM_STRIPS * NUM_LEDS_PER_STRIP]; // 8 * 73 = 584

// --- Packet format ---
// 1 byte chunk header + 64 voxels * 3 RGB = 193 bytes
struct __attribute__((packed)) UpdatePacket {
    uint8_t chunkIndex;     // 0 to 7
    uint8_t rgbData[192];   // 64 active LEDs * 3 colors
};

void setup() {
    Serial.begin(921600);
    Serial.setTimeout(10);

    // Pin assignments (chosen for soldering clearance):
    // Right side:  D13 (Strip 0), D14 (Strip 1), D26 (Strip 2), D33 (Strip 3)
    // Left side:   D2  (Strip 4), D16 (Strip 5), D19 (Strip 6), D23 (Strip 7)
    FastLED.addLeds<WS2812B, 13, GRB>(leds, 0 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 14, GRB>(leds, 1 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 26, GRB>(leds, 2 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 33, GRB>(leds, 3 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B,  2, GRB>(leds, 4 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 16, GRB>(leds, 5 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 19, GRB>(leds, 6 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 23, GRB>(leds, 7 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);

    FastLED.setBrightness(128);
    FastLED.clear();
    FastLED.show();
}

uint16_t layersReceivedMask = 0;

void loop() {
    if (Serial.available() >= (int)sizeof(UpdatePacket)) {
        UpdatePacket packet;
        size_t len = Serial.readBytes((char*)&packet, sizeof(UpdatePacket));

        if (len == sizeof(UpdatePacket) && packet.chunkIndex < NUM_STRIPS) {
            int stripOffset = packet.chunkIndex * NUM_LEDS_PER_STRIP;

            // Clear entire physical strip (all 73 LEDs black — skip LEDs stay dark)
            for (int i = 0; i < NUM_LEDS_PER_STRIP; i++) {
                leds[stripOffset + i] = CRGB::Black;
            }

            // Map 64 logical voxels onto the 73 physical LEDs
            // Physical pattern per row: 1(skip) + 8(active) = 9 LEDs
            // Zigzag: even rows go forward (z=0→7), odd rows go reversed (z=7→0)
            for (int row = 0; row < NUM_ROWS; row++) {
                int physStart = stripOffset + 1 + (row * 9); // +1 to skip the wall LED

                for (int z = 0; z < NUM_ACTIVE_PER_ROW; z++) {
                    int logicalIdx = row * NUM_ACTIVE_PER_ROW + z;

                    // Zigzag: odd rows are physically reversed
                    int physZ = (row % 2 == 0) ? z : (NUM_ACTIVE_PER_ROW - 1 - z);

                    leds[physStart + physZ] = CRGB(
                        packet.rgbData[logicalIdx * 3],
                        packet.rgbData[logicalIdx * 3 + 1],
                        packet.rgbData[logicalIdx * 3 + 2]
                    );
                }
            }

            // Mark this strip as received
            layersReceivedMask |= (1 << packet.chunkIndex);

            // All 8 strips received — push to LEDs
            if (layersReceivedMask == 0xFF) {
                FastLED.show();
                layersReceivedMask = 0;
            }
        } else {
            // Sync error — flush buffer
            while (Serial.available()) {
                Serial.read();
            }
        }
    }
}
