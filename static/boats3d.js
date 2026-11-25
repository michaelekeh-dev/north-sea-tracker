// 3D ship models, one for each kind of ship.
// Every model is built facing -z (bow) with the waterline at y = 0 and is
// 10 units long, so the 3D view just scales it. Each ship is built using its
// real size in metres (m = how many units one metre is) so details like
// windows, railings and containers come out the right size.

import * as THREE from "three";

// ---------- textures drawn on a canvas so nothing needs downloading ----------

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// one deck of white wall with a row of windows, some with the lights on
const windowTexture = canvasTexture(256, 64, function (ctx, w, h) {
  ctx.fillStyle = "#eef1f4";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    const x = i * 32 + 6;
    const glass = ctx.createLinearGradient(0, 18, 0, 42);
    glass.addColorStop(0, "#5d7c99");
    glass.addColorStop(1, "#1a2633");
    ctx.fillStyle = (i * 7) % 5 == 0 ? "#ffd98a" : glass;
    ctx.fillRect(x, 18, 20, 24);
  }
  ctx.fillStyle = "rgba(0,0,0,0.12)"; // line where one deck meets the next
  ctx.fillRect(0, h - 3, w, 3);
});

// bridge: one long band of dark glass
const bridgeTexture = canvasTexture(256, 64, function (ctx, w, h) {
  ctx.fillStyle = "#eef1f4";
  ctx.fillRect(0, 0, w, h);
  const glass = ctx.createLinearGradient(0, 10, 0, 50);
  glass.addColorStop(0, "#7d9bb5");
  glass.addColorStop(0.5, "#263849");
  glass.addColorStop(1, "#141d27");
  ctx.fillStyle = glass;
  ctx.fillRect(0, 10, w, 40);
  ctx.fillStyle = "#d7dde3"; // window frames
  for (let x = 0; x < w; x += 32) ctx.fillRect(x, 10, 3, 40);
});

// corrugated steel for containers (tinted by the instance colour)
const containerTexture = canvasTexture(128, 64, function (ctx, w, h) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) {
    ctx.fillStyle = "#c9c9c9";
    ctx.fillRect(x, 0, 3, h);
  }
  ctx.fillStyle = "#9a9a9a";
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 3, w, 3);
});

// steel deck plates
const deckTexture = canvasTexture(128, 128, function (ctx, w, h) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  for (let i = 0; i <= w; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
  }
});

// ---------- materials ----------

const WHITE = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.1 });
const LIGHT_GREY = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.4, metalness: 0.3 });
const DARK_GREY = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.6, metalness: 0.3 });
const BLACK = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
const RUBBER = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
const ORANGE = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.45 });
const YELLOW = new THREE.MeshStandardMaterial({ color: 0xf5b700, roughness: 0.45, metalness: 0.2 });
const ROOF = new THREE.MeshStandardMaterial({ color: 0x8a949e, roughness: 0.7 });
const RAIL = new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.4, metalness: 0.4 });
const RED_LIGHT = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const GREEN_LIGHT = new THREE.MeshBasicMaterial({ color: 0x2aff6a });
const WHITE_LIGHT = new THREE.MeshBasicMaterial({ color: 0xffffff });

function deckMaterial(color) {
  return new THREE.MeshStandardMaterial({ color: color, roughness: 0.85, map: deckTexture });
}

// random numbers from a seed, so the same ship always gets the same colours
function seededRandom(seed) {
  let s = (Number(seed) || 1) % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = s * 16807 % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------- small building blocks ----------

function mesh(geometry, material, x, y, z) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

function box(w, h, d, material, x, y, z) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

function cylinder(rTop, rBottom, h, material, x, y, z, sides) {
  return mesh(new THREE.CylinderGeometry(rTop, rBottom, h, sides || 16), material, x, y, z);
}

// a box with windows on the sides and front, one row per deck
function house(w, h, d, decks, x, y, z, spacing, glassFront) {
  function windows(faceWidth, texture) {
    const t = texture.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(faceWidth / spacing)), decks);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.3, metalness: 0.1 });
  }
  const side = windows(d, windowTexture);
  const front = windows(w, glassFront ? bridgeTexture : windowTexture);
  // box faces: right, left, top, bottom, back, front
  const materials = [side, side, ROOF, WHITE, windows(w, windowTexture), front];
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, d), materials, x, y + h / 2, z));
  g.add(box(w + 0.02 * spacing, 0.04 * spacing, d + 0.02 * spacing, WHITE, x, y + h, z)); // roof edge
  return g;
}

// bridge on top of a house: glass all round, plus wings out to the sides
function bridge(w, h, d, wingWidth, x, y, z, spacing) {
  const g = new THREE.Group();
  function glass(faceWidth) {
    const t = bridgeTexture.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(faceWidth / spacing)), 1);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.2, metalness: 0.2 });
  }
  const side = glass(d);
  const front = glass(w);
  g.add(mesh(new THREE.BoxGeometry(w, h, d), [side, side, ROOF, WHITE, front, front], x, y + h / 2, z));
  if (wingWidth > w) {
    const wing = box(wingWidth, h * 0.12, d * 0.55, WHITE, x, y + h * 0.06, z - d * 0.2);
    g.add(wing);
    for (const s of [-1, 1]) {
      g.add(box(0.012 * spacing, h * 0.5, d * 0.55, WHITE, x + s * wingWidth / 2, y + h * 0.3, z - d * 0.2));
    }
  }
  g.add(box(w * 1.06, h * 0.08, d * 1.1, WHITE, x, y + h, z)); // sun visor / roof
  return g;
}

