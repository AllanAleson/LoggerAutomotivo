#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "network_config.h"

// Only the Arduino task touches SD/RTC. HTTP runs in a separate FreeRTOS task.
struct NetworkJob { char payload[512]; uint32_t endOffset; };
struct NetworkResult { uint32_t endOffset; int status; };
QueueHandle_t eventJobs, heartbeatJobs, eventResults;
const char *OUTBOX_FILE = "/outbox.jsonl";
const char *ACK_FILE = "/sent.offset";
uint32_t sentOffset = 0, pendingEvents = 0;
bool eventInFlight = false;
bool networkReady = false;
unsigned long lastDispatch = 0, lastHeartbeat = 0;

int postJson(const char *path, const char *payload) {
  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(1500);
  http.setTimeout(2000);
  if (!http.begin(client, String(API_BASE_URL) + path)) return -1;
  http.addHeader("Content-Type", "application/json");
  int status = http.POST(String(payload));
  if (status < 200 || status >= 300) {
    Serial.printf("[HTTP] falha %d: %s\n", status,
      status > 0 ? http.getString().c_str() : HTTPClient::errorToString(status).c_str());
  }
  http.end();
  return status;
}

void networkWorker(void *) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
  unsigned long lastConnect = millis();
  bool connected = false;
  for (;;) {
    bool online = WiFi.status() == WL_CONNECTED;
    if (online && !connected) {
      Serial.printf("[WIFI] conectado - %s - API %s\n", WiFi.localIP().toString().c_str(), API_BASE_URL);
      configTime(0, 0, "pool.ntp.org");
    }
    if (!online && connected) Serial.println("[WIFI] desconectado - eventos preservados no SD");
    connected = online;
    if (!online && millis() - lastConnect >= 10000) {
      WiFi.reconnect();
      lastConnect = millis();
    }
    NetworkJob job;
    if (online && xQueueReceive(heartbeatJobs, &job, 0) == pdTRUE) {
      int status = postJson("/api/loggers/LOGGER-001/heartbeat", job.payload);
      Serial.printf("[HEARTBEAT] %s - %d\n", status == 200 ? "aceito" : "falha; nova tentativa no proximo periodo", status);
    }
    if (xQueueReceive(eventJobs, &job, pdMS_TO_TICKS(20)) == pdTRUE) {
      int status = online ? postJson("/api/events", job.payload) : -1;
      Serial.printf("[HTTP] %s - %d\n", status == 201 ? "evento enviado" : "falha - evento mantido para retry", status);
      NetworkResult result{job.endOffset, status};
      xQueueSend(eventResults, &result, portMAX_DELAY);
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void initNetwork() {
  eventJobs = xQueueCreate(1, sizeof(NetworkJob));
  heartbeatJobs = xQueueCreate(1, sizeof(NetworkJob));
  eventResults = xQueueCreate(1, sizeof(NetworkResult));
  if (!eventJobs || !heartbeatJobs || !eventResults) {
    Serial.println("[HTTP] memoria insuficiente; eventos continuam no SD");
    return;
  }
  if (sdReady) {
    File ack = SD.open(ACK_FILE);
    if (ack) {
      // Append-only, checksummed checkpoints: interrupted writes replay safely.
      while (ack.available()) {
        String line = ack.readStringUntil('\n');
        unsigned long offset, checksum;
        if (sscanf(line.c_str(), "%lu:%lu", &offset, &checksum) == 2 &&
            (uint32_t)checksum == ((uint32_t)offset ^ 0xA55AA55Au)) sentOffset = offset;
      }
      ack.close();
    }
    File outbox = SD.open(OUTBOX_FILE);
    if (outbox) {
      if (sentOffset > outbox.size()) sentOffset = 0;
      outbox.seek(sentOffset);
      while (outbox.available()) if (outbox.read() == '\n') ++pendingEvents;
      outbox.close();
    }
  }
  Serial.printf("[FILA] %lu eventos pendentes\n", (unsigned long)pendingEvents);
  if (xTaskCreate(networkWorker, "logger-http", 8192, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("[HTTP] falha ao criar tarefa; eventos continuam no SD");
    return;
  }
  lastHeartbeat = millis() - HEARTBEAT_MS;
  lastDispatch = millis() - RETRY_MS;
  networkReady = true;
}

void enqueueDurable(const char *payload) {
  File outbox = SD.open(OUTBOX_FILE, FILE_APPEND);
  if (!outbox) {
    Serial.println("[FILA] falha ao abrir outbox; evento preservado em logs.jsonl");
    return;
  }
  size_t written = outbox.println(payload);
  outbox.close();
  if (written == strlen(payload) + 2) {
    ++pendingEvents;
    Serial.printf("[FILA] salvo no SD; pendentes=%lu\n", (unsigned long)pendingEvents);
  } else Serial.println("[FILA] erro de escrita; conferir SD e logs.jsonl");
}

void updateNetwork(unsigned long now) {
  if (!networkReady) return;
  NetworkResult result;
  if (xQueueReceive(eventResults, &result, 0) == pdTRUE) {
    if (result.status == 201) {
      // Persist only after acceptance. A lost acknowledgement may replay an event.
      File ack = SD.open(ACK_FILE, FILE_APPEND);
      if (ack) {
        char checkpoint[48];
        snprintf(checkpoint, sizeof(checkpoint), "\n%lu:%lu\n", (unsigned long)result.endOffset,
          (unsigned long)(result.endOffset ^ 0xA55AA55Au));
        size_t written = ack.print(checkpoint);
        ack.close();
        if (written == strlen(checkpoint)) { sentOffset = result.endOffset; if (pendingEvents) --pendingEvents; }
        else Serial.println("[FILA] falha no checkpoint; evento sera reenviado");
      } else Serial.println("[FILA] falha no checkpoint; evento sera reenviado");
    }
    eventInFlight = false;
    lastDispatch = result.status == 201 ? now - RETRY_MS : now;
  }
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    char timestamp[32];
    getRtcTimestamp(timestamp, sizeof(timestamp));
    NetworkJob heartbeat{};
    snprintf(heartbeat.payload, sizeof(heartbeat.payload),
      "{\"timestamp\":\"%s\",\"firmwareVersion\":\"%s\",\"batteryVoltage\":%.1f,\"pendingEvents\":%lu}",
      timestamp, FIRMWARE_VERSION, DEMO_BATTERY_VOLTAGE, (unsigned long)min(pendingEvents, (uint32_t)1000000));
    xQueueOverwrite(heartbeatJobs, &heartbeat);
    lastHeartbeat = now;
  }
  if (!sdReady || eventInFlight || !pendingEvents || now - lastDispatch < RETRY_MS || WiFi.status() != WL_CONNECTED) return;
  File outbox = SD.open(OUTBOX_FILE);
  if (!outbox || !outbox.seek(sentOffset)) { if (outbox) outbox.close(); return; }
  NetworkJob job{};
  size_t length = outbox.readBytesUntil('\n', job.payload, sizeof(job.payload) - 1);
  job.endOffset = outbox.position();
  outbox.close();
  if (!length || job.payload[length - 1] != '\r') {
    Serial.println("[FILA] registro incompleto; mantido no SD para recuperacao");
    lastDispatch = now;
    return;
  }
  job.payload[length - 1] = '\0';
  eventInFlight = xQueueSend(eventJobs, &job, 0) == pdTRUE;
  lastDispatch = now;
}
