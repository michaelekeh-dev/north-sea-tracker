// 3D view: the map laid flat as the sea floor with 3D boats on top.
// Uses the same ship data as the 2D map (latestShips in map.js).
// 1 unit in the scene = 1 nautical mile.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeShipModel } from "./boats3d.js";

const CENTER = [57.25, -1.75]; // middle of the area we track
const AREA = { south: 56.9, north: 57.6, west: -2.5, east: -1.0 };
const TILE_ZOOM = 10;
// real ships would be too small to see, so these are bigger than real life (in nm)
const SHIP_LENGTH = { Cargo: 0.9, Tanker: 0.9, Passenger: 0.75, "Tug/service": 0.4, Fishing: 0.35, Other: 0.5 };

let scene, camera, renderer, controls, raycaster, mouse;
let started = false;
let running = false;
const boats = {}; // mmsi -> { group, from, to, start }

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
      const material = new THREE.MeshBasicMaterial({ color: 0x1b2430 });
      loader.load(url, function (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      });

      const tile = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(topLeft.x + width / 2, 0, topLeft.z + depth / 2);
      ground.add(tile);
    }
  }
  return ground;
}

function makeBoat(ship) {
  const category = getCategory(ship.ship_type); // from map.js
  const length = SHIP_LENGTH[category.name];

  // the model is 10 units long, so shrink it to the right size
  const model = makeShipModel(category.name, ship.ship_type, 0xa61b1b);
  model.scale.setScalar(length / 10);

  // foam behind the boat in a V shape, only shown when it's moving
  const beam = length * 0.2;
  const wakeShape = new THREE.Shape();
  wakeShape.moveTo(-beam * 0.4, -length / 2);
  wakeShape.lineTo(beam * 0.4, -length / 2);
  wakeShape.lineTo(beam * 1.2, -length * 1.5);
  wakeShape.lineTo(-beam * 1.2, -length * 1.5);
  // fades out the further it gets from the boat
  const wakeGeometry = new THREE.ShapeGeometry(wakeShape);
  const points = wakeGeometry.attributes.position;
  const colours = [];
  for (let i = 0; i < points.count; i++) {
    const fade = 1 - (-points.getY(i) - length / 2) / length;
    colours.push(1, 1, 1, fade * 0.3);
  }
  wakeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));
  const wake = new THREE.Mesh(
    wakeGeometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  );
  wake.rotation.x = -Math.PI / 2;
  wake.position.y = 0.005;

  // coloured ring under the ship so you can still tell the type at a glance
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(length * 0.62, length * 0.66, 40),
    new THREE.MeshBasicMaterial({ color: category.color, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.006;

  // red ring for ships with an alert
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(length * 0.7, length * 0.78, 40),
    new THREE.MeshBasicMaterial({ color: 0xff4d4f, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.008;

  const group = new THREE.Group();
  group.add(model, wake, marker, ring);
  group.userData = { mmsi: ship.mmsi, wake: wake, ring: ring, bob: Math.random() * 10 };
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
      scene.remove(boats[mmsi].group);
      delete boats[mmsi];
    }
  }
}

function animate(now) {
  if (!running) return;
  requestAnimationFrame(animate);
  updateBoats(now);

  for (const mmsi in boats) {
    const boat = boats[mmsi];
    const t = Math.min((now - boat.start) / 1900, 1);
    boat.group.position.lerpVectors(boat.from, boat.to, t);

    // face the way it's going (course is clockwise from north)
    if (boat.ship.cog != null) {
      boat.group.rotation.y = -boat.ship.cog * Math.PI / 180;
    }

    // gentle bobbing on the waves
    const bob = boat.group.userData.bob + now / 700;
    boat.group.position.y = Math.sin(bob) * 0.004;
    boat.group.rotation.z = Math.sin(bob * 0.8) * 0.025;

    const moving = boat.ship.sog != null && boat.ship.sog > 0.5;
    boat.group.userData.wake.visible = moving;
    boat.group.userData.ring.visible = boat.ship.alert != null;
    if (boat.ship.alert != null) {
      boat.group.userData.ring.scale.setScalar(1 + (now % 1200) / 1200 * 0.6);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

function start(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  scene.fog = new THREE.Fog(0x0b0f14, 30, 90);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.05, 500);
  const harbour = toScene(HARBOUR[0], HARBOUR[1]);
  camera.position.set(harbour.x + 6, 7, harbour.z + 9);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(harbour).add(new THREE.Vector3(4, 0, -2));
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.15; // don't go under the sea
  controls.minDistance = 1;
  controls.maxDistance = 60;

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-20, 25, 12);
  scene.add(sun);

  scene.add(addGround(currentTileUrl()));

  // click a boat to open its info, same as the 2D map
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  renderer.domElement.addEventListener("click", function (event) {
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
    }
  });

  window.addEventListener("resize", function () {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
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

export function show3d(container) {
  if (!started) start(container);
  running = true;
  requestAnimationFrame(animate);
}

export function hide3d() {
  running = false;
}