// a railing along a path of [x, z] points
function railing(points, y, height, postGap) {
  const g = new THREE.Group();
  const posts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[0] - a[0], b[1] - a[1]);
    for (const level of [0.5, 1]) {
      const bar = box(height * 0.05, height * 0.05, len, RAIL, (a[0] + b[0]) / 2, y + height * level, (a[1] + b[1]) / 2);
      bar.rotation.y = angle;
      g.add(bar);
    }
    const count = Math.max(1, Math.floor(len / postGap));
    for (let k = 0; k < count; k++) {
      posts.push([a[0] + (b[0] - a[0]) * k / count, a[1] + (b[1] - a[1]) * k / count]);
    }
  }
  // all the posts drawn in one go
  const post = new THREE.CylinderGeometry(height * 0.03, height * 0.03, height, 5);
  const instanced = new THREE.InstancedMesh(post, RAIL, posts.length);
  const matrix = new THREE.Matrix4();
  posts.forEach(function (p, i) {
    matrix.makeTranslation(p[0], y + height / 2, p[1]);
    instanced.setMatrixAt(i, matrix);
  });
  g.add(instanced);
  return g;
}

// orange enclosed lifeboat hanging on its davits
function lifeboat(x, y, z, length, side) {
  const g = new THREE.Group();
  const r = length * 0.2;
  const body = mesh(new THREE.CapsuleGeometry(r, length - 2 * r, 6, 12), ORANGE, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.8);
  g.add(body);
  g.add(box(length * 0.5, r * 0.5, r * 1.2, WHITE, 0, r * 0.75, 0)); // canopy hatch
  for (const end of [-1, 1]) {
    g.add(box(r * 0.25, r * 2.4, r * 0.25, DARK_GREY, side * r * 1.2, r * 0.6, end * length * 0.4));
  }
  g.position.set(x, y, z);
  return g;
}

// funnel with a coloured band and a black top
function funnel(x, y, z, width, depth, height, color, bandColor) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4, metalness: 0.2 });
  const band = new THREE.MeshStandardMaterial({ color: bandColor, roughness: 0.4 });
  function part(h, yy, mat, shrink) {
    const c = cylinder(0.5 * shrink, 0.5, h, mat, 0, yy + h / 2, 0, 24);
    c.scale.set(width, 1, depth);
    g.add(c);
  }
  part(height * 0.55, 0, body, 0.97);
  part(height * 0.25, height * 0.55, band, 0.96);
  part(height * 0.2, height * 0.8, BLACK, 0.95);
  for (const s of [-0.15, 0.15]) {
    g.add(cylinder(width * 0.08, width * 0.08, height * 0.25, BLACK, s * width, height * 1.05, depth * 0.1, 10));
  }
  g.position.set(x, y, z);
  g.userData.smokeAt = new THREE.Vector3(x, y + height * 1.15, z);
  return g;
}

// mast with a rotating radar on top
function radarMast(x, y, z, height, size, spinners) {
  const g = new THREE.Group();
  g.add(cylinder(size * 0.03, size * 0.05, height, LIGHT_GREY, 0, height / 2, 0, 8));
  g.add(box(size * 0.9, size * 0.03, size * 0.03, LIGHT_GREY, 0, height * 0.75, 0)); // yardarm
  g.add(box(size * 0.5, size * 0.03, size * 0.3, DARK_GREY, 0, height * 0.55, 0)); // platform
  const radar = new THREE.Group();
  radar.add(box(size * 0.7, size * 0.04, size * 0.07, WHITE, 0, 0, 0));
  radar.position.set(0, height * 0.58, 0);
  g.add(radar);
  spinners.push(radar);
  g.add(mesh(new THREE.SphereGeometry(size * 0.035, 8, 6), WHITE_LIGHT, 0, height + size * 0.03, 0)); // masthead light
  g.position.set(x, y, z);
  return g;
}

// red and green sidelights on the bridge wings, white light at the stern
function navLights(halfWidth, y, z, sternZ, size) {
  const g = new THREE.Group();
  const s = new THREE.SphereGeometry(size, 8, 6);
  g.add(mesh(s, RED_LIGHT, -halfWidth, y, z));
  g.add(mesh(s, GREEN_LIGHT, halfWidth, y, z));
  g.add(mesh(s, WHITE_LIGHT, 0, y * 0.4, sternZ));
  return g;
}

// ---------- the hull ----------
// The hull is built from cross sections going from the stern (t = 0) to the
// bow (t = 1). Each section is a "superellipse": boxy in the middle of the
// ship and rounder and narrower towards the ends.

const hullColorShader = {
  vertex: "varying float vHullY;\n",
  fragment: "varying float vHullY;\nuniform vec3 uPaint;\nuniform vec3 uBottom;\nuniform vec3 uBoot;\nuniform vec3 uUpper;\nuniform float uUpperFrom;\nuniform float uBootHeight;\n"
};

