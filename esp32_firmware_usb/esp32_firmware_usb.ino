#include <Arduino.h>
#include <FastLED.h>

// --- LED Settings ---
#define NUM_LEDS_PER_PIN 64
#define NUM_PINS 8
#define TOTAL_LEDS (NUM_LEDS_PER_PIN * NUM_PINS)

// Using 8 pins for parallel output. Adjust these to match your ESP32's available pins.
// WARNING: Avoid pins 34, 35, 36, 39 (input only). Avoid pins used for strapping if possible.
const uint8_t LED_PINS[NUM_PINS] = {
    2, 4, 12, 13, 14, 15, 25, 26
};

// FastLED array
CRGB leds[TOTAL_LEDS];

// --- Buffer for incoming data ---
// 8x8x8 = 512 voxels. At 3 bytes (RGB) per voxel, that's 1536 bytes.
// We receive data in chunks mirroring the Python backend.
// We receive 8 packets over serial, each containing one X-plane of 8 tubes (64 RGB values = 193 bytes including the chunk header index).
struct __attribute__((packed)) UpdatePacket {
    uint8_t chunkIndex;   // 0 to 7 (Mapping to a specific pin)
    uint8_t rgbData[192]; // 64 LEDs * 3 colors
};

void setup() {
    // 921600 Baud guarantees enough bandwidth to stream ~1536 bytes at 60+ FPS stably via USB-C
    Serial.begin(921600);
    Serial.setTimeout(10); // Low timeout to prevent blocking if bytes drop in transit

    // Setup FastLED parallel output
    FastLED.addLeds<WS2812B, 2, GRB>(leds,  0 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 4, GRB>(leds,  1 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 12, GRB>(leds, 2 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 13, GRB>(leds, 3 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 14, GRB>(leds, 4 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 15, GRB>(leds, 5 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 25, GRB>(leds, 6 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 26, GRB>(leds, 7 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);

    FastLED.setBrightness(128); // 50% brightness to save power initially
    FastLED.clear();
    FastLED.show();
}

// Keep track of which layers we've received for the current frame
uint16_t layersReceivedMask = 0; 

void loop() {
    // Wait for at least exactly 1 payload block
    if (Serial.available() >= sizeof(UpdatePacket)) {
        UpdatePacket packet;
        size_t len = Serial.readBytes((char*)&packet, sizeof(UpdatePacket));
        
        if (len == sizeof(UpdatePacket)) {
            // Valid chunk received
            if (packet.chunkIndex < NUM_PINS) {
                // Determine the starting index in the LED array for this chunk.
                // Each chunk perfectly maps to one of the 8 output pins.
                int startIndex = packet.chunkIndex * NUM_LEDS_PER_PIN;
                
                for(int i = 0; i < NUM_LEDS_PER_PIN; i++) {
                    leds[startIndex + i] = CRGB(
                        packet.rgbData[i*3], 
                        packet.rgbData[i*3 + 1], 
                        packet.rgbData[i*3 + 2]
                    );
                }
                
                // Mark chunk as received using bitwise OR
                layersReceivedMask |= (1 << packet.chunkIndex);

                // If we got all 8 layers (mask = 11111111 in binary = 0xFF), flush the entire cube buffer out to LEDs visually
                if (layersReceivedMask == 0xFF) {
                    FastLED.show();
                    layersReceivedMask = 0; // Reset for next frame
                }
            } else {
                 // Sync Error Detection: If Python sends a misaligned index (e.g. index 255), flush parsing to resync limits
                 while(Serial.available()) {
                       Serial.read();
                 }
            }
        }
    }
}
