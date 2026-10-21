from app.ship_store import ShipStore

NOW = 1000000.0


def test_new_ship_from_position_report():
    store = ShipStore()
    store.update_position(235000001, 57.14, -2.07, 10.5, 90.0, 88, NOW)

    ships = store.all_ships()
    assert len(ships) == 1
    ship = ships[0]
    assert ship["mmsi"] == 235000001
    assert ship["lat"] == 57.14
    assert ship["sog"] == 10.5
    assert ship["name"] is None
    assert ship["last_seen"] == NOW


def test_static_data_fills_in_name_without_losing_position():
    store = ShipStore()
    store.update_position(235000001, 57.14, -2.07, 10.5, 90.0, 88, NOW)
    store.update_static(235000001, "NORTHERN STAR       ", 70, "ABERDEEN", NOW + 5)

    ship = store.all_ships()[0]
    assert ship["name"] == "NORTHERN STAR"
    assert ship["ship_type"] == 70
    assert ship["lat"] == 57.14
    assert ship["last_seen"] == NOW + 5


def test_position_update_keeps_name():
    store = ShipStore()
    store.update_static(235000001, "NORTHERN STAR", 70, "ABERDEEN", NOW)
    store.update_position(235000001, 57.20, -2.00, 12.0, 45.0, 44, NOW + 10)

    ship = store.all_ships()[0]
    assert ship["name"] == "NORTHERN STAR"
    assert ship["lat"] == 57.20
    assert ship["cog"] == 45.0


def test_ship_without_position_is_stored_but_not_drawn():
    store = ShipStore()
    store.update_static(235000002, "NO POSITION YET", 60, "LERWICK", NOW)

    assert store.count() == 1
    assert store.all_ships() == []


def test_blank_name_becomes_none():
    store = ShipStore()
    store.update_static(235000003, "     ", 30, "", NOW)
    store.update_position(235000003, 57.0, -2.0, 0.0, 0.0, 0, NOW)

    assert store.all_ships()[0]["name"] is None


def test_remove_stale_ships():
    store = ShipStore()
    store.update_position(1, 57.0, -2.0, 5.0, 0.0, 0, NOW)
    store.update_position(2, 57.1, -2.1, 5.0, 0.0, 0, NOW + 900)

    removed = store.remove_stale(now=NOW + 901, max_age=900)

    assert removed == 1
    assert [s["mmsi"] for s in store.all_ships()] == [2]


def test_two_ships_are_kept_separate():
    store = ShipStore()
    store.update_position(1, 57.0, -2.0, 5.0, 0.0, 0, NOW)
    store.update_position(2, 57.5, -1.5, 8.0, 180.0, 180, NOW)

    assert store.count() == 2
