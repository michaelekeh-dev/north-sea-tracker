# Saves where every ship was every so often, so the map can replay
# the last hour and draw a heatmap of the busiest areas.

import sqlite3

KEEP_SECONDS = 24 * 60 * 60  # only keep the last day


class History:
    def __init__(self, path="history.db"):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS positions (
                t REAL, mmsi INTEGER, name TEXT, ship_type INTEGER,
                lat REAL, lon REAL, sog REAL, cog REAL
            )
        """)
        self.db.execute("CREATE INDEX IF NOT EXISTS positions_t ON positions (t)")
        self.db.commit()

    def save(self, ships, now):
        rows = []
        for s in ships:
            rows.append((now, s["mmsi"], s["name"], s["ship_type"], s["lat"], s["lon"], s["sog"], s["cog"]))
        self.db.executemany("INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
        self.db.execute("DELETE FROM positions WHERE t < ?", (now - KEEP_SECONDS,))
        self.db.commit()

    def frames(self, since):
        # one frame per save, each with every ship at that moment
        rows = self.db.execute(
            "SELECT t, mmsi, name, ship_type, lat, lon, sog, cog FROM positions WHERE t >= ? ORDER BY t",
            (since,),
        ).fetchall()

        frames = []
        for t, mmsi, name, ship_type, lat, lon, sog, cog in rows:
            if len(frames) == 0 or frames[-1]["t"] != t:
                frames.append({"t": t, "ships": []})
            frames[-1]["ships"].append({
                "mmsi": mmsi, "name": name, "ship_type": ship_type,
                "lat": lat, "lon": lon, "sog": sog, "cog": cog,
            })
        return frames

    def points(self, since):
        rows = self.db.execute("SELECT lat, lon FROM positions WHERE t >= ?", (since,)).fetchall()
        return [[lat, lon] for lat, lon in rows]
