#include <Arduino.h>
#include <FastLED.h>

// --- LED Settings ---
// Single test strip: 8 LEDs on GPIO 16
#define NUM_LEDS 8
#define DATA_PIN 16

CRGB leds[NUM_LEDS];

// --- Packet format ---
// 1 byte chunk header + 8 LEDs * 3 bytes RGB = 25 bytes total
struct __attribute__((packed)) UpdatePacket {
    uint8_t chunkIndex;     // 0 for single-strip mode
    uint8_t rgbData[24];    // 8 LEDs * 3 colors
};

void setup() {
    // High-speed serial over USB-C
    Serial.begin(921600);
    Serial.setTimeout(10);

    FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, NUM_LEDS);
    FastLED.setBrightness(64); // Low brightness — USB power is limited (~500mA)
    FastLED.clear();
    FastLED.show();
}

void loop() {
    if (Serial.available() >= (int)sizeof(UpdatePacket)) {
        UpdatePacket packet;
        size_t len = Serial.readBytes((char*)&packet, sizeof(UpdatePacket));
        
        if (len == sizeof(UpdatePacket) && packet.chunkIndex == 0) {
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = CRGB(
                    packet.rgbData[i * 3], 
                    packet.rgbData[i * 3 + 1], 
                    packet.rgbData[i * 3 + 2]
                );
            }
            FastLED.show();
        } else {
            // Out of sync — flush the serial buffer to realign
            while (Serial.available()) {
                Serial.read();
            }
        }
    }
}
