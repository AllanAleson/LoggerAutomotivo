#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <time.h>
#include <WiFi.h>

// =====================================================
// LOGGER
// =====================================================

const char *LOGGER_ID = "LOGGER-001";
const char *LOG_FILE  = "/logs.jsonl";

// =====================================================
// ENTRADAS
// =====================================================

const int PIN_IN1_IGNITION = 34;
const int PIN_IN2_LOCK     = 35;
const int PIN_IN3_UNLOCK   = 32;
const int PIN_IN4_WINDOW   = 33;

// =====================================================
// RTC
// =====================================================

const int PIN_RTC_SDA = 21;
const int PIN_RTC_SCL = 22;

const byte RTC_ADDRESS = 0x68;

// =====================================================
// MICRO SD
// =====================================================

const int PIN_SD_SCK  = 18;
const int PIN_SD_MISO = 19;
const int PIN_SD_MOSI = 23;
const int PIN_SD_CS   = 5;

// =====================================================
// STATUS
// =====================================================

const int PIN_LED_STATUS = 25;

const unsigned long DEBOUNCE_MS = 40;
const unsigned long LED_PULSE_MS = 80;

// =====================================================
// ENTRADAS
// =====================================================

struct InputChannel {
  const char *id;
  const char *event;

  int pin;

  int stableState;
  int lastReading;

  unsigned long lastChangeMs;
};

InputChannel channels[] = {
  { "IN1", "IGNITION", PIN_IN1_IGNITION, HIGH, HIGH, 0 },
  { "IN2", "LOCK",     PIN_IN2_LOCK,     HIGH, HIGH, 0 },
  { "IN3", "UNLOCK",   PIN_IN3_UNLOCK,   HIGH, HIGH, 0 },
  { "IN4", "WINDOW",   PIN_IN4_WINDOW,   HIGH, HIGH, 0 }
};

const int CHANNEL_COUNT =
  sizeof(channels) / sizeof(channels[0]);

// =====================================================
// ESTADO
// =====================================================

bool sdReady = false;
bool ledActive = false;
unsigned long ledStartMs = 0;

void getRtcTimestamp(char *buffer, size_t maxLen);
#include "network_transport.h"

// RTC is UTC in this simulation. NTP supplies fallback time if RTC is absent.
// Before NTP, build time + uptime keeps offline records valid ISO 8601.
void fallbackTimestamp(char *buffer, size_t maxLen) {
  time_t current = time(nullptr);
  if (current < 1700000000) {
    struct tm build{};
    char month[4];
    int day, year, hour, minute, second;
    sscanf(__DATE__, "%3s %d %d", month, &day, &year);
    sscanf(__TIME__, "%d:%d:%d", &hour, &minute, &second);
    const char *months = "JanFebMarAprMayJunJulAugSepOctNovDec";
    const char *match = strstr(months, month);
    build.tm_mon = match ? (match - months) / 3 : 0;
    build.tm_mday = day; build.tm_year = year - 1900;
    build.tm_hour = hour; build.tm_min = minute; build.tm_sec = second;
    current = mktime(&build) + millis() / 1000;
  }
  struct tm utc{};
  gmtime_r(&current, &utc);
  strftime(buffer, maxLen, "%Y-%m-%dT%H:%M:%SZ", &utc);
}

// =====================================================
// RTC
// =====================================================

byte bcdToDec(byte value) {
  return ((value >> 4) * 10) + (value & 0x0F);
}

void getRtcTimestamp(char *buffer, size_t maxLen) {

  Wire.beginTransmission(RTC_ADDRESS);

  Wire.write(0x00);

  if (Wire.endTransmission() != 0) {

    fallbackTimestamp(buffer, maxLen);

    return;
  }

  int bytes =
    Wire.requestFrom(
      (int) RTC_ADDRESS,
      7
    );

  if (bytes < 7) {

    fallbackTimestamp(buffer, maxLen);

    return;
  }

  int second =
    bcdToDec(
      Wire.read() & 0x7F
    );

  int minute =
    bcdToDec(
      Wire.read()
    );

  byte rawHour = Wire.read();
  int hour = (rawHour & 0x40)
    ? bcdToDec(rawHour & 0x1F) % 12 + ((rawHour & 0x20) ? 12 : 0)
    : bcdToDec(rawHour & 0x3F);

  // ignora dia da semana
  Wire.read();

  int day =
    bcdToDec(
      Wire.read()
    );

  int month =
    bcdToDec(
      Wire.read() & 0x1F
    );

  int year =
    2000 +
    bcdToDec(
      Wire.read()
    );

  snprintf(
    buffer,
    maxLen,

    "%04d-%02d-%02dT%02d:%02d:%02dZ",

    year,
    month,
    day,
    hour,
    minute,
    second
  );
}

// =====================================================
// LED
// =====================================================

void triggerStatusLed() {

  digitalWrite(
    PIN_LED_STATUS,
    HIGH
  );

  ledActive = true;

  ledStartMs = millis();
}

void updateStatusLed(
  unsigned long now
) {

  if (
    ledActive &&
    (now - ledStartMs >= LED_PULSE_MS)
  ) {

    digitalWrite(
      PIN_LED_STATUS,
      LOW
    );

    ledActive = false;
  }

  // SD com erro:
  // pisca lentamente.
  if (
    !sdReady &&
    !ledActive
  ) {

    digitalWrite(
      PIN_LED_STATUS,
      ((now / 500) % 2 == 0)
        ? HIGH
        : LOW
    );
  }
}

