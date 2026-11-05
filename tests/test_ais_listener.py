from app.ais_listener import handle_message
from app.ship_store import ShipStore

NOW = 1000000.0

# example messages
POSITION = {
    "MessageType": "PositionReport",
    "MetaData": {"MMSI": 235000001},
    "Message": {"PositionReport": {
        "UserID": 235000001, "Latitude": 57.2143, "Longitude": -1.8412,
        "Sog": 9.4, "Cog": 71.2, "TrueHeading": 511,
    }},
}

STATIC = {
    "MessageType": "ShipStaticData",
    "MetaData": {"MMSI": 235000001},
    "Message": {"ShipStaticData": {
        "UserID": 235000001, "Name": "DEMO SUPPLIER       ", "Type": 90,
        "Destination": "ABERDEEN    ",
    }},
}


def test_position_report_updates_store():
    store = ShipStore()
    assert handle_message(store, POSITION, NOW) == "PositionReport"

    ship = store.all_ships()[0]
    assert ship["mmsi"] == 235000001
    assert ship["lat"] == 57.2143
    assert ship["sog"] == 9.4


def test_heading_511_means_not_available():
    store = ShipStore()
    handle_message(store, POSITION, NOW)

    assert store.all_ships()[0]["heading"] is None


def test_static_data_after_position_merges():
    store = ShipStore()
    handle_message(store, POSITION, NOW)
    assert handle_message(store, STATIC, NOW + 5) == "ShipStaticData"

    ship = store.all_ships()[0]
    assert ship["name"] == "DEMO SUPPLIER"
    assert ship["destination"] == "ABERDEEN"
    assert ship["lat"] == 57.2143


def test_unknown_message_type_is_ignored():
    store = ShipStore()
    other = {"MessageType": "UnknownMessage", "Message": {"UnknownMessage": {"UserID": 1}}}

    assert handle_message(store, other, NOW) is None
    assert store.count() == 0
