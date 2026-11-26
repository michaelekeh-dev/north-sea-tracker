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
const darkBase = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
});
const darkLabels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
});

// real satellite photos from Esri (the "Google Earth" look)
const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 18,
  attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
});

// satellite photos by default, with the place names on top
satellite.addTo(map);
darkLabels.addTo(map);

// button to swap between the dark map and satellite
let satelliteOn = true;
const viewButton = document.getElementById("view-toggle");
viewButton.onclick = function () {
  satelliteOn = !satelliteOn;
  if (satelliteOn) {
    map.removeLayer(darkBase);
    satellite.addTo(map);
    darkLabels.bringToFront();
    viewButton.textContent = "Map view";
  } else {
    map.removeLayer(satellite);
    darkBase.addTo(map);
    darkLabels.bringToFront();
    viewButton.textContent = "Satellite view";
  }
  // the 3D view uses the same map, so update it too if it's open
  if (in3d) import("./view3d.js").then(function (view) { view.refreshStyle(); });
};

// legend
let legendHtml = "";
for (let i = 0; i < CATEGORIES.length; i++) {
  legendHtml += '<span><i style="background:' + CATEGORIES[i].color + '"></i>' + CATEGORIES[i].name + "</span>";
}
document.getElementById("legend").innerHTML = legendHtml;

// clicking a legend item hides or shows that type of ship
const hiddenTypes = {};
const legendItems = document.querySelectorAll("#legend span");
for (let i = 0; i < legendItems.length; i++) {
  legendItems[i].onclick = function () {
    const name = CATEGORIES[i].name;
    hiddenTypes[name] = !hiddenTypes[name];
    legendItems[i].classList.toggle("off", hiddenTypes[name]);
    for (const mmsi in markers) applyVisibility(markers[mmsi]);
  };
}

// pulsing marker on Aberdeen harbour
L.marker(HARBOUR, {
  interactive: false,
  icon: L.divIcon({ className: "", iconSize: [18, 18], html: '<div class="harbour"></div>' }),
}).addTo(map).bindTooltip("Aberdeen Harbour", { permanent: true, direction: "right", className: "harbour-label", offset: [10, 0] });

const TRAIL_POINTS = 25; // how many old positions to keep for the wake

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
  if (selected == ship.mmsi) className += " selected";
  if (ship.alert) className += " alert";

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
    marker.bindTooltip(ship.name || "Unknown vessel", { direction: "top", offset: [0, -10], className: "ship-label" });

    // faded line behind the ship showing where it's been
    const trail = L.polyline([pos], {
      color: getCategory(ship.ship_type).color, weight: 2, opacity: 0.35, interactive: false,
    }).addTo(map);

    markers[ship.mmsi] = { marker: marker, trail: trail, from: pos, to: pos, start: now, ship: ship };
    applyVisibility(markers[ship.mmsi]);
  } else {
    // ship we already have, slide it from where it is now to the new spot
    const entry = markers[ship.mmsi];
    const current = entry.marker.getLatLng();
    entry.from = [current.lat, current.lng];
    entry.to = pos;
    entry.start = now;

    // if only the direction changed, just rotate it so it turns smoothly
    const sameLook = isMoving(entry.ship) == isMoving(ship) && entry.ship.ship_type == ship.ship_type &&
                     entry.ship.alert == ship.alert;
    if (sameLook) {
      let angle = 0;
      if (ship.cog != null) angle = ship.cog;
      entry.marker.getElement().querySelector("svg").style.transform = "rotate(" + angle + "deg)";
    } else {
      entry.marker.setIcon(makeIcon(ship));
    }
    entry.ship = ship;

    // add the new spot to the wake, and drop the oldest ones
    let points = entry.trail.getLatLngs();
    if (ship.alert == "jump") points = []; // don't draw a line across a bad position
    points.push(L.latLng(pos));
    while (points.length > TRAIL_POINTS) points.shift();
    entry.trail.setLatLngs(points);
    entry.marker.setTooltipContent(ship.name || "Unknown vessel");
    applyVisibility(entry);
  }
}

