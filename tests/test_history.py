from app.history import History

NOW = 1000000.0


def ship(mmsi, lat):
    return {"mmsi": mmsi, "name": "TEST", "ship_type": 70, "lat": lat, "lon": -2.0, "sog": 5.0, "cog": 90.0}


def test_frames_group_ships_by_time():
    history = History(":memory:")
    history.save([ship(1, 57.1), ship(2, 57.2)], NOW)
    history.save([ship(1, 57.15)], NOW + 15)

    frames = history.frames(NOW - 60)

    assert len(frames) == 2
    assert len(frames[0]["ships"]) == 2
    assert frames[1]["ships"][0]["lat"] == 57.15


def test_old_positions_are_deleted():
    history = History(":memory:")
    history.save([ship(1, 57.1)], NOW)
    history.save([ship(1, 57.2)], NOW + 2 * 24 * 3600)

    assert len(history.points(0)) == 1
