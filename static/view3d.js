// 3D view: the map laid flat as the sea, with 3D boats sailing on it.
// Uses the same ship data as the 2D map (latestShips in map.js).
// 1 unit in the scene = 1 nautical mile.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { makeShipModel } from "./boats3d.js";
import { makeWaterMaterial, waterUniforms, foamTexture, softCircle } from "./water3d.js";

const CENTER = [57.25, -1.75]; // middle of the area we track
const AREA = { south: 56.9, north: 57.6, west: -2.5, east: -1.0 };
const TILE_ZOOM = 10;
// roughly how long each kind of ship really is (in nm). Up close they're drawn at
// this size, further away they get bigger so you can still see them.
const REAL_LENGTH = { Cargo: 0.16, Tanker: 0.14, Passenger: 0.07, "Tug/service": 0.035, Fishing: 0.025, Other: 0.045 };
const BIGGEST = { Cargo: 0.9, Tanker: 0.9, Passenger: 0.75, "Tug/service": 0.4, Fishing: 0.35, Other: 0.5 };

let scene, camera, renderer, labelRenderer, controls, raycaster, mouse, sun, ground, groundStyle;
let lastTime = 0;
const smokeTexture = softCircle("rgba(235,235,235,1)");
const shadowTexture = softCircle("rgba(0,0,0,1)");
let started = false;
let running = false;
const boats = {}; // mmsi -> { group, from, to, start }

// following a ship: the camera flies to it, then moves along with it
let followed = null;
let flight = null; // { start, fromTarget, fromCamera, offset } while flying over
let lastFollowPos = null;
let touring = false;
let tourTimer = null;

// lat/lon to x/z in nautical miles from the centre
function toScene(lat, lon) {
  const x = (lon - CENTER[1]) * 60 * Math.cos(CENTER[0] * Math.PI / 180);
  const z = -(lat - CENTER[0]) * 60;
  return new THREE.Vector3(x, 0, z);
}

// web map tile maths (same tiles Leaflet uses)
function tileToLon(x, z) {
  return x / Math.pow(2, z) * 360 - 180;
}

function tileToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(Math.sinh(n));
}

function lonToTile(lon, z) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}

function latToTile(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}

// lay every map tile in the area flat on the ground
function addGround(tileUrl) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const ground = new THREE.Group();

  for (let x = lonToTile(AREA.west, TILE_ZOOM); x <= lonToTile(AREA.east, TILE_ZOOM); x++) {
    for (let y = latToTile(AREA.north, TILE_ZOOM); y <= latToTile(AREA.south, TILE_ZOOM); y++) {
      const topLeft = toScene(tileToLat(y, TILE_ZOOM), tileToLon(x, TILE_ZOOM));
      const bottomRight = toScene(tileToLat(y + 1, TILE_ZOOM), tileToLon(x + 1, TILE_ZOOM));
      const width = bottomRight.x - topLeft.x;
      const depth = bottomRight.z - topLeft.z;

      const url = tileUrl.replace("{z}", TILE_ZOOM).replace("{x}", x).replace("{y}", y);
      const material = makeWaterMaterial(null, satelliteOn);
      loader.load(url, function (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        material.uniforms.uMap.value = texture;
        material.uniforms.uHasMap.value = 1;
      });

      const tile = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(topLeft.x + width / 2, 0, topLeft.z + depth / 2);
      ground.add(tile);
    }
  }

  // open sea everywhere else, out to the horizon
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), makeWaterMaterial(null, false));
  sea.material.polygonOffsetFactor = 8;
  sea.material.polygonOffsetUnits = 8;
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.001;
  ground.add(sea);
  return ground;
}