function applyVisibility(entry) {
  const hide = hiddenTypes[getCategory(entry.ship.ship_type).name] == true;
  entry.marker.setOpacity(hide ? 0 : 1);
  entry.trail.setStyle({ opacity: hide ? 0 : 0.35 });
  const el = entry.marker.getElement();
  if (el) el.style.pointerEvents = hide ? "none" : "";
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

  const alertBox = document.getElementById("p-alert");
  if (s.alert == "dark") {
    alertBox.textContent = "Went dark: stopped broadcasting while moving";
    alertBox.hidden = false;
  } else if (s.alert == "jump") {
    alertBox.textContent = "Position jump: moved further than it could sail";
    alertBox.hidden = false;
  } else {
    alertBox.hidden = true;
  }
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

  // glide the map over to the ship
  if (markers[mmsi] != undefined) {
    map.flyTo(markers[mmsi].marker.getLatLng(), Math.max(map.getZoom(), 11), { duration: 1.2 });
  }
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

  let alerts = 0;
  for (let i = 0; i < ships.length; i++) {
    if (ships[i].alert) alerts++;
  }

  countTo("stat-count", ships.length);
  countTo("stat-moving", moving);
  countTo("stat-alerts", alerts);
  document.getElementById("stat-alerts").classList.toggle("on", alerts > 0);
  if (fastest != null) {
    setText("stat-fastest", fastest.toFixed(1));
  } else {
    setText("stat-fastest", "-");
  }
}

// numbers tick up or down instead of jumping
function countTo(id, target) {
  const el = document.getElementById(id);
  const startValue = parseInt(el.textContent) || 0;
  if (startValue == target) return;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / 600, 1);
    el.textContent = Math.round(startValue + (target - startValue) * t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
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

    latestShips = data.ships;
    updateFeed(data.events);
    updateArrivals(data.ships);
    updateStats(data.ships);
    if (replaying) return; // keep the replay on screen

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
        map.removeLayer(markers[mmsi].trail);
        delete markers[mmsi];
        if (selected == mmsi) closePanel();
      }
    }

    if (selected != null) fillPanel();
  };

  ws.onclose = function () {
    setStatus(false, "Reconnecting...");
    setTimeout(connect, 3000);
  };
}

// activity feed
let lastEventTime = 0;

function updateFeed(events) {
  if (events.length == 0) return;
  const list = document.getElementById("feed-list");
  let html = "";
  for (let i = 0; i < events.length && i < 6; i++) {
    const e = events[i];
    let className = e.kind;
    if (e.time > lastEventTime && lastEventTime != 0) className += " fresh";
    const ago = timeAgo(Date.now() / 1000 + serverOffset - e.time);
    html += '<li class="' + className + '" data-mmsi="' + e.mmsi + '"><b></b>' +
            '<span>' + e.text + '</span><small>' + ago + "</small></li>";
  }
  list.innerHTML = html;
  lastEventTime = events[0].time;
}

// clicking an event opens that ship
document.getElementById("feed-list").onclick = function (event) {
  const item = event.target.closest("li");
  if (item && markers[item.dataset.mmsi] != undefined) openPanel(Number(item.dataset.mmsi));
};

// arrivals board: ships heading for the harbour and roughly when they'll get there
function headingForHarbour(ship) {
  if (ship.destination && ship.destination.includes("ABERDEEN")) return true;
  if (ship.cog == null) return false;
  // compare its course with the direction of the harbour
  const toHarbour = Math.atan2((HARBOUR[1] - ship.lon) * Math.cos(ship.lat * Math.PI / 180),
                               HARBOUR[0] - ship.lat) * 180 / Math.PI;
  let diff = Math.abs(((ship.cog - toHarbour) % 360 + 540) % 360 - 180);
  return diff < 30;
}

function updateArrivals(ships) {
  const coming = [];
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (s.sog == null || s.sog < 1 || s.arrived) continue;
    const dist = distanceNm(s.lat, s.lon, HARBOUR[0], HARBOUR[1]);
    if (dist > 40 || dist < 1) continue;
    if (!headingForHarbour(s)) continue;
    coming.push({ ship: s, dist: dist, minutes: dist / s.sog * 60 });
  }
  coming.sort(function (a, b) { return a.minutes - b.minutes; });

  const list = document.getElementById("arrivals-list");
  if (coming.length == 0) {
    list.innerHTML = '<li class="empty">Nothing heading in right now</li>';
    return;
  }
  let html = "";
  for (let i = 0; i < coming.length && i < 4; i++) {
    const c = coming[i];
    const color = getCategory(c.ship.ship_type).color;
    const minutes = Math.round(c.minutes);
    let eta = minutes + " min";
    if (minutes >= 60) eta = Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
    html += '<li><i style="background:' + color + '"></i><span>' + (c.ship.name || "Unknown vessel") + "</span>" +
            "<small>" + c.dist.toFixed(1) + " nm</small><b>" + eta + "</b></li>";
  }
  list.innerHTML = html;
}

