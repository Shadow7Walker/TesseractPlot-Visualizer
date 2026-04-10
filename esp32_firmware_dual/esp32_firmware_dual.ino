#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <FastLED.h>

// --- WiFi Settings ---
const char* ssid = "Tesseract_x0001"; // <--- CHANGE THIS TO YOUR WIFI NAME
const char* password = "pass1234";       // Updated per your request
WiFiUDP udp;
unsigned int localPort = 8888;

// --- LED Settings ---
#define NUM_LEDS_PER_STRIP 73
#define NUM_ACTIVE_PER_ROW 8
#define NUM_ROWS 8
#define NUM_STRIPS 8

CRGB leds[NUM_STRIPS * NUM_LEDS_PER_STRIP];

struct __attribute__((packed)) UpdatePacket {
    uint8_t chunkIndex;
    uint8_t rgbData[192];
};

uint16_t layersReceivedMask = 0;

void processPacket(UpdatePacket* packet) {
    if (packet->chunkIndex < NUM_STRIPS) {
        int stripOffset = packet->chunkIndex * NUM_LEDS_PER_STRIP;
        for (int row = 0; row < NUM_ROWS; row++) {
            int physStart = stripOffset + 1 + (row * 9);
            for (int z = 0; z < NUM_ACTIVE_PER_ROW; z++) {
                int logicalIdx = row * NUM_ACTIVE_PER_ROW + z;
                int physZ = (row % 2 == 0) ? z : (NUM_ACTIVE_PER_ROW - 1 - z);
                leds[physStart + physZ] = CRGB(
                    packet->rgbData[logicalIdx * 3],
                    packet->rgbData[logicalIdx * 3 + 1],
                    packet->rgbData[logicalIdx * 3 + 2]
                );
            }
        }
        layersReceivedMask |= (1 << packet->chunkIndex);
        if (layersReceivedMask == 0xFF) {
            FastLED.show();
            layersReceivedMask = 0;
        }
    }
}

void setup() {
    Serial.begin(921600);
    
    // Non-blocking WiFi Initialization
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false); // Crucial for low-latency UDP
    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid, password);
    
    Serial.println("\n--- HoloPlot Studio PRO Dual Boot ---");
    Serial.printf("Connecting to WiFi: %s\n", ssid);
    Serial.println("USB Serial is active and ready.");

    // FastLED Setup (Soldering-optimized pins)
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
    
    udp.begin(localPort);
}

void loop() {
    static bool wasConnected = false;
    bool isConnected = (WiFi.status() == WL_CONNECTED);

    // Print IP only once when connection is established
    if (isConnected && !wasConnected) {
        Serial.print("\nWiFi Connected! ESP32 IP: ");
        Serial.println(WiFi.localIP());
        wasConnected = true;
    } else if (!isConnected && wasConnected) {
        Serial.println("\nWiFi Disconnected. Waiting for auto-reconnect...");
        wasConnected = false;
    }

    // 1. Check for USB Serial packets (Always Priority)
    if (Serial.available() >= sizeof(UpdatePacket)) {
        UpdatePacket packet;
        if (Serial.readBytes((char*)&packet, sizeof(UpdatePacket)) == sizeof(UpdatePacket)) {
            processPacket(&packet);
        }
    }

    // 2. Check for WiFi UDP packets (Only if connected)
    if (isConnected) {
        int packetSize = udp.parsePacket();
        if (packetSize == sizeof(UpdatePacket)) {
            UpdatePacket packet;
            udp.read((char*)&packet, sizeof(UpdatePacket));
            processPacket(&packet);
        }
    }
}
