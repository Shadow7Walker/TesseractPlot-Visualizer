#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <FastLED.h>

// --- WiFi Settings ---
const char* ssid = "TesseractPlotx0001"; 
const char* password = "pass1234";       
WiFiUDP udp;
unsigned int localPort = 8888;

// --- LED Settings ---
#define STATUS_LED 2            
#define NUM_LEDS_PER_STRIP 73
#define NUM_ACTIVE_PER_ROW 8
#define NUM_ROWS 8
#define NUM_STRIPS 8

CRGB leds[NUM_STRIPS * NUM_LEDS_PER_STRIP];

struct __attribute__((packed)) UpdatePacket {
    uint8_t frameIndex;
    uint8_t chunkIndex;
    uint8_t rgbData[192];
};

uint16_t layersReceivedMask = 0;
unsigned long lastPacketTime = 0;
bool firstPacketSeen = false;
uint8_t currentFrameIndex = 0;

void processPacket(UpdatePacket* packet) {
    // If the frame index changes, drop any incomplete pieces of the old frame
    if (packet->frameIndex != currentFrameIndex) {
        currentFrameIndex = packet->frameIndex;
        layersReceivedMask = 0; 
    }
    if (packet->chunkIndex < NUM_STRIPS) {
        if (!firstPacketSeen) {
            Serial.println(">>> First Data Packet Received! Tracking heartbeat...");
            firstPacketSeen = true;
        }
        
        lastPacketTime = millis(); 
        
        // Identify if the current strip was installed backwards (Strips 1, 2, 5, 8 -> Indices 0, 1, 4, 7)
        bool isBackwards = (packet->chunkIndex == 0 || packet->chunkIndex == 1 || 
                            packet->chunkIndex == 4 || packet->chunkIndex == 7);

        int stripOffset = packet->chunkIndex * NUM_LEDS_PER_STRIP;
        
        for (int y = 0; y < NUM_ROWS; y++) {
            // For backwards strips, spatial front (y=0) maps to the physical back (physRow=7)
            int physRow = isBackwards ? (7 - y) : y;
            int physStart = stripOffset + 1 + (physRow * 9);
            
            // The snake wiring dictates: Even physical rows go UP, odd go DOWN
            bool physGoesUp = (physRow % 2 == 0);
            
            for (int z = 0; z < NUM_ACTIVE_PER_ROW; z++) {
                int logicalIdx = y * NUM_ACTIVE_PER_ROW + z;
                
                int physZ;
                if (physGoesUp) {
                    physZ = z; // spatial bottom (z=0) maps to physical bottom (physZ=0)
                } else {
                    physZ = (NUM_ACTIVE_PER_ROW - 1 - z); // spatial bottom (z=0) maps to physical bottom (physZ=7)
                }
                
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
    // CRITICAL: Expand buffer for 921600 baud stability
    Serial.setRxBufferSize(2048); 
    Serial.begin(921600);
    Serial.setTimeout(5); // Don't hang on missed bytes
    
    pinMode(STATUS_LED, OUTPUT);
    
    // Diagnostic Startup Blink
    for(int i=0; i<3; i++) {
        digitalWrite(STATUS_LED, HIGH);
        delay(150);
        digitalWrite(STATUS_LED, LOW);
        delay(150);
    }
    
    // WiFi Initialization (Access Point Mode)
    WiFi.mode(WIFI_AP);
    // Note: setSleep is mostly relevant for STA mode, but doesn't hurt.
    WiFi.softAP(ssid, password);
    
    Serial.println("\n--- Tesseract Studio PRO Dual Boot ---");
    Serial.print("Access Point Started. Connect to: ");
    Serial.println(ssid);
    Serial.print("AP IP Address: ");
    Serial.println(WiFi.softAPIP());
    Serial.println("USB Serial Buffer expanded to 2048 bytes.");

    // FastLED Setup (Using 100% safe, non-strapping pins to prevent boot-glitches)
    FastLED.addLeds<WS2812B, 32, GRB>(leds, 0 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 1 (was 13)
    FastLED.addLeds<WS2812B, 27, GRB>(leds, 1 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 2 (was 14)
    FastLED.addLeds<WS2812B, 26, GRB>(leds, 2 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 3 (unchanged)
    FastLED.addLeds<WS2812B, 33, GRB>(leds, 3 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 4 (unchanged)
    FastLED.addLeds<WS2812B, 17, GRB>(leds, 4 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 5 (was 15/4)
    FastLED.addLeds<WS2812B, 16, GRB>(leds, 5 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 6 (unchanged)
    FastLED.addLeds<WS2812B, 19, GRB>(leds, 6 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 7 (unchanged)
    FastLED.addLeds<WS2812B, 22, GRB>(leds, 7 * NUM_LEDS_PER_STRIP, NUM_LEDS_PER_STRIP); // Strip 8 (was 23)

    FastLED.setBrightness(128);
    FastLED.clear();
    FastLED.show();
    
    udp.begin(localPort);
}

void loop() {
    // In AP mode, we don't 'connect' to a router, so we don't need WL_CONNECTED status checks.

    // 1. Check for USB Serial packets
    if (Serial.available() >= 194) { // Use fixed packet size check
        UpdatePacket packet;
        if (Serial.readBytes((char*)&packet, 194) == 194) {
            processPacket(&packet);
        }
    }

    // 2. Check for WiFi UDP packets (Drain the entire network buffer)
    int packetSize = udp.parsePacket();
    while (packetSize > 0) {
        if (packetSize == 194) {
            UpdatePacket packet;
            udp.read((char*)&packet, 194);
            processPacket(&packet);
        } else {
            // Discard malformed packet
            while(udp.available()) { udp.read(); }
        }
        packetSize = udp.parsePacket(); // Grab next packet immediately
    }

    // Heartbeat: Blink toggle every 100ms when streaming
    if (millis() - lastPacketTime < 250) {
        bool pulseState = (millis() / 100) % 2 == 0;
        digitalWrite(STATUS_LED, pulseState ? HIGH : LOW);
    } else {
        digitalWrite(STATUS_LED, LOW);
        firstPacketSeen = false; // Reset for next connection
    }
}
