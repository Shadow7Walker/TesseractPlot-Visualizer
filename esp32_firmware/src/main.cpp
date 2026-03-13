#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <FastLED.h>

// --- WiFi Settings ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// --- UDP Settings ---
const int localPort = 12345;
WiFiUDP udp;

// --- LED Settings ---
#define NUM_LEDS_PER_PIN 256
#define NUM_PINS 16
#define TOTAL_LEDS (NUM_LEDS_PER_PIN * NUM_PINS)

// Using 16 pins for parallel output. Adjust these to match your ESP32's available pins.
// WARNING: Avoid pins 34, 35, 36, 39 (input only). Avoid pins used for strapping if possible.
const uint8_t LED_PINS[NUM_PINS] = {
    2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 21, 22, 23, 18, 19
};

// FastLED array
CRGB leds[TOTAL_LEDS];

// --- Buffer for incoming data ---
// 16x16x16 = 4096 voxels. If we send 3 bytes (RGB) per voxel, that's 12288 bytes.
// This is larger than a standard UDP packet MTU (mostly ~1500 bytes).
// Therefore, we will receive data in chunks. 
// Standard strategy: send 16 packets, each containing one 16x16 layer (256 RGB values = 768 bytes).
struct UpdatePacket {
    uint8_t layerIndex; // 0 to 15
    uint8_t rgbData[768]; // 256 LEDs * 3 colors
};

void setupWiFi() {
    Serial.println();
    Serial.print("Connecting to ");
    Serial.println(ssid);

    WiFi.begin(ssid, password);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("");
    Serial.println("WiFi connected");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
}

void setup() {
    Serial.begin(115200);

    // Setup FastLED parallel output
    // Due to C++ template constraints in FastLED, we must add strips individually
    FastLED.addLeds<WS2812B, 2, GRB>(leds, 0 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 4, GRB>(leds,  1 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 12, GRB>(leds, 2 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 13, GRB>(leds, 3 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 14, GRB>(leds, 4 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 15, GRB>(leds, 5 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 25, GRB>(leds, 6 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 26, GRB>(leds, 7 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 27, GRB>(leds, 8 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 32, GRB>(leds, 9 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 33, GRB>(leds, 10 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 21, GRB>(leds, 11 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 22, GRB>(leds, 12 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 23, GRB>(leds, 13 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 18, GRB>(leds, 14 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);
    FastLED.addLeds<WS2812B, 19, GRB>(leds, 15 * NUM_LEDS_PER_PIN, NUM_LEDS_PER_PIN);

    FastLED.setBrightness(128); // 50% brightness to save power initially
    FastLED.clear();
    FastLED.show();

    setupWiFi();

    udp.begin(localPort);
    Serial.printf("Now listening at IP %s, UDP port %d\n", WiFi.localIP().toString().c_str(), localPort);
}

// Keep track of which layers we've received for the current frame
uint16_t layersReceivedMask = 0; 

void loop() {
    int packetSize = udp.parsePacket();
    if (packetSize) {
        UpdatePacket packet;
        int len = udp.read((char*)&packet, sizeof(UpdatePacket));
        
        if (len == sizeof(UpdatePacket)) {
            // Valid layer received
            if (packet.layerIndex < 16) {
                // Determine the starting index in the LED array for this layer.
                // Depending on the exact wiring snake pattern, this math might need tuning.
                // Assuming a straight mapping for now where each "layer" is one pin of 256 LEDs.
                int startIndex = packet.layerIndex * NUM_LEDS_PER_PIN;
                
                for(int i = 0; i < NUM_LEDS_PER_PIN; i++) {
                    leds[startIndex + i] = CRGB(
                        packet.rgbData[i*3], 
                        packet.rgbData[i*3 + 1], 
                        packet.rgbData[i*3 + 2]
                    );
                }
                
                // Mark layer as received using bitwise OR
                layersReceivedMask |= (1 << packet.layerIndex);

                // If we got all 16 layers (mask = 1111111111111111 in binary = 0xFFFF), show frame
                if (layersReceivedMask == 0xFFFF) {
                    FastLED.show();
                    layersReceivedMask = 0; // Reset for next frame
                }
            }
        }
    }
}