function hullMaterial(colors, bootHeight) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.25, side: THREE.DoubleSide });
  // colour the hull by height: red antifouling under the water, a black band
  // at the waterline, then the paint (and an optional different colour higher up)
  material.onBeforeCompile = function (shader) {
    shader.uniforms.uPaint = { value: new THREE.Color(colors.paint) };
    shader.uniforms.uBottom = { value: new THREE.Color(colors.bottom || 0x8a2620) };
    shader.uniforms.uBoot = { value: new THREE.Color(colors.boot || 0x16181b) };
    shader.uniforms.uUpper = { value: new THREE.Color(colors.upper || colors.paint) };
    shader.uniforms.uUpperFrom = { value: colors.upperFrom || 99 };
    shader.uniforms.uBootHeight = { value: bootHeight };
    shader.vertexShader = hullColorShader.vertex + shader.vertexShader.replace(
      "#include <begin_vertex>", "#include <begin_vertex>\nvHullY = position.y;");
    shader.fragmentShader = hullColorShader.fragment + shader.fragmentShader.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n" +
      "vec3 hullCol = vHullY > uUpperFrom ? uUpper : uPaint;\n" +
      "if (vHullY < uBootHeight) hullCol = uBoot;\n" +
      "if (vHullY < -uBootHeight * 0.6) hullCol = uBottom;\n" +
      "diffuseColor.rgb *= hullCol;");
  };
  material.customProgramCacheKey = function () { return "hull"; };
  return material;
}

// options: beam, freeboard, draft, sheer (bow rises by this much),
// bow ("bulb", "raked" or "round"), flare, bulwark, colors, deckColor
function makeHull(o) {
  const L = 10;
  const sections = 64;
  const around = 28; // points down each side
  const bowStart = o.bow == "round" ? 0.55 : 0.6;

  function halfWidth(t) {
    let w = o.beam / 2;
    if (t < 0.08) w *= 0.86 + 0.14 * t / 0.08;
    if (t > bowStart) {
      const k = (t - bowStart) / (1 - bowStart);
      if (o.bow == "round") w *= Math.sqrt(Math.max(0, 1 - Math.pow(k, 2.2))) * 0.85 + 0.15 * (1 - k);
      else w *= Math.pow(Math.max(0, 1 - k * k), 0.6);
    }
    return w;
  }
  function deckHeight(t) {
    let h = o.freeboard;
    if (t > 0.7) h += o.sheer * Math.pow((t - 0.7) / 0.3, 2);
    if (t < 0.06) h += o.freeboard * 0.08 * (0.06 - t) / 0.06;
    return h;
  }
  function keel(t) {
    let k = -o.draft;
    if (t < 0.12) k *= 0.5 + 0.5 * t / 0.12; // cut away at the stern for the propeller
    if (o.bow != "bulb" && t > 0.85) k *= 1 - 0.55 * (t - 0.85) / 0.15;
    return k;
  }
  function roundness(t) {
    // big = boxy, small = round / V shaped
    if (t > bowStart) return 9 - 6.5 * (t - bowStart) / (1 - bowStart);
    if (t < 0.1) return 4 + 5 * t / 0.1;
    return 9;
  }

  const positions = [];
  const deckPoints = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const z = L / 2 - t * L;
    const w = halfWidth(t);
    const top = deckHeight(t);
    const bottom = keel(t);
    const n = roundness(t);
    const bowK = Math.max(0, (t - bowStart) / (1 - bowStart));
    for (let j = 0; j <= around * 2; j++) {
      let x, y;
      if (j == 0 || j == around * 2) {
        x = (j == 0 ? -1 : 1) * w;
        y = top + o.bulwark; // the bulwark: a low wall round the edge of the deck
      } else {
        const a = (j / (around * 2)) * Math.PI;
        const c = Math.cos(a);
        x = -Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w;
        y = top - (top - bottom) * Math.pow(Math.sin(a), 2 / n);
        if (y > 0) x *= 1 + o.flare * bowK * y / top; // bow flares out above the water
        else x *= 1 - 0.3 * bowK * (-y / o.draft); // and is sharp below it
      }
      // raked stem: the top of the bow leans forward
      const zz = z - (o.bow == "round" ? 0.15 : 0.45) * Math.pow(bowK, 3) * (y - bottom) / (top - bottom + 0.01);
      positions.push(x, y, zz);
    }
    deckPoints.push([-w * (1 + o.flare * bowK) * 0.99, top, z - (o.bow == "round" ? 0.15 : 0.45) * Math.pow(bowK, 3)]);
  }

  const row = around * 2 + 1;
  const index = [];
  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < row - 1; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometry, hullMaterial(o.colors, o.draft * 0.12)));

  // flat transom at the stern, made from the first section
  const transom = [];
  for (let j = 1; j < row - 1; j++) transom.push(new THREE.Vector2(positions[j * 3], positions[j * 3 + 1]));
  const transomMesh = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(transom)), hullMaterial(o.colors, o.draft * 0.12));
  transomMesh.position.z = L / 2 + 0.001;
  g.add(transomMesh);

  // deck: a strip joining the left and right edges of every section
  const deckPos = [];
  const deckUv = [];
  for (const p of deckPoints) {
    deckPos.push(p[0], p[1], p[2], -p[0], p[1], p[2]);
    deckUv.push(p[0] * 2, p[2] * 2, -p[0] * 2, p[2] * 2);
  }
  const deckIndex = [];
  for (let i = 0; i < deckPoints.length - 1; i++) {
    const a = i * 2;
    deckIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute("position", new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(deckUv, 2));
  deckGeometry.setIndex(deckIndex);
  deckGeometry.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeometry, deckMaterial(o.deckColor));
  deck.material.side = THREE.DoubleSide;
  g.add(deck);

  if (o.bow == "bulb") {
    const bulb = mesh(new THREE.SphereGeometry(1, 20, 12), hullMaterial(o.colors, o.draft * 0.12), 0, -o.draft * 0.62, -L / 2 + 0.05);
    bulb.scale.set(o.beam * 0.1, o.draft * 0.3, 0.45);
    g.add(bulb);
  }

  // anchors in their pockets either side of the bow
  for (const s of [-1, 1]) {
    const t = 0.93;
    const anchor = box(0.02, o.freeboard * 0.25, o.freeboard * 0.18, BLACK, s * halfWidth(t) * (1 + o.flare * 0.8) * 1.0, deckHeight(t) * 0.7, L / 2 - t * L - 0.1);
    g.add(anchor);
  }

  return {
    group: g,
    // handy for putting things on deck
    halfWidthAt: function (z) { return halfWidth((L / 2 - z) / L); },
    deckAt: function (z) { return deckHeight(Math.min(1, Math.max(0, (L / 2 - z) / L))); },
  };
}

