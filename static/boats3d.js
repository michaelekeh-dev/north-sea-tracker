// 3D ship models, one for each kind of ship.
// Every model is built facing -z (north) with the waterline at y = 0,
// and is about 10 units long, so the 3D view just scales it.

import * as THREE from "three";

const WHITE = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.55, flatShading: true });
const GREY = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.7, flatShading: true });
const DARK = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8, flatShading: true });
const DECK = new THREE.MeshStandardMaterial({ color: 0x3f5a4a, roughness: 0.9, flatShading: true });
const WINDOW = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0xffd58a, emissiveIntensity: 0.35 });
const BLACK = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const RED_LIGHT = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
const GREEN_LIGHT = new THREE.MeshBasicMaterial({ color: 0x3bff7a });
const WHITE_LIGHT = new THREE.MeshBasicMaterial({ color: 0xffffff });

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function cylinder(r, h, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), material);
  mesh.position.set(x, y, z);
  return mesh;
}

// hull made from cross sections along the ship, stern to bow.
// bluntBow makes it rounder (tugs and trawlers), otherwise it's pointy.
function makeHull(length, beam, depth, paint, bluntBow) {
  const sections = 14;
  const positions = [];
  const colors = [];
  const hullColor = new THREE.Color(paint);
  const bottomColor = new THREE.Color(0x8b2e2a); // red antifouling under the water
  const stripe = new THREE.Color(0xf1f5f9);
  const waterline = 0.08 * depth;

  // the shape of one cross section, left to right
  function section(t) {
    const z = length / 2 - t * length; // t = 0 at stern, 1 at bow
    let width = beam / 2;
    if (t > 0.65) {
      const k = (t - 0.65) / 0.35;
      width *= bluntBow ? Math.cos(k * Math.PI / 2.4) : Math.cos(k * Math.PI / 2);
    }
    if (t < 0.08) width *= 0.92 + t; // slightly narrower square stern
    const bottom = -depth * 0.35 + (t > 0.75 ? (t - 0.75) * depth * 0.8 : 0);
    const deck = depth * 0.65 + (t > 0.8 ? (t - 0.8) * depth * 1.5 : 0); // bow rises up
    return [
      [-width, deck, z],
      [-width * 0.95, waterline, z],
      [-width * 0.6, bottom, z],
      [0, bottom - depth * 0.05, z],
      [width * 0.6, bottom, z],
      [width * 0.95, waterline, z],
      [width, deck, z],
    ];
  }

  function pickColor(y) {
    if (y < waterline - 0.01) return bottomColor;
    if (y < waterline + depth * 0.08) return stripe;
    return hullColor;
  }

  function addTriangle(a, b, c, fixedColor) {
    const col = fixedColor || pickColor((a[1] + b[1] + c[1]) / 3);
    for (const p of [a, b, c]) {
      positions.push(p[0], p[1], p[2]);
      colors.push(col.r, col.g, col.b);
    }
  }

  let previous = section(0);
  // flat transom at the back
  for (let j = 1; j < previous.length - 1; j++) addTriangle(previous[0], previous[j + 1], previous[j], hullColor);

  for (let i = 1; i <= sections; i++) {
    const current = section(i / sections);
    for (let j = 0; j < current.length - 1; j++) {
      addTriangle(previous[j], previous[j + 1], current[j + 1]);
      addTriangle(previous[j], current[j + 1], current[j]);
    }
    previous = current;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const hull = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.6, flatShading: true, side: THREE.DoubleSide,
  }));

  // deck on top, following the same outline
  const outline = new THREE.Shape();
  const left = [];
  const right = [];
  for (let i = 0; i <= sections; i++) {
    const s = section(i / sections);
    left.push(s[0]);
    right.push(s[6]);
  }
  outline.moveTo(left[0][0], -left[0][2]);
  for (const p of left) outline.lineTo(p[0], -p[2]);
  for (const p of right.reverse()) outline.lineTo(p[0], -p[2]);
  const deckGeometry = new THREE.ShapeGeometry(outline);
  deckGeometry.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeometry, DECK);
  deck.position.y = depth * 0.65 + 0.01;

  const group = new THREE.Group();
  group.add(hull, deck);
  return group;
}

