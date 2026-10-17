# Keeps one record for each ship, using its MMSI as the key.
# Position messages and static messages (name, type, destination)
# come in separately so they get merged into the same record.

STALE_AFTER_SECONDS = 15 * 60  # 15 minutes


class ShipStore:
    def __init__(self):
        self.ships = {}  # mmsi -> ship dict

    def get_ship(self, mmsi):
        # make a blank record if we haven't seen this ship before
        if mmsi not in self.ships:
            self.ships[mmsi] = {
                "mmsi": mmsi,
                "name": None,
                "lat": None,
                "lon": None,
                "sog": None,  # speed in knots
                "cog": None,  # course in degrees
                "heading": None,
                "ship_type": None,
                "destination": None,
                "last_seen": None,
            }
        return self.ships[mmsi]

    def update_position(self, mmsi, lat, lon, sog, cog, heading, now):
        ship = self.get_ship(mmsi)
        ship["lat"] = lat
        ship["lon"] = lon
        ship["sog"] = sog
        ship["cog"] = cog
        ship["heading"] = heading
        ship["last_seen"] = now

    def update_static(self, mmsi, name, ship_type, destination, now):
        ship = self.get_ship(mmsi)
        ship["name"] = clean_text(name)
        ship["ship_type"] = ship_type
        ship["destination"] = clean_text(destination)
        ship["last_seen"] = now

    def remove_stale(self, now, max_age=STALE_AFTER_SECONDS):
        # can't delete from a dict while looping over it,
        # so find the old ones first then delete them
        old_ships = []
        for mmsi in self.ships:
            if now - self.ships[mmsi]["last_seen"] > max_age:
                old_ships.append(mmsi)

        for mmsi in old_ships:
            del self.ships[mmsi]

        return len(old_ships)

    def all_ships(self):
        # only return ships that have a position
        result = []
        for ship in self.ships.values():
            if ship["lat"] is not None and ship["lon"] is not None:
                result.append(ship)
        return result

    def count(self):
        return len(self.ships)


def clean_text(text):
    # AIS pads names with spaces, so strip them
    if text is None:
        return None
    text = text.strip()
    if text == "":
        return None
    return text