// ---------- the ships ----------

const CONTAINER_COLOURS = [0x1f5fa8, 0xd9d9d9, 0xc0392b, 0x1e7d4e, 0xe67e22, 0xf1c40f, 0x2c3e50, 0x8e44ad, 0x7f8c8d, 0x16a085, 0xa0522d];

function containerShip(seed, spinners) {
  const random = seededRandom(seed);
  const m = 10 / 300; // a 300 m container ship
  const hull = makeHull({
    beam: 48 * m, freeboard: 12 * m, draft: 14 * m, sheer: 4 * m, bow: "bulb", flare: 0.25, bulwark: 1.2 * m,
    colors: { paint: [0x1d3557, 0x232323, 0x5c1a1a, 0x0f4c5c][Math.floor(random() * 4)] }, deckColor: 0x4a5560,
  });
  const g = hull.group;
  const houseZ = 3.2;

  // containers: lots of identical boxes, so draw them as one InstancedMesh
  const size = [2.44 * m, 2.59 * m, 12.19 * m];
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const material = new THREE.MeshStandardMaterial({ map: containerTexture, roughness: 0.6, metalness: 0.2 });
  const spots = [];
  const bayLength = size[2] + 1.2 * m;
  for (let z = -3.85; z < 4.55; z += bayLength) {
    if (z > houseZ - 0.4 && z < houseZ + 0.35) continue; // leave room for the house
    const deck = hull.deckAt(z);
    const halfWidth = Math.min(hull.halfWidthAt(z - size[2] / 2), hull.halfWidthAt(z + size[2] / 2)) - 1.5 * m;
    const rows = Math.floor(halfWidth * 2 / (size[0] + 0.1 * m));
    let tiers = 2 + Math.floor(random() * 5);
    if (z < -3) tiers = Math.min(tiers, 3); // lower at the bow so the bridge can see
    for (let r = 0; r < rows; r++) {
      const x = (r - (rows - 1) / 2) * (size[0] + 0.1 * m);
      const stack = Math.max(0, tiers - (random() < 0.15 ? Math.floor(random() * 3) : 0));
      for (let k = 0; k < stack; k++) spots.push([x, deck + 1.5 * m + size[1] * (k + 0.5), z]);
    }
    // hatch cover under the stack and a lashing bridge between bays
    g.add(box(halfWidth * 2, 1.5 * m, size[2], DARK_GREY, 0, deck + 0.75 * m, z));
    g.add(box(halfWidth * 2, 3 * size[1], 0.4 * m, LIGHT_GREY, 0, deck + 1.5 * m + 1.5 * size[1], z + bayLength / 2));
  }
  const containers = new THREE.InstancedMesh(geometry, material, spots.length);
  const matrix = new THREE.Matrix4();
  const colour = new THREE.Color();
  spots.forEach(function (p, i) {
    matrix.makeTranslation(p[0], p[1], p[2]);
    containers.setMatrixAt(i, matrix);
    containers.setColorAt(i, colour.set(CONTAINER_COLOURS[Math.floor(random() * CONTAINER_COLOURS.length)]));
  });
  g.add(containers);

  // accommodation block and bridge
  const deck = hull.deckAt(houseZ);
  const decks = 7;
  const houseHeight = decks * 2.9 * m;
  g.add(house(32 * m, houseHeight, 14 * m, decks, 0, deck, houseZ, 3.2 * m, false));
  g.add(bridge(34 * m, 3.4 * m, 12 * m, 48 * m, 0, deck + houseHeight, houseZ - 0.5 * m, 3.2 * m));
  g.add(radarMast(0, deck + houseHeight + 3.6 * m, houseZ + 2 * m, 9 * m, 12 * m, spinners));
  const stack = funnel(0, deck + houseHeight * 0.7, houseZ + 11 * m, 12 * m, 9 * m, 15 * m, 0xf2f4f6, [0x1f5fa8, 0xc0392b, 0xf5b700][Math.floor(random() * 3)]);
  g.add(stack);
  for (const s of [-1, 1]) g.add(lifeboat(s * 17.5 * m, deck + 3 * 2.9 * m, houseZ + 3 * m, 8 * m, s));
  g.add(navLights(24 * m, deck + houseHeight + 1.5 * m, houseZ - 2 * m, 4.95, 0.7 * m));

  // forecastle: breakwater, mast and mooring gear at the bow
  const bowDeck = hull.deckAt(-4.4);
  g.add(cylinder(0.8 * m, 1 * m, 18 * m, LIGHT_GREY, 0, bowDeck + 9 * m, -4.45, 8));
  for (const s of [-1, 1]) {
    const wall = box(20 * m, 3 * m, 0.6 * m, WHITE, s * 9 * m, bowDeck + 1.5 * m, -4.05);
    wall.rotation.y = s * 0.45;
    g.add(wall);
    g.add(cylinder(1.4 * m, 1.4 * m, 2 * m, DARK_GREY, s * 6 * m, bowDeck + 1 * m, -4.6, 10));
  }
  g.userData.smoke = [stack.userData.smokeAt];
  return g;
}