// a white block with a row of lit windows down each side
function accommodation(w, h, d, x, y, z) {
  const group = new THREE.Group();
  group.add(box(w, h, d, WHITE, x, y + h / 2, z));
  const rows = Math.max(1, Math.round(h / 0.45));
  for (let r = 0; r < rows; r++) {
    const wy = y + (r + 0.6) * (h / rows);
    group.add(box(w + 0.02, h / rows * 0.3, d * 0.85, WINDOW, x, wy, z));
  }
  // bridge windows across the front
  group.add(box(w * 0.9, h / rows * 0.35, 0.02, WINDOW, x, y + h - h / rows * 0.4, z - d / 2 - 0.01));
  return group;
}

function navLights(beam, height, z) {
  const group = new THREE.Group();
  const s = new THREE.SphereGeometry(0.07, 8, 8);
  const port = new THREE.Mesh(s, RED_LIGHT);
  port.position.set(-beam / 2, height, z);
  const starboard = new THREE.Mesh(s, GREEN_LIGHT);
  starboard.position.set(beam / 2, height, z);
  group.add(port, starboard);
  return group;
}

function mast(x, y, z, height) {
  const group = new THREE.Group();
  group.add(cylinder(0.04, height, GREY, x, y + height / 2, z));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), WHITE_LIGHT);
  light.position.set(x, y + height, z);
  group.add(light);
  return group;
}

function funnel(x, y, z, color) {
  const group = new THREE.Group();
  group.add(cylinder(0.32, 1.1, new THREE.MeshStandardMaterial({ color: color, flatShading: true }), x, y + 0.55, z));
  group.add(cylinder(0.33, 0.25, BLACK, x, y + 1.15, z));
  return group;
}

function cargoShip(paint) {
  const g = makeHull(10, 1.7, 1.0, paint, false);
  const deckY = 0.66;
  // containers in rows, random colours like a real stack
  const colours = [0xc2410c, 0x1d4ed8, 0x15803d, 0xb91c1c, 0x7c3aed, 0x0e7490, 0xa16207];
  for (let row = 0; row < 6; row++) {
    const z = -3.3 + row * 1.05;
    const stack = 2 + (row % 2);
    for (let level = 0; level < stack; level++) {
      for (let col = -1; col <= 1; col++) {
        const mat = new THREE.MeshStandardMaterial({ color: colours[(row * 3 + col + level * 5 + 21) % colours.length], flatShading: true });
        g.add(box(0.46, 0.34, 0.95, mat, col * 0.48, deckY + 0.17 + level * 0.35, z));
      }
    }
  }
  g.add(accommodation(1.4, 1.8, 1.0, 0, deckY, 3.6));
  g.add(funnel(0, deckY + 1.6, 4.25, 0xf97316));
  g.add(mast(0, deckY + 1.8, 3.4, 0.7));
  g.add(navLights(1.45, deckY + 1.7, 3.15));
  return g;
}

function tanker(paint) {
  const g = makeHull(10, 1.8, 0.9, paint, false);
  const deckY = 0.6;
  // pipes running the length of the deck, and a raised walkway
  for (const x of [-0.3, -0.1, 0.1, 0.3]) {
    const pipe = cylinder(0.04, 6.5, GREY, x, deckY + 0.08, -0.6);
    pipe.rotation.x = Math.PI / 2;
    g.add(pipe);
  }
  g.add(box(0.2, 0.04, 6.6, GREY, 0.6, deckY + 0.35, -0.6));
  g.add(box(0.9, 0.25, 0.3, GREY, 0, deckY + 0.13, -0.6)); // loading manifold
  g.add(accommodation(1.5, 1.6, 1.1, 0, deckY, 3.4));
  g.add(funnel(0, deckY + 1.4, 4.15, 0x111827));
  g.add(mast(0, deckY, -4.2, 1.0));
  g.add(navLights(1.55, deckY + 1.5, 2.9));
  return g;
}

function ferry(paint) {
  const g = makeHull(10, 1.9, 1.1, paint, false);
  const deckY = 0.72;
  // three decks getting shorter towards the top
  g.add(accommodation(1.75, 0.9, 7.0, 0, deckY, 0.6));
  g.add(accommodation(1.6, 0.8, 5.6, 0, deckY + 0.9, 0.9));
  g.add(accommodation(1.2, 0.6, 2.2, 0, deckY + 1.7, -0.6));
  g.add(funnel(-0.35, deckY + 1.7, 2.7, 0x2563eb));
  g.add(funnel(0.35, deckY + 1.7, 2.7, 0x2563eb));
  g.add(mast(0, deckY + 2.3, -0.9, 0.6));
  g.add(navLights(1.65, deckY + 2.1, -1.6));
  return g;
}

