# Connects to AIS Stream and puts every message into the ship store.
# Docs: https://aisstream.io/documentation

import asyncio
import json
import time

import websockets

AIS_URL = "wss://stream.aisstream.io/v0/stream"

# Aberdeen and the North Sea nearby: [[south, west], [north, east]]
BOUNDING_BOX = [[56.9, -2.5], [57.6, -1.0]]

RECONNECT_WAIT_SECONDS = 5


def get_value(body, field):
    # AIS uses these numbers to mean "not available"
    value = body.get(field)
    if field == "TrueHeading" and value == 511:
        return None
    if field == "Cog" and value == 360:
        return None
    if field == "Sog" and value == 102.3:
        return None
    return value


def handle_message(store, message, now):
    kind = message.get("MessageType")
    body = message.get("Message", {}).get(kind)
    if body is None:
        return None

    mmsi = body["UserID"]

    if kind == "PositionReport":
        # 91 and 181 mean "position not available", so don't move the ship
        if body["Latitude"] == 91 or body["Longitude"] == 181:
            return None
        store.update_position(
            mmsi,
            body["Latitude"],
            body["Longitude"],
            get_value(body, "Sog"),
            get_value(body, "Cog"),
            get_value(body, "TrueHeading"),
            now,
        )
        return kind

    if kind == "ShipStaticData":
        store.update_static(
            mmsi,
            body.get("Name"),
            body.get("Type"),
            body.get("Destination"),
            now,
        )
        return kind

    return None


async def run_listener(store, api_key):
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": [BOUNDING_BOX],
        "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
    }

    # keep reconnecting if the connection drops
    while True:
        try:
            async with websockets.connect(AIS_URL) as ws:
                # has to be sent within 3 seconds of connecting
                await ws.send(json.dumps(subscription))
                print("Connected to AIS Stream")

                async for raw in ws:
                    message = json.loads(raw)
                    handle_message(store, message, time.time())

        except asyncio.CancelledError:
            raise  # server is shutting down
        except Exception as e:
            print("AIS connection problem:", e)
            print("Reconnecting in", RECONNECT_WAIT_SECONDS, "seconds")

        await asyncio.sleep(RECONNECT_WAIT_SECONDS)
