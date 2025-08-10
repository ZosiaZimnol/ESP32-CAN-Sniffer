import asyncio
import json
import os
from flask import Flask, send_from_directory, request
import websockets

# --- Flask (HTTP) ---
app = Flask(__name__, static_folder="data")

@app.route('/')
def index():
    return send_from_directory("data", "index.html")

@app.route('/favicon.ico')
def favicon():
    return send_from_directory("data", "favicon.ico")

@app.route('/<path:path>')
def static_file(path):
    return send_from_directory("data", path)

# --- Pliki konfiguracyjne ---
rules_path = os.path.join("data", "rules.json")
notes_path = os.path.join("data", "notes.txt")

@app.route('/cfg', methods=["GET"])
def get_cfg():
    if os.path.exists(rules_path):
        with open(rules_path, "r", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "application/json"}
    return '{"rules":[]}', 200, {"Content-Type": "application/json"}

@app.route('/cfg', methods=["POST"])
def post_cfg():
    with open(rules_path, "w", encoding="utf-8") as f:
        f.write(request.data.decode("utf-8"))
    return "OK", 200

@app.route('/notes.txt', methods=["GET"])
def get_notes():
    if os.path.exists(notes_path):
        with open(notes_path, "r", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "text/plain"}
    return "", 200, {"Content-Type": "text/plain"}

@app.route('/notes.txt', methods=["POST"])
def post_notes():
    with open(notes_path, "w", encoding="utf-8") as f:
        f.write(request.data.decode("utf-8"))
    return "OK", 200

# --- WebSocket Sniffer ---
connected = set()

async def sniff_handler(websocket):
    print("[WS] Nowe połączenie WebSocket")
    connected.add(websocket)
    try:
        while True:
            msg = {
                "ts": int(asyncio.get_event_loop().time() * 1000),
                "id": 0x123,
                "data": "11 22 33 44 55 66 77 88"
            }
            await websocket.send(json.dumps(msg))
            await asyncio.sleep(1)
    except websockets.exceptions.ConnectionClosed:
        print("[WS] Połączenie zamknięte przez klienta")
    finally:
        connected.discard(websocket)

async def main_ws():
    print("[WS] Serwer WebSocket działa na ws://localhost:8765")
    try:
        async with websockets.serve(sniff_handler, "localhost", 8765):
            await asyncio.Future()
    except asyncio.CancelledError:
        print("[WS] Serwer WebSocket został anulowany.")

# --- Uruchom serwery ---
def start_servers():
    import threading
    threading.Thread(target=lambda: app.run(host='localhost', port=5000), daemon=True).start()
    print("[HTTP] Serwer działa na http://localhost:5000")
    asyncio.run(main_ws())

if __name__ == "__main__":
    start_servers()