function tanker(seed, spinners) {
  const random = seededRandom(seed);
  const m = 10 / 250; // a 250 m tanker
  const hull = makeHull({
    beam: 44 * m, freeboard: 8 * m, draft: 15 * m, sheer: 3 * m, bow: "bulb", flare: 0.2, bulwark: 0.4 * m,
    colors: { paint: [0x2f2f33, 0x1d3557, 0x7a1c1c][Math.floor(random() * 3)] }, deckColor: 0x6b2a22,
  });
  const g = hull.group;
  const houseZ = 3.55;
  const deck = hull.deckAt(0);

  // pipes along the deck, and a raised walkway beside them
  for (let i = 0; i < 4; i++) {
    const pipe = cylinder(0.5 * m, 0.5 * m, 7.2, LIGHT_GREY, (i - 1.5) * 1.6 * m, deck + 1 * m, -0.6, 10);
    pipe.rotation.x = Math.PI / 2;
    g.add(pipe);
  }
  g.add(box(1.4 * m, 0.3 * m, 7.2, LIGHT_GREY, 5 * m, deck + 2.6 * m, -0.6));
  g.add(railing([[5.7 * m, -4.2], [5.7 * m, 3]], deck + 2.7 * m, 1.1 * m, 4 * m));
  for (let z = -4; z < 3; z += 0.35) g.add(box(0.3 * m, 2.5 * m, 0.3 * m, LIGHT_GREY, 5 * m, deck + 1.25 * m, z));

  // little valves and hatches all over the tank deck
  for (let z = -3.8; z < 2.8; z += 0.55) {
    for (const s of [-1, 1]) {
      g.add(cylinder(0.9 * m, 0.9 * m, 1 * m, DARK_GREY, s * 12 * m, deck + 0.5 * m, z, 8));
      g.add(cylinder(0.4 * m, 0.4 * m, 2.2 * m, LIGHT_GREY, s * 7 * m, deck + 1.1 * m, z + 0.2, 6));
    }
  }

  // loading manifold in the middle with a hose crane on each side
  for (let i = 0; i < 4; i++) {
    const pipe = cylinder(0.45 * m, 0.45 * m, 40 * m, LIGHT_GREY, 0, deck + 1.4 * m, -0.3 + i * 1.5 * m, 8);
    pipe.rotation.z = Math.PI / 2;
    g.add(pipe);
  }
  for (const s of [-1, 1]) {
    g.add(cylinder(0.8 * m, 1 * m, 9 * m, YELLOW, s * 14 * m, deck + 4.5 * m, -0.1, 10));
    const jib = box(0.7 * m, 0.7 * m, 14 * m, YELLOW, s * 14 * m, deck + 8.5 * m, -0.1 - 6 * m);
    jib.rotation.x = -0.35;
    g.add(jib);
  }

  // accommodation, bridge and funnel at the back
  const houseDeck = hull.deckAt(houseZ);
  const decks = 6;
  const h = decks * 2.9 * m;
  g.add(house(30 * m, h, 16 * m, decks, 0, houseDeck, houseZ, 3.2 * m, true));
  g.add(bridge(32 * m, 3.4 * m, 12 * m, 44 * m, 0, houseDeck + h, houseZ - 1 * m, 3.2 * m));
  g.add(radarMast(0, houseDeck + h + 3.6 * m, houseZ + 2 * m, 8 * m, 11 * m, spinners));
  const stack = funnel(0, houseDeck + h * 0.6, houseZ + 12 * m, 11 * m, 8 * m, 16 * m, 0x1b1d22, 0xd62828);
  g.add(stack);
  for (const s of [-1, 1]) g.add(lifeboat(s * 16 * m, houseDeck + 2 * 2.9 * m, houseZ + 2 * m, 8 * m, s));
  g.add(railing([[-15 * m, houseZ - 8 * m], [15 * m, houseZ - 8 * m]], houseDeck + h, 1.1 * m, 3 * m));
  g.add(navLights(22 * m, houseDeck + h + 1.5 * m, houseZ - 2 * m, 4.95, 0.7 * m));

  // raised forecastle with a mast
  const bowDeck = hull.deckAt(-4.5);
  g.add(cylinder(0.7 * m, 0.9 * m, 16 * m, LIGHT_GREY, 0, bowDeck + 8 * m, -4.4, 8));
  for (const s of [-1, 1]) g.add(cylinder(1.3 * m, 1.3 * m, 2 * m, DARK_GREY, s * 5 * m, bowDeck + 1 * m, -4.55, 10));
  g.userData.smoke = [stack.userData.smokeAt];
  return g;
}

