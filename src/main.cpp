/*
  Copyright (c) 2025 Zofia Zimnol
  Wszelkie prawa zastrzeżone.
*/

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <WiFi.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>
#include <ESP32CAN.h>
#include <CAN_config.h>

#define CAN_RX GPIO_NUM_5
#define CAN_TX GPIO_NUM_19
#define CAN_SPEED CAN_SPEED_100KBPS

CAN_device_t CAN_cfg;
StaticJsonDocument<4096> rulesDoc;
StaticJsonDocument<4096> userDbDoc;
String notesTxt;

AsyncWebServer server(80);
AsyncWebSocket ws("/sniff");

struct RuleState { uint8_t cnt; uint32_t t0; };
RuleState rs[32];

/* ---------- pliki SPIFFS ---------- */
bool loadJson(const char* p, JsonDocument& d) {
  File f = SPIFFS.open(p, "r");
  if (!f) return false;
  auto err = deserializeJson(d, f);
  f.close();
  return !err;
}
void saveJson(const char* p, const JsonDocument& d) {
  File f = SPIFFS.open(p, "w");
  serializeJson(d, f);
  f.close();
}
void loadNotes() {
  File f = SPIFFS.open("/notes.txt", "r");
  if (f) { notesTxt = f.readString(); f.close(); }
}
void saveNotes(const String& s) {
  File f = SPIFFS.open("/notes.txt", "w");
  f.print(s); f.close();
  notesTxt = s;
}

/* ---------- wysyłanie sekwencji ---------- */
void sendSeq(JsonArray seq) {
  for (JsonObject fr : seq) {
    CAN_frame_t tx_frame{};
    tx_frame.FIR.B.FF = CAN_frame_std;

    uint8_t len = fr["len"] | 8;
    if (len > 8) len = 8;
    tx_frame.FIR.B.DLC = len;
    tx_frame.MsgID = strtoul(fr["id"] | "0x0", nullptr, 16);

    memset(tx_frame.data.u8, 0, 8);

    // NEW: obsługa dwóch formatów danych
    if (fr["data"].is<const char*>()) {
      const char* dstr = fr["data"];
      for (uint8_t i = 0; i < len; i++) {
        tx_frame.data.u8[i] = strtoul(&dstr[i * 3], nullptr, 16);
      }
    } else if (fr["data"].is<JsonArray>()) {
      JsonArray arr = fr["data"].as<JsonArray>();
      for (uint8_t i = 0; i < len && i < arr.size(); i++) {
        tx_frame.data.u8[i] = (uint8_t)(arr[i] | 0);
      }
    }

    uint16_t rep = fr["repeat"] | 1;
    uint32_t gap = fr["gap_ms"] | 0;
    uint32_t hold = fr["hold_ms"] | 0;

    for (uint16_t r = 0; r < rep; r++) {
      ESP32Can.CANWriteFrame(&tx_frame);
      if (gap) delay(gap);
    }
    if (hold) delay(hold);
  }
}

/* ---------- push do WebSocket ---------- */
void pushFrame(uint32_t id, uint8_t len, const uint8_t* d) {
  if (!g_sniffing) return;
  if (!ws.count()) return;

  StaticJsonDocument<128> j;
  j["ts"] = millis();
  j["id"] = id;

  char buf[3*8 + 1] = {0};                 // 25 bajtów
  for (uint8_t i = 0; i < len && i < 8; i++) {
    sprintf(&buf[i * 3], "%02X ", d[i]);
  }
  if (len) buf[len*3 - 1] = '\0';          // usuń ostatnią spację

  j["data"] = buf;

  char out[160];
  serializeJson(j, out);
  ws.textAll(out);
}

/* ---------- CAN ---------- */
void handleCAN() {
  CAN_frame_t rx_frame;
  while (xQueueReceive(CAN_cfg.rx_queue, &rx_frame, 0) == pdTRUE) {
    pushFrame(rx_frame.MsgID, rx_frame.FIR.B.DLC, rx_frame.data.u8);
    uint32_t now = millis();
    uint8_t idx = 0;
    for (JsonObject rule : rulesDoc["rules"].as<JsonArray>()) {
      if (idx >= 32) break;
      uint32_t tid = strtoul(rule["trigger"]["id"], nullptr, 16);
      if (rx_frame.MsgID != tid) { idx++; continue; }
      bool hit = true;
      const char* tdata = rule["trigger"]["data"];
      const char* tmask = rule["trigger"]["mask"];
      for (uint8_t i = 0; i < rx_frame.FIR.B.DLC && hit; i++) {
        uint8_t td = strtoul(&tdata[i * 3], nullptr, 16);
        uint8_t mk = strtoul(&tmask[i * 3], nullptr, 16);
        if ((rx_frame.data.u8[i] & mk) != (td & mk)) hit = false;
      }
      if (!hit) { idx++; continue; }
      uint8_t need = rule["trigger"]["count"] | 1;
      uint16_t win = rule["trigger"]["window_ms"] | 500;
      RuleState& s = rs[idx];
      if (now - s.t0 > win) { s.cnt = 0; s.t0 = now; }
      if (++s.cnt >= need) {
        sendSeq(rule["action"]["sequence"].as<JsonArray>());
        s.cnt = 0;
      }
      idx++;
    }
  }
}

