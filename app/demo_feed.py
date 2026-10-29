# Fake ships so the map can be tested without an API key.
# Turn on with DEMO_MODE=1 in .env

import asyncio
import math
import random
import time

HARBOUR = (57.143, -2.075)

FAKE_SHIPS = [
    # mmsi, name, type, destination
    (900000001, "DEMO SUPPLY ONE", 90, "FORTIES"),
    (900000002, "DEMO SUPPLY TWO", 90, "BRAE"),
    (900000003, "DEMO CARGO", 70, "ROTTERDAM"),
    (900000004, "DEMO TANKER", 80, "SULLOM VOE"),
    (900000005, "DEMO FERRY", 60, "LERWICK"),
    (900000006, "DEMO TUG", 52, "ABERDEEN"),
    (900000007, "DEMO STANDBY", 90, "BUZZARD"),
    (900000008, "DEMO FISHING", 30, "PETERHEAD"),
]


def move(lat, lon, course, knots, seconds):
    # 1 nautical mile = 1/60 of a degree of latitude
    miles = knots * seconds / 3600
    new_lat = lat + miles / 60 * math.cos(math.radians(course))
    new_lon = lon + miles / 60 * math.sin(math.radians(course)) / math.cos(math.radians(lat))
    return new_lat, new_lon


async def run_demo_feed(store, tick=2.0):
    random.seed(42)
    ships = []
    for mmsi, name, ship_type, destination in FAKE_SHIPS:
        ship = {
            "mmsi": mmsi,
            "lat": HARBOUR[0] + random.uniform(-0.25, 0.35),
            "lon": HARBOUR[1] + random.uniform(0.05, 0.9),
            "cog": random.uniform(0, 360),
            "sog": random.uniform(4, 14),
        }
        ships.append(ship)
        store.update_static(mmsi, name, ship_type, destination, time.time())

    while True:
        now = time.time()
        for ship in ships:
            ship["cog"] = (ship["cog"] + random.uniform(-4, 4)) % 360
            # times 30 so you can actually see them move
            ship["lat"], ship["lon"] = move(ship["lat"], ship["lon"], ship["cog"], ship["sog"], tick * 30)

            # turn around if they leave the area
            if ship["lat"] < 56.9 or ship["lat"] > 57.6 or ship["lon"] < -2.05 or ship["lon"] > -1.0:
                ship["cog"] = (ship["cog"] + 180) % 360

            store.update_position(ship["mmsi"], ship["lat"], ship["lon"],
                                  round(ship["sog"], 1), round(ship["cog"], 1),
                                  round(ship["cog"]), now)
        await asyncio.sleep(tick)
