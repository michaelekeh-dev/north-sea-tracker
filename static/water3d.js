// Water for the 3D view. The map tiles are drawn with this shader: anywhere
// the tile is sea gets animated waves, reflections of the sky and sun glints,
// anywhere it's land just shows the map. Everything far away fades into haze.

import * as THREE from "three";

// shared by every tile, so one update per frame moves all the waves
export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(0xfff1d6) },
  uDeep: { value: new THREE.Color(0x0b2a3c) },
  uShallow: { value: new THREE.Color(0x2b7a8c) },
  uHorizon: { value: new THREE.Color(0xc3cfda) },
  uZenith: { value: new THREE.Color(0x4a7fb5) },
  uHazeNear: { value: 12 },
  uHazeFar: { value: 70 },
};

const vertexShader = `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uHazeNear;
uniform float uHazeFar;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uSatellite;
varying vec3 vWorld;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// smooth random bumps
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// height of the sea at a point: a couple of swells plus choppy noise on top.
// the coordinates get bent by noise first so the swells aren't perfectly straight
float waveHeight(vec2 p, float t) {
  vec2 q = p + vec2(noise(p * 20.0 + t * 0.05), noise(p * 20.0 + 7.3 - t * 0.05)) * 0.04;
  float h = 0.0;
  h += sin(dot(q, vec2(0.8, 0.6)) * 55.0 + t * 1.3) * 0.25;
  h += sin(dot(q, vec2(-0.45, 0.9)) * 83.0 + t * 1.7) * 0.15;
  h += noise(q * 120.0 + vec2(t * 0.5, t * 0.3)) * 0.6;
  h += noise(q * 260.0 - vec2(t * 0.7, -t * 0.4)) * 0.35;
  h += noise(q * 540.0 + vec2(t * 1.1, t * 0.2)) * 0.15;
  return h;
}

void main() {
  float dist = length(cameraPosition - vWorld);

  // work out which way the surface faces by comparing heights next to each other.
  // waves fade out in the distance so they don't flicker.
  float e = 0.0015;
  vec2 p = vWorld.xz;
  float strength = 0.0016 * mix(1.0, 0.1, smoothstep(1.0, 14.0, dist));
  float dx = (waveHeight(p + vec2(e, 0.0), uTime) - waveHeight(p - vec2(e, 0.0), uTime)) / (2.0 * e);
  float dz = (waveHeight(p + vec2(0.0, e), uTime) - waveHeight(p - vec2(0.0, e), uTime)) / (2.0 * e);
  vec3 normal = normalize(vec3(-dx * strength, 1.0, -dz * strength));

  vec3 view = normalize(cameraPosition - vWorld);
  // fresnel: you see more reflection looking across the water than straight down
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  vec3 reflected = reflect(-view, normal);
  reflected.y = abs(reflected.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(reflected.y, 0.0, 1.0), 0.45));

  // light coming up through the backs of the waves
  float glow = pow(max(dot(normal, normalize(uSunDir + vec3(0.0, 0.4, 0.0))), 0.0), 6.0);
  vec3 water = uDeep + uShallow * glow * 0.35;
  vec3 colour = mix(water, sky, fresnel);

  // the sun glinting off the waves
  float sunDot = max(dot(reflected, uSunDir), 0.0);
  colour += uSunColor * (pow(sunDot, 900.0) * 5.0 + pow(sunDot, 60.0) * 0.18);

  // land: show the map. Sea on the dark map is darker than land,
  // and on the satellite map it's bluer than it is red.
  if (uHasMap > 0.5) {
    vec3 tile = texture2D(uMap, vUv).rgb;
    vec3 s = pow(tile, vec3(1.0 / 2.2));
    float brightness = dot(s, vec3(0.299, 0.587, 0.114));
    float isWater;
    if (uSatellite > 0.5) {
      isWater = smoothstep(0.0, 0.05, s.b - s.r) * (1.0 - smoothstep(0.32, 0.42, brightness));
    } else {
      isWater = 1.0 - smoothstep(0.18, 0.22, brightness);
    }
    vec3 land = tile * (0.7 + 0.8 * max(uSunDir.y, 0.0));
    colour = mix(land, colour, isWater);
  }

  // haze towards the horizon
  colour = mix(colour, uHorizon, smoothstep(uHazeNear, uHazeFar, dist));

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeWaterMaterial(texture, satellite) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, waterUniforms, {
      uMap: { value: texture },
      uHasMap: { value: texture ? 1 : 0 },
      uSatellite: { value: satellite ? 1 : 0 },
    }),
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    polygonOffset: true, // pushed back so the wakes and rings on the water draw on top
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
  });
}

// foam texture for the wakes: lots of little white specks
export const foamTexture = (function () {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 1800; i++) {
    const r = Math.random() * 2.5 + 0.5;
    ctx.fillStyle = "rgba(255,255,255," + (Math.random() * 0.6 + 0.3) + ")";
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 256, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
})();

// soft round puff for smoke and the shadow under each ship
export function softCircle(colour) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, colour);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