// heatmap of where ships have been over the last day
let heatLayer = null;
const heatButton = document.getElementById("heat-toggle");
heatButton.onclick = function () {
  if (heatLayer != null) {
    map.removeLayer(heatLayer);
    heatLayer = null;
    heatButton.classList.remove("on");
    return;
  }
  fetch("/history/heat").then(function (r) { return r.json(); }).then(function (points) {
    heatLayer = L.heatLayer(points, {
      radius: 16, blur: 20, maxZoom: 12, minOpacity: 0.35,
      gradient: { 0.3: "#4ea8ff", 0.6: "#3ddc97", 0.8: "#f5a524", 1: "#ff4d4f" },
    }).addTo(map);
    heatButton.classList.add("on");
  });
};

// replay the last hour from the saved history
let replaying = false;
let latestShips = [];
let frames = [];
let playTimer = null;
// replay circles get their own layer so hiding the live ships doesn't hide them
map.createPane("replay");
const replayLayer = L.layerGroup().addTo(map);
const replayBar = document.getElementById("replay-bar");
const slider = document.getElementById("replay-slider");

function drawFrame(i) {
  const frame = frames[i];
  if (frame == undefined) return;
  replayLayer.clearLayers();
  for (let j = 0; j < frame.ships.length; j++) {
    const s = frame.ships[j];
    L.circleMarker([s.lat, s.lon], {
      pane: "replay", radius: 5, color: getCategory(s.ship_type).color, fillOpacity: 0.9, weight: 1,
    }).bindTooltip(s.name || "Unknown vessel").addTo(replayLayer);
  }
  const time = new Date(frame.t * 1000);
  setText("replay-time", time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
}

function setLiveVisible(visible) {
  map.getPane("markerPane").style.display = visible ? "" : "none";
  map.getPane("overlayPane").style.opacity = visible ? "" : "0";
}

document.getElementById("replay-toggle").onclick = function () {
  fetch("/history/frames?minutes=60").then(function (r) { return r.json(); }).then(function (data) {
    if (data.length == 0) {
      setText("replay-toggle", "No history yet");
      setTimeout(function () { setText("replay-toggle", "Replay"); }, 2000);
      return;
    }
    frames = data;
    replaying = true;
    if (selected != null) closePanel();
    setLiveVisible(false);
    slider.max = frames.length - 1;
    slider.value = 0;
    drawFrame(0);
    replayBar.hidden = false;
  });
};

slider.oninput = function () {
  drawFrame(Number(slider.value));
};

document.getElementById("replay-play").onclick = function () {
  if (playTimer != null) {
    clearInterval(playTimer);
    playTimer = null;
    setText("replay-play", "Play");
    return;
  }
  setText("replay-play", "Pause");
  playTimer = setInterval(function () {
    let next = Number(slider.value) + 1;
    if (next > frames.length - 1) next = 0;
    slider.value = next;
    drawFrame(next);
  }, 250);
};

document.getElementById("replay-exit").onclick = function () {
  if (playTimer != null) clearInterval(playTimer);
  playTimer = null;
  setText("replay-play", "Play");
  replaying = false;
  replayLayer.clearLayers();
  replayBar.hidden = true;
  setLiveVisible(true);
};

// 3D view, only loaded the first time you open it
let in3d = false;
const button3d = document.getElementById("toggle-3d");
button3d.onclick = function () {
  const container = document.getElementById("view3d");
  in3d = !in3d;
  import("./view3d.js").then(function (view) {
    if (in3d) {
      if (replaying) document.getElementById("replay-exit").click();
      container.hidden = false;
      document.getElementById("map").style.visibility = "hidden";
      view.show3d(container);
      document.getElementById("heat-toggle").hidden = true; // these only work on the 2D map
      document.getElementById("replay-toggle").hidden = true;
      button3d.textContent = "2D view";
      button3d.classList.add("on");
    } else {
      view.hide3d();
      document.getElementById("heat-toggle").hidden = false;
      document.getElementById("replay-toggle").hidden = false;
      container.hidden = true;
      document.getElementById("map").style.visibility = "";
      button3d.textContent = "3D view";
      button3d.classList.remove("on");
    }
  });
};

connect();
