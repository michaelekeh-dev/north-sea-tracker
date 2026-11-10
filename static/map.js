// Draws the ships from the server onto a Leaflet map

const HARBOUR = [57.143, -2.075];
const ANIMATE_MS = 1900; // just under the 2 second update

// ship colours by AIS type number
const CATEGORIES = [
  { name: "Cargo", color: "#3ddc97" },
  { name: "Tanker", color: "#f5a524" },
  { name: "Passenger", color: "#4ea8ff" },
  { name: "Tug/service", color: "#c084fc" },
  { name: "Fishing", color: "#f472b6" },
  { name: "Other", color: "#cbd5e1" },
];

function getCategory(type) {
  if (type == null) return CATEGORIES[5];
  if (type >= 70 && type <= 79) return CATEGORIES[0];
  if (type >= 80 && type <= 89) return CATEGORIES[1];
  if (type >= 60 && type <= 69) return CATEGORIES[2];
  if (type == 31 || type == 32 || (type >= 50 && type <= 59)) return CATEGORIES[3];
  if (type == 30) return CATEGORIES[4];
  return CATEGORIES[5];
}

// map setup
const map = L.map("map", { zoomControl: false }).setView([57.25, -1.75], 9);
L.control.zoom({ position: "bottomright" }).addTo(map);

// dark map from Esri, with place names on top
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
}).addTo(map);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
}).addTo(map);

// legend
let legendHtml = "";
for (let i = 0; i < CATEGORIES.length; i++) {
  legendHtml += '<span><i style="background:' + CATEGORIES[i].color + '"></i>' + CATEGORIES[i].name + "</span>";
}
document.getElementById("legend").innerHTML = legendHtml;

// ships
const markers = {}; // mmsi -> { marker, from, to, start, ship }
let selected = null;

function isMoving(ship) {
  return ship.sog != null && ship.sog > 0.5;
}

function makeIcon(ship) {
  const color = getCategory(ship.ship_type).color;
  let angle = 0;
  if (ship.cog != null) angle = ship.cog;

  // arrow if moving, dot if not
  let shape;
  if (isMoving(ship)) {
    shape = '<path d="M11 2 L17 19 L11 15 L5 19 Z" fill="' + color + '"/>';
  } else {
    shape = '<circle cx="11" cy="11" r="5" fill="' + color + '"/>';
  }

  let className = "ship";
  if (selected == ship.mmsi) className = "ship selected";

  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    html: '<div class="' + className + '">' +
          '<svg width="22" height="22" viewBox="0 0 22 22" style="transform: rotate(' + angle + 'deg)">' + shape + "</svg>" +
          "</div>",
  });
}

function updateShip(ship, now) {
  const pos = [ship.lat, ship.lon];

  if (markers[ship.mmsi] == undefined) {
    // new ship
    const marker = L.marker(pos, { icon: makeIcon(ship) }).addTo(map);
    marker.on("click", function () {
      openPanel(ship.mmsi);
    });
    markers[ship.mmsi] = { marker: marker, from: pos, to: pos, start: now, ship: ship };
  } else {
    // ship we already have, slide it from where it is now to the new spot
    const entry = markers[ship.mmsi];
    const current = entry.marker.getLatLng();
    entry.from = [current.lat, current.lng];
    entry.to = pos;
    entry.start = now;

    // if only the direction changed, just rotate it so it turns smoothly
    const sameLook = isMoving(entry.ship) == isMoving(ship) && entry.ship.ship_type == ship.ship_type;
    if (sameLook) {
      let angle = 0;
      if (ship.cog != null) angle = ship.cog;
      entry.marker.getElement().querySelector("svg").style.transform = "rotate(" + angle + "deg)";
    } else {
      entry.marker.setIcon(makeIcon(ship));
    }
    entry.ship = ship;
  }
}