void setup() {
  Serial.begin(115200);
  SPIFFS.begin(true);

  loadJson("/config.json", rulesDoc);
  loadJson("/userdb.json", userDbDoc);
  loadNotes();

  CAN_cfg.speed = CAN_SPEED_100KBPS;
  CAN_cfg.tx_pin_id = CAN_TX;
  CAN_cfg.rx_pin_id = CAN_RX;
  CAN_cfg.rx_queue = xQueueCreate(32, sizeof(CAN_frame_t));
  ESP32Can.CANInit();

  WiFi.softAP("CanFlex", "12345678");

  server.on("/cfg", HTTP_GET, [](AsyncWebServerRequest* r) {
    String o; serializeJsonPretty(rulesDoc, o);
    r->send(200, "application/json", o);
  });

 server.on("/cfg", HTTP_POST,
  [](AsyncWebServerRequest* r){ },
  nullptr,
  [](AsyncWebServerRequest* r, uint8_t* data, size_t len, size_t index, size_t total){
    static String body;
    if (index == 0) body = "";
    body.reserve(total);
    body.concat((const char*)data, len);
    if (index + len == total) {
      DeserializationError err = deserializeJson(rulesDoc, body);
      if (err) { r->send(400, "application/json", "{\"error\":\"bad json\"}"); return; }
      saveJson("/config.json", rulesDoc);
      r->send(200, "application/json", "{\"ok\":true}");
    }
  }
);


  server.on("/userdb", HTTP_GET, [](AsyncWebServerRequest* r) {
    String o; serializeJsonPretty(userDbDoc, o);
    r->send(200, "application/json", o);
  });

  server.on("/userdb", HTTP_POST, [](AsyncWebServerRequest* r) {
    if (!r->hasParam("plain", true)) { r->send(400); return; }
    deserializeJson(userDbDoc, r->getParam("plain", true)->value());
    saveJson("/userdb.json", userDbDoc);
    r->send(200, "text/plain", "OK");
  });

  server.on("/notes", HTTP_GET, [](AsyncWebServerRequest* r) {
    r->send(200, "text/plain", notesTxt);
  });

  server.on("/notes", HTTP_POST, [](AsyncWebServerRequest* r) {
    if (!r->hasParam("plain", true)) { r->send(400); return; }
    saveNotes(r->getParam("plain", true)->value());
    r->send(200, "text/plain", "OK");
  });

  server.on("/tx", HTTP_POST, [](AsyncWebServerRequest* r) {
    if (!r->hasParam("plain", true)) { r->send(400); return; }
    StaticJsonDocument<128> j;
    if (deserializeJson(j, r->getParam("plain", true)->value())) { r->send(400); return; }
    CAN_frame_t tx_frame;
    tx_frame.FIR.B.FF = CAN_frame_std;
    tx_frame.MsgID = strtoul(j["id"] | "0x0", nullptr, 16);
    tx_frame.FIR.B.DLC = j["len"] | 8;
    memset(tx_frame.data.u8, 0, 8);
    const char* ds = j["data"] | "00";
    for (uint8_t i = 0; i < tx_frame.FIR.B.DLC && i < 8; i++)
      tx_frame.data.u8[i] = strtoul(&ds[i * 3], nullptr, 16);
    uint16_t rep = j["repeat"] | 1;
    for (uint16_t k = 0; k < rep; k++)
      ESP32Can.CANWriteFrame(&tx_frame);
    r->send(200, "text/plain", "sent");
  });

  server.on("/show", HTTP_POST, [](AsyncWebServerRequest* r) {
    StaticJsonDocument<256> seq;
    auto a = seq.to<JsonArray>();
    JsonObject fr = a.createNestedObject();
    fr["id"] = "0x188"; fr["data"] = "FF 00 00 00 00 00 00 00"; fr["repeat"] = 2;
    sendSeq(a);
    r->send(200, "text/plain", "Show mode done!");
  });

  server.on("/sniff/start", HTTP_POST, [](AsyncWebServerRequest* r){
  g_sniffing = true;
  r->send(200, "application/json", "{\"ok\":true}");
});

server.on("/sniff/stop", HTTP_POST, [](AsyncWebServerRequest* r){
  g_sniffing = false;
  r->send(200, "application/json", "{\"ok\":true}");
});

  ws.onEvent([](AsyncWebSocket* server, AsyncWebSocketClient* client, AwsEventType type, void* arg, uint8_t* data, size_t len) { });

  server.addHandler(&ws);
  server.serveStatic("/", SPIFFS, "/").setDefaultFile("index.html");
  server.begin();
  Serial.println("HTTP server started");
}

void loop() {
  handleCAN();
  ws.cleanupClients();
}
