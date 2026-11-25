# Watches ships for anything interesting and keeps a list of recent events.
#   - a new ship turns up
#   - a ship arrives at the harbour
#   - a ship goes dark (stops broadcasting while it was moving)
#   - a ship jumps further than it could possibly sail (bad or fake GPS)

import math
import time
from collections import deque

HARBOUR = (57.143, -2.075)
MAX_EVENTS = 30
DARK_AFTER_SECONDS = 3 * 60  # moving ship that goes quiet this long
JUMP_KNOTS = 60  # nothing around here sails faster than this
JUMP_ALERT_SECONDS = 60  # how long a jump stays flagged
ARRIVED_NM = 1.0  # this close to the harbour counts as arrived
LEFT_NM = 2.0  # has to get this far away before it can arrive again


def distance_nm(lat1, lon1, lat2, lon2):
    # haversine formula, answer in nautical miles
    r = 3440.065
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def ship_name(ship):
    if ship["name"]:
        return ship["name"]
    return "MMSI " + str(ship["mmsi"])


class Watcher:
    def __init__(self):
        self.events = deque(maxlen=MAX_EVENTS)  # newest first

    def add(self, kind, ship, text, now):
        self.events.appendleft({
            "kind": kind,
            "mmsi": ship["mmsi"],
            "text": ship_name(ship) + " " + text,
            "time": now,
        })

    def check_position(self, ship, lat, lon, now):
        # called before the store saves the new position,
        # so ship still has the old one
        if ship["lat"] is None:
            self.add("new", ship, "entered the area", now)
        else:
            moved = distance_nm(ship["lat"], ship["lon"], lat, lon)
            seconds = now - ship["pos_time"]
            if seconds > 0 and moved > 1 and moved / (seconds / 3600) > JUMP_KNOTS:
                ship["alert"] = "jump"
                ship["alert_time"] = now
                self.add("jump", ship, "jumped " + str(round(moved, 1)) + " nm in "
                         + str(round(seconds)) + " s", now)
            elif ship["alert"] == "jump" and now - ship["alert_time"] > JUMP_ALERT_SECONDS:
                ship["alert"] = None

        if ship["alert"] == "dark":
            ship["alert"] = None
            self.add("back", ship, "is broadcasting again", now)

        to_harbour = distance_nm(lat, lon, HARBOUR[0], HARBOUR[1])
        if to_harbour < ARRIVED_NM and not ship["arrived"]:
            ship["arrived"] = True
            self.add("arrived", ship, "arrived at Aberdeen harbour", now)
        elif to_harbour > LEFT_NM:
            ship["arrived"] = False

    def check_dark(self, ships, now=None):
        if now is None:
            now = time.time()
        found = 0
        for ship in ships:
            moving = ship["sog"] is not None and ship["sog"] > 0.5
            quiet = now - ship["last_seen"] > DARK_AFTER_SECONDS
            if moving and quiet and ship["alert"] != "dark":
                ship["alert"] = "dark"
                self.add("dark", ship, "went dark", now)
                found += 1
        return found
