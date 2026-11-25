from app.ship_store import ShipStore
from app.watcher import Watcher, distance_nm

NOW = 1000000.0


def make_store():
    watcher = Watcher()
    return ShipStore(watcher), watcher


def test_distance_one_degree_of_latitude_is_60_nm():
    assert round(distance_nm(57.0, -2.0, 58.0, -2.0)) == 60


def test_new_ship_makes_an_event():
    store, watcher = make_store()
    store.update_position(1, 57.3, -1.5, 10.0, 90.0, 90, NOW)

    assert watcher.events[0]["kind"] == "new"


def test_impossible_jump_is_flagged():
    store, watcher = make_store()
    store.update_position(1, 57.3, -1.5, 10.0, 90.0, 90, NOW)
    # 0.4 degrees is about 24 nm in 10 seconds, way too fast
    store.update_position(1, 57.7, -1.5, 10.0, 90.0, 90, NOW + 10)

    assert store.all_ships()[0]["alert"] == "jump"
    assert watcher.events[0]["kind"] == "jump"


def test_normal_move_is_not_flagged():
    store, watcher = make_store()
    store.update_position(1, 57.3, -1.5, 10.0, 90.0, 90, NOW)
    store.update_position(1, 57.3, -1.497, 10.0, 90.0, 90, NOW + 60)

    assert store.all_ships()[0]["alert"] is None
    assert len(watcher.events) == 1  # just the "new" one


def test_moving_ship_that_goes_quiet_goes_dark():
    store, watcher = make_store()
    store.update_position(1, 57.3, -1.5, 10.0, 90.0, 90, NOW)

    assert watcher.check_dark(store.all_ships(), NOW + 200) == 1
    assert store.all_ships()[0]["alert"] == "dark"

    # and comes back when it talks again
    store.update_position(1, 57.3, -1.49, 10.0, 90.0, 90, NOW + 210)
    assert store.all_ships()[0]["alert"] is None
    assert watcher.events[0]["kind"] == "back"


def test_ship_at_anchor_does_not_go_dark():
    store, watcher = make_store()
    store.update_position(1, 57.3, -1.5, 0.0, 0.0, 0, NOW)

    assert watcher.check_dark(store.all_ships(), NOW + 600) == 0


def test_arriving_at_harbour():
    store, watcher = make_store()
    store.update_position(1, 57.2, -1.9, 8.0, 225.0, 225, NOW)
    store.update_position(1, 57.144, -2.074, 8.0, 225.0, 225, NOW + 600)

    assert watcher.events[0]["kind"] == "arrived"
    assert store.all_ships()[0]["arrived"] is True


def test_jump_alert_stays_for_a_minute():
    store, watcher = make_store()
    store.update_position(1, 57.3, -1.5, 10.0, 90.0, 90, NOW)
    store.update_position(1, 57.7, -1.5, 10.0, 90.0, 90, NOW + 10)
    store.update_position(1, 57.7, -1.497, 10.0, 90.0, 90, NOW + 30)
    assert store.all_ships()[0]["alert"] == "jump"

    store.update_position(1, 57.7, -1.49, 10.0, 90.0, 90, NOW + 120)
    assert store.all_ships()[0]["alert"] is None