// =====================================================
// LOG
// =====================================================

void appendLog(
  const char *inputId,
  const char *eventName,
  const char *state,
  const char *level = "INFO",
  const char *expected = "",
  const char *result = "OK",
  const char *possibleCause = ""
) {

  char timestamp[32];

  getRtcTimestamp(
    timestamp,
    sizeof(timestamp)
  );

  // Deixamos espaço para crescer o protocolo
  char payload[512];

  int written =
    snprintf(
      payload,
      sizeof(payload),

      "{"
      "\"loggerId\":\"%s\","
      "\"timestamp\":\"%s\","
      "\"level\":\"%s\","
      "\"event\":\"%s\","
      "\"signal\":\"%s\","
      "\"expected\":\"%s\","
      "\"received\":\"%s\","
      "\"result\":\"%s\","
      "\"possibleCause\":\"%s\""
      "}",

      LOGGER_ID,
      timestamp,
      level,
      eventName,
      inputId,
      expected,
      state,
      result,
      possibleCause
    );

  if (
    written < 0 ||
    written >= (int) sizeof(payload)
  ) {

    Serial.println(
      "[ERRO] Payload excedeu o buffer."
    );

    return;
  }

  // -------------------------------------------------
  // Serial
  // -------------------------------------------------

  Serial.println(payload);

  // -------------------------------------------------
  // SD
  // -------------------------------------------------

  if (!sdReady) {
    return;
  }

  File file =
    SD.open(
      LOG_FILE,
      FILE_APPEND
    );

  if (!file) {

    Serial.println(
      "[ERRO] SD: falha ao abrir logs.jsonl"
    );

    sdReady = false;

    return;
  }

  size_t saved = file.println(payload);

  file.close();

  if (saved != strlen(payload) + 2) {
    Serial.println("[SD] erro de escrita; evento nao transmitido");
    sdReady = false;
    return;
  }
  enqueueDurable(payload);

  triggerStatusLed();
}

// =====================================================
// RTC INIT
// =====================================================

void testRTC() {

  Wire.beginTransmission(
    RTC_ADDRESS
  );

  if (
    Wire.endTransmission() == 0
  ) {

    Serial.println(
      "[OK] RTC detectado em 0x68"
    );

    char timestamp[32];

    getRtcTimestamp(
      timestamp,
      sizeof(timestamp)
    );

    Serial.print(
      "[RTC] "
    );

    Serial.println(
      timestamp
    );

  } else {

    Serial.println(
      "[AVISO] RTC nao encontrado."
    );

    Serial.println(
      "[AVISO] Usando NTP ou data de compilacao + uptime ate sincronizar."
    );
  }
}

// =====================================================
// SD INIT
// =====================================================

void initSD() {

  SPI.begin(
    PIN_SD_SCK,
    PIN_SD_MISO,
    PIN_SD_MOSI,
    PIN_SD_CS
  );

  Serial.println(
    "[SD] Inicializando..."
  );

  sdReady =
    SD.begin(
      PIN_SD_CS,
      SPI
    );

  if (sdReady) {

    Serial.println(
      "[OK] Cartao SD montado."
    );

  } else {

    Serial.println(
      "[ERRO] Falha ao montar SD."
    );
  }
}

// =====================================================
// INPUT INIT
// =====================================================

void initInputs() {

  for (
    int i = 0;
    i < CHANNEL_COUNT;
    i++
  ) {

    // Pull-up externo 10k
    pinMode(
      channels[i].pin,
      INPUT
    );

    channels[i].stableState =
      digitalRead(
        channels[i].pin
      );

    channels[i].lastReading =
      channels[i].stableState;

    channels[i].lastChangeMs =
      millis();
  }
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(300);

  Serial.println();
  Serial.println(
    "======================================"
  );

  Serial.println(
    " LOG AUTOMOTIVO - LOGGER ESP32"
  );

  Serial.println(
    "======================================"
  );

  pinMode(
    PIN_LED_STATUS,
    OUTPUT
  );

  digitalWrite(
    PIN_LED_STATUS,
    LOW
  );

  // Entradas
  initInputs();

  // RTC
  Wire.begin(
    PIN_RTC_SDA,
    PIN_RTC_SCL
  );

  testRTC();

  // SD
  initSD();

  initNetwork();

  // Evento inicial
  appendLog(
    "SYS",
    "LOGGER_BOOT",
    "READY",
    "INFO",
    "",
    "OK",
    ""
  );

  Serial.println(
    "[LOGGER] Pronto."
  );
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  unsigned long now =
    millis();

  // -------------------------------------------------
  // LED
  // -------------------------------------------------

  updateStatusLed(now);

  // -------------------------------------------------
  // ENTRADAS
  // -------------------------------------------------

  for (
    int i = 0;
    i < CHANNEL_COUNT;
    i++
  ) {

    InputChannel &ch =
      channels[i];

    int reading =
      digitalRead(
        ch.pin
      );

    // Mudança física detectada
    if (
      reading !=
      ch.lastReading
    ) {

      ch.lastChangeMs =
        now;

      ch.lastReading =
        reading;
    }

    // Estado permaneceu estável
    if (
      (now - ch.lastChangeMs >= DEBOUNCE_MS)
      &&
      reading != ch.stableState
    ) {

      ch.stableState =
        reading;

      const char *state =
        (ch.stableState == LOW)
          ? "ACTIVE"
          : "RELEASED";

      appendLog(
        ch.id,
        ch.event,
        state
      );
    }
  }

  updateNetwork(now);
  delay(1);
}