function ferry(seed, spinners) {
  const m = 10 / 125; // a 125 m North Sea ferry
  const hull = makeHull({
    beam: 20 * m, freeboard: 7 * m, draft: 5 * m, sheer: 2 * m, bow: "raked", flare: 0.3, bulwark: 1 * m,
    colors: { paint: 0x14305e, upper: 0xf2f4f6, upperFrom: 5 * m }, deckColor: 0x6f7b86,
  });
  const g = hull.group;
  const deck = hull.deckAt(0);
  const d = 2.9 * m;

  // superstructure: decks that step back towards the bow
  g.add(house(19 * m, 3 * d, 88 * m, 3, 0, deck, 0.2, 3 * m, true));
  g.add(house(18 * m, 2 * d, 70 * m, 2, 0, deck + 3 * d, 0.6, 3 * m, true));
  g.add(house(14 * m, d, 40 * m, 1, 0, deck + 5 * d, 0.9, 3 * m, true));
  g.add(bridge(16 * m, 3.2 * m, 9 * m, 22 * m, 0, deck + 5 * d, -2.2, 3 * m));
  g.add(radarMast(0, deck + 5 * d + 3.4 * m, -1.85, 7 * m, 6 * m, spinners));

  // open deck at the back with railings
  const aft = 0.2 + 44 * m;
  g.add(railing([[-9.5 * m, aft], [9.5 * m, aft]], deck + 3 * d, 1.1 * m, 2 * m));
  g.add(railing([[-9 * m, 0.6 + 35 * m], [-9 * m, aft], [9 * m, aft], [9 * m, 0.6 + 35 * m]], deck + 5 * d, 1.1 * m, 2 * m));

  // lifeboats along both sides
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) g.add(lifeboat(s * 10.6 * m, deck + 2.3 * d, -1.3 + i * 0.75, 8 * m, s));
  }

  // two funnels in company colours
  const smoke = [];
  for (const s of [-1, 1]) {
    const stack = funnel(s * 3.5 * m, deck + 5 * d, 2.2, 4 * m, 7 * m, 9 * m, 0x14305e, 0xf2f4f6);
    g.add(stack);
    smoke.push(stack.userData.smokeAt);
  }
  g.add(navLights(11 * m, deck + 5 * d + 1.5 * m, -2.3, 4.95, 0.5 * m));

  // mooring gear on the bow
  const bowDeck = hull.deckAt(-4.3);
  for (const s of [-1, 1]) g.add(cylinder(0.9 * m, 0.9 * m, 1.5 * m, DARK_GREY, s * 3 * m, bowDeck + 0.75 * m, -4.3, 10));
  g.add(railing([[-6 * m, -3.6], [0, -4.9], [6 * m, -3.6]], bowDeck + 1 * m, 1 * m, 2 * m));
  g.userData.smoke = smoke;
  return g;
}

