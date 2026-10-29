# Main server. Runs the AIS listener in the background and sends
# the ships to the browser over a websocket.
# Run with: uvicorn app.main:app --reload

import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from app.ais_listener import run_listener
from app.demo_feed import run_demo_feed
from app.ship_store import ShipStore

load_dotenv()

API_KEY = os.getenv("AISSTREAM_API_KEY")
DEMO_MODE = os.getenv("DEMO_MODE") == "1"
PUSH_EVERY_SECONDS = 2
CLEANUP_EVERY_SECONDS = 60

store = ShipStore()
started_at = time.time()


async def cleanup_loop():
    # remove old ships every minute
    while True:
        await asyncio.sleep(CLEANUP_EVERY_SECONDS)
        removed = store.remove_stale(time.time())
        if removed > 0:
            print("Removed", removed, "stale ships")


async def feed():
    if DEMO_MODE:
        print("Demo mode on, using fake ships")
        await run_demo_feed(store)
    elif not API_KEY:
        print("No AISSTREAM_API_KEY set. Add it to .env or set DEMO_MODE=1")
    else:
        await run_listener(store, API_KEY)


@asynccontextmanager
async def lifespan(app):
    # start the background tasks when the server starts
    feed_task = asyncio.create_task(feed())
    cleanup_task = asyncio.create_task(cleanup_loop())
    yield
    # stop them when it shuts down
    feed_task.cancel()
    cleanup_task.cancel()


app = FastAPI(title="North Sea Tracker", lifespan=lifespan)


def snapshot():
    return {
        "demo": DEMO_MODE,
        "server_time": time.time(),
        "ships": store.all_ships(),
    }


@app.get("/ships")
def get_ships():
    return snapshot()


@app.get("/health")
def health():
    uptime = round(time.time() - started_at)
    return {"ok": True, "uptime_seconds": uptime, "ships": store.count()}


@app.websocket("/ws")
async def ships_socket(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json(snapshot())
            await asyncio.sleep(PUSH_EVERY_SECONDS)
    except (WebSocketDisconnect, RuntimeError):
        pass  # browser closed


# serve the map page (has to go last)
static_folder = Path(__file__).parent.parent / "static"
app.mount("/", StaticFiles(directory=static_folder, html=True), name="static")
