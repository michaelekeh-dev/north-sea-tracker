# North Sea Tracker

A live map of the ships around Aberdeen harbour and the North Sea, built from real AIS radio data.

## How it works

```
Ships -> AIS Stream -> my server (FastAPI) -> browser (Leaflet map)
```

Ships broadcast their position, speed and name over AIS radio, and [AIS Stream](https://aisstream.io/) collects those messages and sends them out over a WebSocket. My server subscribes to a box covering Aberdeen and the nearby North Sea, and the listener turns each message into an update in the ship store. The store keeps one record per ship, merging the frequent position reports with the less frequent messages that carry the name, type and destination. Every 2 seconds the server sends the full list of ships to every open browser, and the map animates each ship from its old position to its new one.

The browser doesn't connect to AIS Stream directly because that would mean putting my API key in the page's JavaScript, where anyone could copy it. Going through my server keeps the key hidden, and it also means there's only ever one connection to AIS Stream, however many people have the map open.

## Decisions I made

- **Ships are stored by MMSI.** Every ship has a unique 9-digit radio ID, so I use it as the key in a dictionary. Position reports and static data messages for the same ship arrive at different times, and keying both by MMSI is what lets me merge them into one record. A dictionary lookup is also instant, however many ships there are.
- **Ships are dropped after 15 minutes of silence.** If a ship sails out of the box or turns its transponder off, it would otherwise stay on the map forever in its last position. 15 minutes is long enough that a ship with a patchy signal doesn't keep vanishing and coming back.
- **The server pushes every 2 seconds instead of on every message.** Around Aberdeen there can be dozens of messages a second. Sending each one to the browser would mean a lot of tiny redraws for no visible benefit, so the browser gets one snapshot every 2 seconds and smooths the movement in between.
- **"Not available" values become None.** AIS uses placeholder numbers when it doesn't know something, like 511 for heading or 102.3 knots for speed. Without handling those, ships would point the wrong way or show up as the fastest thing on the map.

## What I'd do next

- Save positions to a database so you can replay where ships went over the past day
- Let you filter the map by ship type (only tankers, only supply boats, etc.)
- Show which oil and gas fields the supply boats are heading to

## Run it locally

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # then paste your AIS Stream key into .env
python -m pytest                # all tests should pass
uvicorn app.main:app --reload
```

Open http://localhost:8000. Set `DEMO_MODE=1` in `.env` to see fake ships without a key
(the page shows a "DEMO DATA" badge).

## Tech

Python, FastAPI, WebSockets, pytest, Leaflet, deployed on Render. Ship data from [AIS Stream](https://aisstream.io/).
Map tiles from Esri and OpenStreetMap contributors.