function makeBoat(ship) {
  const category = getCategory(ship.ship_type); // from map.js
  // everything is built 1 unit long, then the whole group is scaled every frame
  const length = 1;

  // the model is 10 units long, so shrink it to 1.
  // the MMSI is used to pick its colours, so each ship always looks the same
  const model = makeShipModel(category.name, ship.ship_type, ship.mmsi);
  model.scale.setScalar(length / 10);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const beam = size.x;

  // soft dark patch under the hull so it sits in the water instead of on top of it
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(beam * 1.5, length * 1.15),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.45, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;

  // foam: two trails spreading out behind in a V, churned water straight
  // behind the stern, and a bow wave either side of the front.
  // Each strip fades out towards its far end.
  const positions = [];
  const colours = [];
  const uvs = [];
  function foamStrip(x0, y0, x1, y1, width0, width1, strength) {
    // a thin quad from (x0, y0) to (x1, y1), getting wider towards the end
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const corners = [
      [x0 + nx * width0, y0 + ny * width0, strength, 0, 0], [x0 - nx * width0, y0 - ny * width0, strength, 1, 0],
      [x1 + nx * width1, y1 + ny * width1, 0, 0, len * 6], [x1 - nx * width1, y1 - ny * width1, 0, 1, len * 6]
    ];
    for (const k of [0, 1, 2, 1, 3, 2]) {
      positions.push(corners[k][0], corners[k][1], 0);
      colours.push(1, 1, 1, corners[k][2]);
      uvs.push(corners[k][3], corners[k][4]);
    }
  }
  const sternY = -length * 0.47;
  foamStrip(-beam * 0.4, sternY, -beam * 0.4 - length * 0.55, -length * 1.7, length * 0.015, length * 0.06, 0.8);
  foamStrip(beam * 0.4, sternY, beam * 0.4 + length * 0.55, -length * 1.7, length * 0.015, length * 0.06, 0.8);
  foamStrip(0, sternY, 0, -length * 1.1, beam * 0.3, beam * 0.55, 0.6);
  foamStrip(-beam * 0.05, length * 0.48, -beam * 0.75, length * 0.05, length * 0.01, length * 0.03, 0.9);
  foamStrip(beam * 0.05, length * 0.48, beam * 0.75, length * 0.05, length * 0.01, length * 0.03, 0.9);
  const wakeGeometry = new THREE.BufferGeometry();
  wakeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  wakeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));
  wakeGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  const wake = new THREE.Mesh(
    wakeGeometry,
    new THREE.MeshBasicMaterial({ map: foamTexture, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.y = 0.004;

  // coloured ring under the ship so you can still tell the type at a glance
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(length * 0.6, length * 0.612, 64),
    new THREE.MeshBasicMaterial({ color: category.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.006;

  // red ring for ships with an alert
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(length * 0.7, length * 0.78, 48),
    new THREE.MeshBasicMaterial({ color: 0xff4d4f, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.008;

  // smoke from the funnels: a few puffs each that rise, drift back and fade
  const puffs = [];
  for (const spot of model.userData.smoke || []) {
    for (let i = 0; i < 8; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, depthWrite: false, opacity: 0 }));
      puff.userData = { from: spot, offset: i / 8 };
      model.add(puff);
      puffs.push(puff);
    }
  }

  // name tag floating above the ship
  const tag = document.createElement("div");
  tag.className = "ship-tag";
  const label = new CSS2DObject(tag);
  label.position.set(0, 0.45, 0);

  const group = new THREE.Group();
  group.add(shadow, wake, marker, ring, model, label);
  group.userData = {
    mmsi: ship.mmsi, wake: wake, ring: ring, model: model, puffs: puffs, tag: tag, marker: marker,
    bob: Math.random() * 10, real: REAL_LENGTH[category.name], biggest: BIGGEST[category.name],
    small: category.name == "Tug/service" || category.name == "Fishing",
  };
  return group;
}

function updateBoats(now) {
  const stillHere = {};
  for (let i = 0; i < latestShips.length; i++) {
    const ship = latestShips[i];
    stillHere[ship.mmsi] = true;
    const target = toScene(ship.lat, ship.lon);

    if (boats[ship.mmsi] == undefined) {
      const group = makeBoat(ship);
      group.position.copy(target);
      scene.add(group);
      boats[ship.mmsi] = { group: group, from: target.clone(), to: target.clone(), start: now, ship: ship };
    }

    const boat = boats[ship.mmsi];
    if (!boat.to.equals(target)) {
      // new position from the server, glide to it over the next 2 seconds
      boat.from = boat.group.position.clone();
      boat.to = target;
      boat.start = now;
    }
    boat.ship = ship;
  }

  for (const mmsi in boats) {
    if (!stillHere[mmsi]) {
      boats[mmsi].group.userData.tag.remove();
      scene.remove(boats[mmsi].group);
      delete boats[mmsi];
    }
  }
}

function animate(now) {
  if (!running) return;
  requestAnimationFrame(animate);
  updateBoats(now);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  waterUniforms.uTime.value = now / 1000;
  foamTexture.offset.y -= dt * 0.6; // foam slides back along the wake

  for (const mmsi in boats) {
    const boat = boats[mmsi];
    const t = Math.min((now - boat.start) / 1900, 1);
    boat.group.position.lerpVectors(boat.from, boat.to, t);

    // face the way it's going (course is clockwise from north)
    if (boat.ship.cog != null) {
      boat.group.rotation.y = -boat.ship.cog * Math.PI / 180;
    }

    // real size up close, bigger further away so you can still spot it
    const info = boat.group.userData;
    const distance = camera.position.distanceTo(boat.group.position);
    boat.group.scale.setScalar(Math.min(info.biggest, Math.max(info.real, distance * 0.05)));

    // name tag: only for ships nearby, or the one you're following
    const isFollowed = followed == boat.ship.mmsi;
    const name = boat.ship.name || (isFollowed ? "Unknown vessel" : "");
    info.tag.textContent = name;
    info.tag.classList.toggle("followed", isFollowed);
    info.tag.style.opacity = name && (isFollowed || distance < 12) ? 1 : 0;

    // gentle rolling and pitching on the waves (smaller boats move more)
    const model = info.model;
    const bob = info.bob + now / 900;
    const small = info.small ? 2 : 1;
    model.position.y = Math.sin(bob) * 0.002 * small;
    model.rotation.z = Math.sin(bob * 0.8) * 0.02 * small;
    model.rotation.x = Math.sin(bob * 0.6 + 1) * 0.008 * small;

    // radars spin round
    for (const radar of model.userData.spinners) radar.rotation.y += dt * 2.5;

    // smoke puffs: each one rises from the funnel, grows, drifts back and fades away
    for (const puff of boat.group.userData.puffs) {
      const age = (now / 4000 + puff.userData.offset) % 1;
      const from = puff.userData.from;
      puff.position.set(from.x + age * 0.3, from.y + age * 1.2, from.z + age * 2.2);
      puff.scale.setScalar(0.25 + age * 1.4);
      puff.material.opacity = 0.35 * Math.sin(Math.PI * age) * (1 - age * 0.5);
    }

    const moving = boat.ship.sog != null && boat.ship.sog > 0.5;
    boat.group.userData.wake.visible = moving;
    boat.group.userData.ring.visible = boat.ship.alert != null;
    if (boat.ship.alert != null) {
      boat.group.userData.ring.scale.setScalar(1 + (now % 1200) / 1200 * 0.6);
    }
  }

  updateFollow(now);

  // the sun's shadows only cover the area around where you're looking, so move them
  // with the camera, and make them sharper the closer you are
  const zoom = camera.position.distanceTo(controls.target);
  const size = Math.min(4, Math.max(0.25, zoom * 0.6));
  sun.shadow.camera.left = -size;
  sun.shadow.camera.right = size;
  sun.shadow.camera.top = size;
  sun.shadow.camera.bottom = -size;
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(waterUniforms.uSunDir.value, 30);

  // move the near clipping plane in when you zoom right in, so ships don't get cut off
  camera.near = Math.min(0.1, Math.max(0.002, zoom * 0.01));
  camera.updateProjectionMatrix();

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// keep the camera on the selected ship (selected comes from map.js, set when a panel is open)
function updateFollow(now) {
  if (selected != followed) {
    if (selected != null && boats[selected] != undefined) startFollow(selected);
    else stopFollow();
  }
  if (followed == null || boats[followed] == undefined) return;
  const shipPos = boats[followed].group.position;

  if (flight) {
    // fly over smoothly, ending up a short distance from the ship
    let t = Math.min((now - flight.start) / 1400, 1);
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    controls.target.lerpVectors(flight.fromTarget, shipPos, t);
    camera.position.lerpVectors(flight.fromCamera, shipPos.clone().add(flight.offset), t);
    if (t >= 1) flight = null;
  } else {
    // move the camera along with the ship, so you can still orbit around it
    camera.position.add(shipPos.clone().sub(lastFollowPos));
    controls.target.copy(shipPos);
  }
  lastFollowPos = shipPos.clone();
}

function startFollow(mmsi) {
  followed = mmsi;
  const shipPos = boats[mmsi].group.position;
  const size = boats[mmsi].group.userData.real;
  // come in from the side you're already looking from
  const direction = camera.position.clone().sub(controls.target).setY(0).normalize();
  const distance = Math.max(0.1, size * 2.8);
  flight = {
    start: performance.now(),
    fromTarget: controls.target.clone(),
    fromCamera: camera.position.clone(),
    offset: direction.multiplyScalar(distance).setY(distance * 0.45),
  };
  lastFollowPos = shipPos.clone();
  controls.zoomToCursor = false;
  document.getElementById("follow-name").textContent = boats[mmsi].ship.name || "Unknown vessel";
  document.getElementById("follow-chip").hidden = false;
}

function stopFollow() {
  followed = null;
  flight = null;
  controls.autoRotate = false;
  controls.zoomToCursor = true;
  document.getElementById("spin-3d").classList.remove("on");
  document.getElementById("follow-chip").hidden = true;
  if (touring) stopTour();
}

// tour: hop between ships every few seconds and spin slowly round each one
function nextTourShip() {
  const list = latestShips.filter(function (s) { return boats[s.mmsi] != undefined; });
  if (list.length == 0) return;
  const moving = list.filter(function (s) { return s.sog != null && s.sog > 0.5; });
  const pool = moving.length > 0 ? moving : list;
  let pick = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && pick.mmsi == followed) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
  openPanel(pick.mmsi); // from map.js, which also sets selected
  controls.autoRotate = true;
}

function startTour() {
  touring = true;
  document.getElementById("tour-3d").classList.add("on");
  nextTourShip();
  tourTimer = setInterval(nextTourShip, 10000);
}

function stopTour() {
  touring = false;
  clearInterval(tourTimer);
  document.getElementById("tour-3d").classList.remove("on");
}

function resetView() {
  closePanel(); // from map.js
  stopFollow();
  const harbour = toScene(HARBOUR[0], HARBOUR[1]);
  controls.target.copy(harbour).add(new THREE.Vector3(4, 0, -2));
  camera.position.set(harbour.x + 6, 7, harbour.z + 9);
}

function setUpButtons() {
  document.getElementById("spin-3d").onclick = function () {
    if (followed == null) return;
    controls.autoRotate = !controls.autoRotate;
    this.classList.toggle("on", controls.autoRotate);
  };
  document.getElementById("tour-3d").onclick = function () {
    if (touring) stopTour();
    else startTour();
  };
  document.getElementById("reset-3d").onclick = resetView;
  document.getElementById("follow-stop").onclick = function () { closePanel(); };
  window.addEventListener("keydown", function (event) {
    if (event.key == "Escape" && running) closePanel();
  });
}

function start(container) {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(waterUniforms.uHorizon.value.getHex(), 25, 120);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
  const harbour = toScene(HARBOUR[0], HARBOUR[1]);
  camera.position.set(harbour.x + 6, 7, harbour.z + 9);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(harbour).add(new THREE.Vector3(4, 0, -2));
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.15; // don't go under the sea
  controls.minDistance = 0.03;
  controls.maxDistance = 70;
  controls.zoomToCursor = true; // scroll towards wherever the mouse is
  controls.autoRotateSpeed = 0.8;

  // name tags are normal HTML laid over the 3D scene
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.className = "tag-layer";
  container.appendChild(labelRenderer.domElement);

  // sky with the sun low in the south west, like a North Sea afternoon
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 14), THREE.MathUtils.degToRad(215));
  waterUniforms.uSunDir.value.copy(sunDirection);
  const sky = new Sky();
  sky.scale.setScalar(900);
  sky.material.uniforms.turbidity.value = 4;
  sky.material.uniforms.rayleigh.value = 2;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.85;
  sky.material.uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);

  // the ships reflect the sky, which makes the paint and windows look shiny
  const skyScene = new THREE.Scene();
  skyScene.add(sky.clone());
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(skyScene).texture;

  scene.add(new THREE.HemisphereLight(0xcfe3f5, 0x1d3140, 0.8));
  sun = new THREE.DirectionalLight(0xfff1d6, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -3;
  sun.shadow.camera.right = 3;
  sun.shadow.camera.top = 3;
  sun.shadow.camera.bottom = -3;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0002;
  scene.add(sun);
  scene.add(sun.target);

  ground = addGround(currentTileUrl());
  groundStyle = satelliteOn;
  scene.add(ground);
  setUpButtons();

  // click a boat to open its info, same as the 2D map
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  // a click is a press and release without dragging (dragging is for moving the camera)
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", function (event) {
    downAt = [event.clientX, event.clientY];
    if (touring) stopTour();
  });
  renderer.domElement.addEventListener("click", function (event) {
    if (downAt && Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const box = renderer.domElement.getBoundingClientRect();
    mouse.x = (event.clientX - box.left) / box.width * 2 - 1;
    mouse.y = -(event.clientY - box.top) / box.height * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const groups = [];
    for (const mmsi in boats) groups.push(boats[mmsi].group);
    const hits = raycaster.intersectObjects(groups, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj.parent && obj.userData.mmsi == undefined) obj = obj.parent;
      openPanel(obj.userData.mmsi); // from map.js
    } else if (followed != null) {
      closePanel(); // clicked the water: stop following
    }
  });

  window.addEventListener("resize", function () {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
  });
  started = true;
}

// use the same map style as the 2D view
function currentTileUrl() {
  if (satelliteOn) {
    return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  }
  return "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
}

// swap the map under the sea when you change between satellite and the dark map
export function refreshStyle() {
  if (!started || groundStyle == satelliteOn) return;
  scene.remove(ground);
  ground = addGround(currentTileUrl());
  groundStyle = satelliteOn;
  scene.add(ground);
}

export function show3d(container) {
  if (!started) start(container);
  refreshStyle();
  running = true;
  document.getElementById("controls3d").hidden = false;
  requestAnimationFrame(animate);
}

export function hide3d() {
  running = false;
  if (touring) stopTour();
  document.getElementById("controls3d").hidden = true;
}