function animate(now) {
  for (const mmsi in markers) {
    const entry = markers[mmsi];
    let t = (now - entry.start) / ANIMATE_MS;
    if (t > 1) t = 1;
    const lat = entry.from[0] + (entry.to[0] - entry.from[0]) * t;
    const lon = entry.from[1] + (entry.to[1] - entry.from[1]) * t;
    entry.marker.setLatLng([lat, lon]);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// info panel
const panel = document.getElementById("panel");

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

// distance in nautical miles (haversine formula)
function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // earth radius in nautical miles
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function timeAgo(seconds) {
  if (seconds < 60) return Math.round(seconds) + " s ago";
  return Math.round(seconds / 60) + " min ago";
}

let serverOffset = 0; // difference between server and browser clocks

function fillPanel() {
  const entry = markers[selected];
  if (entry == undefined) return;
  const s = entry.ship;
  const category = getCategory(s.ship_type);

  setText("p-type", category.name);
  document.getElementById("p-type").style.color = category.color;
  setText("p-name", s.name || "Unknown vessel");
  setText("p-mmsi", s.mmsi);

  if (s.sog != null) {
    const kmh = s.sog * 1.852;
    setText("p-speed", s.sog.toFixed(1) + " kn (" + kmh.toFixed(0) + " km/h)");
  } else {
    setText("p-speed", "-");
  }

  if (s.cog != null) {
    setText("p-course", Math.round(s.cog) + " deg");
  } else {
    setText("p-course", "-");
  }

  setText("p-dest", s.destination || "-");
  setText("p-dist", distanceNm(s.lat, s.lon, HARBOUR[0], HARBOUR[1]).toFixed(1) + " nm");
  setText("p-seen", timeAgo(Date.now() / 1000 + serverOffset - s.last_seen));
}

function openPanel(mmsi) {
  const previous = selected;
  selected = mmsi;

  // redraw the old and new ship so the highlight moves
  if (markers[previous] != undefined) {
    markers[previous].marker.setIcon(makeIcon(markers[previous].ship));
  }
  if (markers[mmsi] != undefined) {
    markers[mmsi].marker.setIcon(makeIcon(markers[mmsi].ship));
  }

  fillPanel();
  panel.classList.add("open");
}

function closePanel() {
  const entry = markers[selected];
  selected = null;
  if (entry != undefined) {
    entry.marker.setIcon(makeIcon(entry.ship));
  }
  panel.classList.remove("open");
}

document.getElementById("panel-close").onclick = closePanel;

// stats at the top
function updateStats(ships) {
  let moving = 0;
  let fastest = null;

  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (isMoving(s)) moving++;
    if (s.sog != null && (fastest == null || s.sog > fastest)) {
      fastest = s.sog;
    }
  }

  setText("stat-count", ships.length);
  setText("stat-moving", moving);
  if (fastest != null) {
    setText("stat-fastest", fastest.toFixed(1));
  } else {
    setText("stat-fastest", "-");
  }
}

function setStatus(live, text) {
  const dot = document.getElementById("status-dot");
  if (live) {
    dot.classList.add("live");
  } else {
    dot.classList.remove("live");
  }
  setText("status-text", text);
}

// websocket connection to the server
function connect() {
  let protocol = "ws";
  if (location.protocol == "https:") protocol = "wss";
  const ws = new WebSocket(protocol + "://" + location.host + "/ws");

  ws.onopen = function () {
    setStatus(true, "Live");
  };

  ws.onmessage = function (event) {
    const data = JSON.parse(event.data);
    serverOffset = data.server_time - Date.now() / 1000;
    document.getElementById("demo-badge").hidden = !data.demo;

    const now = performance.now();
    const stillHere = {};
    for (let i = 0; i < data.ships.length; i++) {
      updateShip(data.ships[i], now);
      stillHere[data.ships[i].mmsi] = true;
    }

    // remove ships the server doesn't have any more
    for (const mmsi in markers) {
      if (!stillHere[mmsi]) {
        map.removeLayer(markers[mmsi].marker);
        delete markers[mmsi];
        if (selected == mmsi) closePanel();
      }
    }

    updateStats(data.ships);
    if (selected != null) fillPanel();
  };

  ws.onclose = function () {
    setStatus(false, "Reconnecting...");
    setTimeout(connect, 3000);
  };
}

connect();
