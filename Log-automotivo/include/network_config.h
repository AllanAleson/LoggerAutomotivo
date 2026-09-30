#pragma once

// Wokwi VS Code's bundled Private IoT Gateway resolves this to Windows.
constexpr const char *API_BASE_URL = "http://host.wokwi.internal:3333";
constexpr const char *WIFI_SSID = "Wokwi-GUEST";
constexpr const char *WIFI_PASSWORD = "";
constexpr const char *FIRMWARE_VERSION = "0.2.0";
constexpr float DEMO_BATTERY_VOLTAGE = 12.4f; // Simulated, not measured.
constexpr unsigned long HEARTBEAT_MS = 30000;
constexpr unsigned long RETRY_MS = 5000;