function supplyVessel(paint) {
  // the boats you see going in and out of Aberdeen to the oil rigs
  const g = makeHull(10, 2.0, 1.1, paint, true);
  const deckY = 0.72;
  g.add(accommodation(1.8, 1.9, 2.4, 0, deckY, -2.9)); // bridge at the front
  g.add(accommodation(1.3, 0.55, 1.2, 0, deckY + 1.9, -3.2)); // top of the bridge
  g.add(mast(0, deckY + 2.45, -3.3, 0.9));
  // low walls round the open cargo deck
  g.add(box(0.08, 0.35, 5.5, WHITE, -0.95, deckY + 0.17, 1.4));
  g.add(box(0.08, 0.35, 5.5, WHITE, 0.95, deckY + 0.17, 1.4));
  // a few pipes and boxes on deck
  g.add(box(0.7, 0.4, 0.9, new THREE.MeshStandardMaterial({ color: 0xeab308, flatShading: true }), -0.4, deckY + 0.2, 1.2));
  const pipes = cylinder(0.12, 2.2, GREY, 0.35, deckY + 0.13, 2.4);
  pipes.rotation.x = Math.PI / 2;
  g.add(pipes);
  // crane
  g.add(cylinder(0.12, 0.8, new THREE.MeshStandardMaterial({ color: 0xf97316, flatShading: true }), 0.75, deckY + 0.4, -1.4));
  const jib = box(0.12, 0.12, 2.2, new THREE.MeshStandardMaterial({ color: 0xf97316, flatShading: true }), 0.75, deckY + 1.15, -0.5);
  jib.rotation.x = -0.45;
  g.add(jib);
  g.add(navLights(1.85, deckY + 1.6, -3.0));
  return g;
}

function tug(paint) {
  const g = makeHull(10, 3.0, 1.4, paint, true);
  const deckY = 0.92;
  g.add(accommodation(2.0, 1.2, 3.0, 0, deckY, -0.4));
  g.add(accommodation(1.6, 1.0, 1.8, 0, deckY + 1.2, -0.6)); // tall bridge to see all round
  g.add(funnel(-0.5, deckY + 1.0, 1.5, 0x111827));
  g.add(funnel(0.5, deckY + 1.0, 1.5, 0x111827));
  g.add(mast(0, deckY + 2.2, -0.6, 1.0));
  // black rubber fenders along the sides and across the back
  g.add(box(0.18, 0.25, 6.5, BLACK, -1.52, deckY - 0.15, 0.6));
  g.add(box(0.18, 0.25, 6.5, BLACK, 1.52, deckY - 0.15, 0.6));
  g.add(box(2.8, 0.25, 0.18, BLACK, 0, deckY - 0.15, 4.95));
  g.add(box(0.35, 0.35, 0.35, DARK, 0, deckY + 0.17, 3.3)); // towing hook
  g.add(navLights(2.05, deckY + 2.0, -0.6));
  return g;
}

function trawler(paint) {
  const g = makeHull(10, 2.4, 1.2, paint, true);
  const deckY = 0.8;
  g.add(accommodation(1.7, 1.3, 2.2, 0, deckY, -2.4)); // wheelhouse forward
  g.add(mast(0, deckY + 1.3, -2.6, 1.6));
  // A-frame gantry at the back for the nets
  const orange = new THREE.MeshStandardMaterial({ color: 0xf97316, flatShading: true });
  g.add(box(0.14, 2.2, 0.14, orange, -1.0, deckY + 1.1, 3.8));
  g.add(box(0.14, 2.2, 0.14, orange, 1.0, deckY + 1.1, 3.8));
  g.add(box(2.14, 0.14, 0.14, orange, 0, deckY + 2.2, 3.8));
  // net drum
  const drum = cylinder(0.4, 1.5, DARK, 0, deckY + 0.45, 2.4);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  g.add(navLights(1.75, deckY + 1.2, -2.4));
  return g;
}

// pick the right model for the AIS ship type
export function makeShipModel(categoryName, typeNumber, paint) {
  if (categoryName == "Cargo") return cargoShip(0x1e3a5f);
  if (categoryName == "Tanker") return tanker(0x7f1d1d);
  if (categoryName == "Passenger") return ferry(0x1e40af);
  if (categoryName == "Fishing") return trawler(0x0f5132);
  if (typeNumber == 52 || typeNumber == 31 || typeNumber == 32) return tug(0x9a3412);
  return supplyVessel(paint);
}
