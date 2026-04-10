#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <FastLED.h>

// --- WiFi Settings ---
const char* ssid = "YOUR_WIFI_NAME_HERE"; 
const char* password = "pass1234";       
WiFiUDP udp;
unsigned int localPort = 8888;

// --- LED Settings ---
#define STATUS_LED 2            // Built-in ESP32 LED (GPIO 2)
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
unsigned long lastPacketTime = 0;

void processPacket(UpdatePacket* packet) {
    if (packet->chunkIndex < NUM_STRIPS) {
        lastPacketTime = millis(); // Refresh activity timer for D2 LED
        digitalWrite(STATUS_LED, HIGH);

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
    pinMode(STATUS_LED, OUTPUT);
    digitalWrite(STATUS_LED, LOW);
    
    // Non-blocking WiFi Initialization
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid, password);
    
    Serial.println("\n--- HoloPlot Studio PRO Dual Boot ---");
    Serial.println("D2 Status LED enabled as Data Heartbeat.");

    // FastLED Setup (Strip 5 moved to D4 to avoid D2 LED conflict)
    FastLED.addLeds<WS2812B, 13, GRB>(leds, 0 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 14, GRB>(leds, 1 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 26, GRB>(leds, 2 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 33, GRB>(leds, 3 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP);
    FastLED.addLeds<WS2812B, 15, GRB>(leds, 4 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // <--- MOVED TO D15
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

    if (isConnected && !wasConnected) {
        Serial.print("\nWiFi Connected! IP: ");
        Serial.println(WiFi.localIP());
        wasConnected = true;
    } else if (!isConnected && wasConnected) {
        wasConnected = false;
    }

    // Blink Heartbeat: Turn off LED if no packets received for 50ms
    if (millis() - lastPacketTime > 50) {
        digitalWrite(STATUS_LED, LOW);
    }

    // 1. Check for USB Serial packets
    if (Serial.available() >= sizeof(UpdatePacket)) {
        UpdatePacket packet;
        if (Serial.readBytes((char*)&packet, sizeof(UpdatePacket)) == sizeof(UpdatePacket)) {
            processPacket(&packet);
        }
    }

    // 2. Check for WiFi UDP packets
    if (isConnected) {
        int packetSize = udp.parsePacket();
        if (packetSize == sizeof(UpdatePacket)) {
            UpdatePacket packet;
            udp.read((char*)&packet, sizeof(UpdatePacket)) == sizeof(UpdatePacket);
            processPacket(&packet);
        }
    }
}