// platform supply vessel: the boats going in and out of Aberdeen to the rigs
function supplyVessel(seed, spinners) {
  const random = seededRandom(seed);
  const m = 10 / 85;
  const paint = [0xc1121f, 0xe85d04, 0x003049, 0x2b2d42][Math.floor(random() * 4)];
  const hull = makeHull({
    beam: 19 * m, freeboard: 3.2 * m, draft: 6 * m, sheer: 5 * m, bow: "raked", flare: 0.35, bulwark: 1.2 * m,
    colors: { paint: paint }, deckColor: 0x56606a,
  });
  const g = hull.group;
  const d = 2.8 * m;
  const houseZ = -3.1;
  const deck = hull.deckAt(houseZ);

  // superstructure at the front with the bridge on top
  g.add(house(17 * m, 3 * d, 20 * m, 3, 0, deck, houseZ, 2.6 * m, true));
  g.add(bridge(16 * m, 3.2 * m, 11 * m, 19 * m, 0, deck + 3 * d, houseZ - 2 * m, 2.6 * m));
  g.add(radarMast(-2 * m, deck + 3 * d + 3.4 * m, houseZ + 2 * m, 7 * m, 5 * m, spinners));
  g.add(radarMast(3 * m, deck + 3 * d + 3.4 * m, houseZ + 3 * m, 4 * m, 4 * m, spinners));
  g.add(lifeboat(9.2 * m, deck + 1.2 * d, houseZ + 6 * m, 6 * m, 1)); // rescue boat
  g.add(railing([[-8 * m, houseZ + 10 * m], [8 * m, houseZ + 10 * m]], deck + 3 * d, 1.1 * m, 1.5 * m));

  // two exhaust stacks behind the house
  const smoke = [];
  for (const s of [-1, 1]) {
    const stack = funnel(s * 6.5 * m, deck + 1.8 * d, houseZ + 11.5 * m, 2.4 * m, 3.5 * m, 9 * m, 0xf2f4f6, paint);
    g.add(stack);
    smoke.push(stack.userData.smokeAt);
  }

  // big open cargo deck with tall walls down both sides
  const cargoDeck = hull.deckAt(1.5);
  for (const s of [-1, 1]) {
    g.add(box(0.8 * m, 3 * m, 6.3, paint == 0x003049 ? WHITE : DARK_GREY, s * 9 * m, cargoDeck + 1.5 * m, 1.75));
  }
  // cargo: a couple of containers, a basket and a stack of pipes
  const cargoColours = [0x2a9d8f, 0xf4a261, 0x1f5fa8, 0xd62828];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.MeshStandardMaterial({ map: containerTexture, color: cargoColours[i], roughness: 0.6 });
    g.add(box(2.44 * m, 2.6 * m, 6.1 * m, c, (random() - 0.5) * 9 * m, cargoDeck + 1.3 * m, -0.6 + i * 0.95));
  }
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const pipe = cylinder(0.6 * m, 0.6 * m, 12 * m, ORANGE, -4 * m + (i + row * 0.5) * 1.2 * m, cargoDeck + 0.6 * m + row * 1.05 * m, 3.6, 10);
      pipe.rotation.x = Math.PI / 2;
      g.add(pipe);
    }
  }
  g.add(box(3 * m, 1.5 * m, 5 * m, YELLOW, 5 * m, cargoDeck + 0.75 * m, 3.8));

  // crane next to the house
  g.add(cylinder(1 * m, 1.2 * m, 6 * m, YELLOW, 7 * m, cargoDeck + 3 * m, houseZ + 13 * m, 10));
  const jib = box(0.8 * m, 0.8 * m, 16 * m, YELLOW, 7 * m, cargoDeck + 7 * m, houseZ + 20 * m);
  jib.rotation.x = 0.35;
  g.add(jib);
  g.add(navLights(9.6 * m, deck + 3 * d + 1.5 * m, houseZ - 2 * m, 4.95, 0.4 * m));
  g.userData.smoke = smoke;
  return g;
}

function tug(seed, spinners) {
  const random = seededRandom(seed);
  const m = 10 / 32; // a 32 m harbour tug
  const paint = [0x1b1b1f, 0x14305e, 0xc1121f][Math.floor(random() * 3)];
  const hull = makeHull({
    beam: 12 * m, freeboard: 2.2 * m, draft: 4.5 * m, sheer: 1.2 * m, bow: "round", flare: 0.1, bulwark: 0.8 * m,
    colors: { paint: paint }, deckColor: 0x5b6670,
  });
  const g = hull.group;
  const deck = hull.deckAt(0);

  // thick rubber fender all the way round the top of the hull
  const ring = [];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const z = 5 - t * 10;
    ring.push(new THREE.Vector3(-hull.halfWidthAt(z) * 1.02, deck - 0.3 * m, z));
  }
  for (let t = 1; t >= -0.0001; t -= 0.02) {
    const z = 5 - t * 10;
    ring.push(new THREE.Vector3(hull.halfWidthAt(z) * 1.02, deck - 0.3 * m, z));
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 160, 0.55 * m, 8, true), RUBBER));
  g.add(box(4 * m, 1.6 * m, 1.2 * m, RUBBER, 0, deck - 0.2 * m, -5.05)); // pushing fender on the bow
  for (let i = 0; i < 5; i++) { // old tyres along the sides
    for (const s of [-1, 1]) {
      const tyre = mesh(new THREE.TorusGeometry(0.45 * m, 0.18 * m, 6, 12), RUBBER, s * hull.halfWidthAt(-2 + i) * 1.06, deck - 1.2 * m, -2 + i);
      tyre.rotation.y = Math.PI / 2;
      g.add(tyre);
    }
  }

  // deckhouse with a tall wheelhouse on top, windows all round
  g.add(house(8 * m, 2.6 * m, 11 * m, 1, 0, deck, -0.6, 2 * m, true));
  g.add(house(6 * m, 2.6 * m, 6.5 * m, 1, 0, deck + 2.6 * m, -1.2, 2 * m, true));
  g.add(bridge(7 * m, 2.4 * m, 5 * m, 9 * m, 0, deck + 5.2 * m, -1.5, 1.6 * m));
  g.add(radarMast(0, deck + 7.8 * m, -0.9, 5 * m, 3 * m, spinners));
  g.add(railing([[-4 * m, 0.4], [-4 * m, -2.6], [4 * m, -2.6], [4 * m, 0.4]], deck + 2.6 * m, 1 * m, 1 * m));

  // two exhausts behind the wheelhouse
  const smoke = [];
  for (const s of [-1, 1]) {
    const stack = funnel(s * 2.4 * m, deck + 2.6 * m, 0.6, 1.4 * m, 1.6 * m, 5.5 * m, paint, 0xf2f4f6);
    g.add(stack);
    smoke.push(stack.userData.smokeAt);
  }

  // towing winch and the arch the tow line goes over
  const drum = cylinder(0.8 * m, 0.8 * m, 3 * m, DARK_GREY, 0, deck + 1 * m, 2.3, 16);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  g.add(box(5 * m, 0.4 * m, 0.4 * m, ORANGE, 0, deck + 3.6 * m, 3.4));
  for (const s of [-1, 1]) g.add(box(0.4 * m, 3.6 * m, 0.4 * m, ORANGE, s * 2.4 * m, deck + 1.8 * m, 3.4));
  for (const s of [-1, 1]) g.add(cylinder(0.4 * m, 0.4 * m, 0.9 * m, BLACK, s * 2.5 * m, deck + 0.45 * m, 4.2, 8));
  g.add(navLights(4.5 * m, deck + 6.2 * m, -1.6, 4.95, 0.25 * m));
  g.userData.smoke = smoke;
  return g;
}

function trawler(seed, spinners) {
  const random = seededRandom(seed);
  const m = 10 / 40; // a 40 m Scottish trawler
  const paint = [0x14305e, 0x0b6e4f, 0x7a1c1c, 0x1b1b1f][Math.floor(random() * 4)];
  const hull = makeHull({
    beam: 10 * m, freeboard: 3 * m, draft: 4.5 * m, sheer: 2.5 * m, bow: "round", flare: 0.25, bulwark: 1.1 * m,
    colors: { paint: paint }, deckColor: 0x7b6d5d,
  });
  const g = hull.group;
  const deck = hull.deckAt(-1);

  // whaleback shelter over the front of the deck, wheelhouse on top of it
  const shelter = mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, 0, Math.PI), WHITE, 0, deck, -2.8);
  shelter.rotation.z = Math.PI / 2;
  shelter.rotation.y = Math.PI / 2;
  shelter.scale.set(4 * m, 9 * m, 4.2 * m);
  g.add(shelter);
  g.add(house(6.5 * m, 2.6 * m, 6 * m, 1, 0, deck + 1.2 * m, -1.3, 1.6 * m, true));
  g.add(bridge(7 * m, 2.4 * m, 5 * m, 8 * m, 0, deck + 3.8 * m, -1.5, 1.4 * m));
  g.add(radarMast(0, deck + 6.2 * m, -0.9, 5 * m, 3 * m, spinners));
  const stack = funnel(0, deck + 3.8 * m, -0.4, 1.4 * m, 1.8 * m, 4 * m, 0xf2f4f6, paint);
  g.add(stack);

  // orange gantry at the stern, the net drum and the trawl doors
  for (const s of [-1, 1]) {
    const leg = box(0.6 * m, 9 * m, 0.6 * m, ORANGE, s * 3.8 * m, deck + 4.2 * m, 4.2);
    leg.rotation.x = 0.12;
    g.add(leg);
    const door = box(0.3 * m, 2 * m, 3 * m, DARK_GREY, s * 5.4 * m, deck + 1 * m, 4.1);
    g.add(door);
  }
  g.add(box(8.2 * m, 0.7 * m, 0.7 * m, ORANGE, 0, deck + 8.6 * m, 4.6));
  const drum = cylinder(1.6 * m, 1.6 * m, 5 * m, new THREE.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.7 }), 0, deck + 1.8 * m, 2.4, 16);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  // net wound round the drum
  const net = cylinder(2 * m, 2 * m, 3.6 * m, new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: 1 }), 0, deck + 1.8 * m, 2.4, 16);
  net.rotation.z = Math.PI / 2;
  g.add(net);
  // mast with outrigger booms
  g.add(cylinder(0.25 * m, 0.3 * m, 10 * m, LIGHT_GREY, 0, deck + 5 * m, 0.8, 8));
  for (const s of [-1, 1]) {
    const boom = cylinder(0.15 * m, 0.15 * m, 11 * m, LIGHT_GREY, s * 4.6 * m, deck + 7 * m, 0.8, 6);
    boom.rotation.z = s * 1.0;
    g.add(boom);
  }
  g.add(navLights(4 * m, deck + 5 * m, -1.6, 4.95, 0.25 * m));
  g.userData.smoke = [stack.userData.smokeAt];
  return g;
}

// pick the right model for the AIS ship type. seed (the MMSI) picks the colours.
export function makeShipModel(categoryName, typeNumber, seed) {
  const spinners = [];
  let model;
  if (categoryName == "Cargo") model = containerShip(seed, spinners);
  else if (categoryName == "Tanker") model = tanker(seed, spinners);
  else if (categoryName == "Passenger") model = ferry(seed, spinners);
  else if (categoryName == "Fishing") model = trawler(seed, spinners);
  else if (typeNumber == 52 || typeNumber == 31 || typeNumber == 32) model = tug(seed, spinners);
  else model = supplyVessel(seed, spinners);

  model.traverse(function (part) {
    if (part.isMesh) {
      part.castShadow = true;
      part.receiveShadow = true;
    }
  });
  model.userData.spinners = spinners; // radars, turned a little every frame
  return model;
}
