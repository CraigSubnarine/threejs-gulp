// Gulp! art: every fish and every bit of scenery is built in code from simple 3D shapes (no model files).
// Fish are built by species key, so a real model could replace one later.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Body proportions at length 1: height, thickness, and how much the head swells (groupers).
const SHAPES = {
  oval: { h: 0.42, w: 0.26 },
  disc: { h: 0.78, w: 0.16 },
  fat: { h: 0.5, w: 0.36, head: 0.25 },
  long: { h: 0.16, w: 0.13 },
  round: { h: 0.72, w: 0.66 },
  torpedo: { h: 0.24, w: 0.19 }, // sharks and apexes like the Barracuda: long but with some bulk
  eel: { h: 0.11, w: 0.09 },     // morays, sawfish, oarfish
  orca: { h: 0.34, w: 0.3 },     // round and solid
};
// ---------- Caustics: the rippling sunlight patterns that play over everything underwater ----------
// Added to three.js's standard material with onBeforeCompile: the fragment shader gets a cheap animated pattern from
// the world position, added on top of the lit colour (before fog, so far things fade). uCaustic dims it per zone.
export const water = { uTime: { value: 0 }, uCaustic: { value: 1 } };
const CAUSTIC_GLSL = `
uniform float uTime;
uniform float uCaustic;
varying vec3 vWPos;
float caustic(vec3 w) {
  vec2 p = vec2(w.x, w.z + w.y * 0.6) * 0.004, q = p;
  float t = uTime * 0.5, c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q = p + 0.6 * vec2(sin(q.y * 1.7 + t + fi), cos(q.x * 1.3 - t * 0.8 + fi * 1.7));
    c += 1.0 / (1.0 + 10.0 * abs(sin((q.x + q.y) * 3.1416)));
  }
  return pow(c / 3.0, 1.5) * clamp((w.y + ${WORLD.y.toFixed(1)}) / ${(2 * WORLD.y).toFixed(1)} + 0.25, 0.25, 1.0);
}
`;
function caustics(mat, strength) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = water.uTime;
    sh.uniforms.uCaustic = water.uCaustic;
    sh.vertexShader = `varying vec3 vWPos;\n${sh.vertexShader}`.replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = CAUSTIC_GLSL + sh.fragmentShader.replace('#include <fog_fragment>',
      `gl_FragColor.rgb += vec3(0.8, 0.97, 1.0) * caustic(vWPos) * ${strength.toFixed(2)} * uCaustic;\n#include <fog_fragment>`);
  };
  mat.customProgramCacheKey = () => `caustic${strength}`;
  return mat;
}

const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const flatFin = (pts, depth = 0.025) => {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
};

// A body: a sphere stretched along x (poles at nose and tail), coloured belly to back, with stripes.
function bodyGeometry(spec) {
  const sh = SHAPES[spec.shape];
  const g = new THREE.SphereGeometry(1, 14, 18).rotateZ(Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const body = new THREE.Color(spec.body), belly = new THREE.Color(spec.belly), stripe = new THREE.Color(spec.stripe ?? spec.body), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
    const x = ux * 0.5, k = sh.head && x > 0 ? 1 + sh.head * x / 0.5 : 1;
    pos.setXYZ(i, x, uy * sh.h / 2 * k, uz * sh.w / 2 * k);
    const t = (uy + 1) / 2; // 0 belly .. 1 back
    c.copy(belly).lerp(body, smooth(0.3, 0.62, t));
    if (spec.stripes?.some(s => Math.abs(x - s) < 0.06) && t > 0.18) c.copy(stripe);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Puffer spikes: little cones all over the body, merged into one mesh that grows when it puffs up.
function spikeGeometry(sh) {
  const list = [], n = 22, up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const yy = 1 - (i + 0.5) / n * 2, rr = Math.sqrt(1 - yy * yy), a = i * 2.39996;
    const d = new THREE.Vector3(Math.cos(a) * rr * 0.5, yy * sh.h / 2, Math.sin(a) * rr * sh.w / 2);
    const cone = new THREE.ConeGeometry(0.035, 0.16, 4).translate(0, 0.08, 0);
    cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize())).translate(d.x * 0.92, d.y * 0.92, d.z * 0.92);
    list.push(cone);
  }
  return mergeGeometries(list);
}

// Teeth for predators: two rows of small white cones along the jaw line near the nose, on both sides.
function teethGeometry(sh) {
  const list = [];
  for (let i = 0; i < 6; i++) {
    const x = 0.27 + i * 0.036, k = Math.sqrt(Math.max(0.05, 1 - (x / 0.5) ** 2)); // the body narrows towards the nose
    for (const side of [1, -1]) {
      list.push(new THREE.ConeGeometry(0.012, 0.05, 4).rotateX(Math.PI).translate(x, -sh.h * 0.04 * k, side * sh.w / 2 * k * 0.92)); // top row, pointing down
      list.push(new THREE.ConeGeometry(0.01, 0.04, 4).translate(x + 0.018, -sh.h * 0.22 * k, side * sh.w / 2 * k * 0.9));             // bottom row, pointing up
    }
  }
  return mergeGeometries(list);
}
const teethMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, flatShading: true });

// Geometry is built once per species and shared by every fish of it; materials once per species + variant.
const cache = new Map(), matCache = new Map();
function partsFor(spec) {
  if (cache.has(spec.key)) return cache.get(spec.key);
  const sh = SHAPES[spec.shape], eye = spec.eye ?? 1;
  const tailH = Math.min(sh.h, 0.5) * 0.75;
  const p = {
    sh,
    body: bodyGeometry(spec),
    tail: flatFin([[0.02, 0], [-0.3, tailH], [-0.22, 0], [-0.3, -tailH]], 0.03),
    dorsal: flatFin([[0.14, 0], [-0.16, 0], [-0.12, 0.17]]),
    side: flatFin([[0, 0], [-0.16, 0.05], [-0.13, -0.05]]),
    eye: new THREE.SphereGeometry(0.075 * eye, 10, 8),
    pupil: new THREE.SphereGeometry(0.042 * eye, 8, 6),
    spikes: null, // built when a puffer or a spiny fish needs them
    teeth: spec.teeth ? teethGeometry(sh) : null,
    bill: spec.bill ? new THREE.ConeGeometry(0.028, 0.5, 6).rotateZ(-Math.PI / 2).translate(0.72, -0.01, 0) : null, // a swordfish's sword
    patch: spec.patch ? new THREE.SphereGeometry(1, 10, 6) : null, // an orca's white eye patch
  };
  cache.set(spec.key, p);
  return p;
}
// Rare variants look different: golden is shiny metal, giant is darker, speedy glows blue, spiny has purple fins
// (and spikes, added in makeFish).
function matsFor(spec, variant) {
  const key = `${spec.key}/${variant ?? ''}`;
  if (matCache.has(key)) return matCache.get(key);
  const std = o => caustics(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.55, metalness: 0.05, ...o }), 0.3);
  const m = variant === 'golden'
    ? { body: std({ color: 0xffcf3a, metalness: 0.8, roughness: 0.25, emissive: 0x4a2a00 }), fin: std({ color: 0xffe27a, metalness: 0.6, roughness: 0.3, emissive: 0x3a2200, side: THREE.DoubleSide }) }
    : {
      body: std({ vertexColors: true, color: variant === 'giant' ? 0x8c8c8c : 0xffffff, emissive: variant === 'speedy' ? 0x1f7fff : 0x000000, emissiveIntensity: 0.6 }),
      fin: std({ color: variant === 'spiny' ? 0x8a2ec8 : spec.fin, roughness: 0.6, side: THREE.DoubleSide, emissive: variant === 'speedy' ? 0x1f7fff : 0x000000, emissiveIntensity: 0.6 }),
    };
  matCache.set(key, m);
  return m;
}
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.2 });

// One fish at length 1, facing +x. root: position and size; yaw: which way it faces; pitch: nose up or down;
// tail: wags. The game scales root by the fish's length. variant: null or a key of VARIANTS.
export function makeFish(spec, variant = null) {
  const p = partsFor(spec), sh = p.sh, mats = matsFor(spec, variant);
  const root = new THREE.Group(), yaw = new THREE.Group(), pitch = new THREE.Group(), tail = new THREE.Group();
  root.add(yaw);
  yaw.add(pitch);
  pitch.add(new THREE.Mesh(p.body, mats.body));
  tail.position.x = -0.46;
  tail.add(new THREE.Mesh(p.tail, mats.fin));
  pitch.add(tail);
  if (spec.shape !== 'round') {
    const d = new THREE.Mesh(p.dorsal, mats.fin);
    d.position.set(0.02, sh.h / 2 * 0.9 * (sh.head ? 1.05 : 1), 0);
    d.scale.setScalar((spec.shape === 'disc' ? 1.5 : 1) * (spec.dorsal ?? 1)); // sharks and orcas: a tall fin
    pitch.add(d);
  }
  for (const side of [1, -1]) {
    const f = new THREE.Mesh(p.side, mats.fin);
    f.position.set(0.1, -sh.h * 0.12, side * sh.w / 2 * 0.85);
    f.rotation.y = side * 0.5;
    pitch.add(f);
    // Eyes sit on the body's surface near the nose (bigger heads push them out).
    const k = sh.head ? 1 + sh.head * 0.6 : 1, ey = sh.h / 2 * 0.22 * k, ez = sh.w / 2 * Math.sqrt(0.59) * k;
    const e = new THREE.Mesh(p.eye, eyeMat), pu = new THREE.Mesh(p.pupil, pupilMat);
    e.position.set(0.3, ey, side * ez);
    pu.position.set(0.33, ey, side * (ez + 0.045 * (spec.eye ?? 1)));
    pitch.add(e, pu);
  }
  let spikes = null;
  if (spec.behavior === 'puff' || variant === 'spiny') { // puffers grow theirs when they puff up; spiny fish always have them
    p.spikes ??= spikeGeometry(sh);
    spikes = new THREE.Mesh(p.spikes, mats.fin);
    spikes.scale.setScalar(variant === 'spiny' ? 0.85 : 0.001);
    pitch.add(spikes);
  }
  if (p.teeth) pitch.add(new THREE.Mesh(p.teeth, teethMat));
  if (p.bill) pitch.add(new THREE.Mesh(p.bill, mats.fin));
  if (p.patch) for (const side of [1, -1]) {
    const m = new THREE.Mesh(p.patch, eyeMat);
    m.position.set(0.2, sh.h * 0.13, side * sh.w / 2 * 0.86);
    m.scale.set(0.11, 0.045, 0.03);
    pitch.add(m);
  }
  return { root, yaw, pitch, tail, spikes, mats }; // mats: an apex flashes its own body red when bitten
}

// Small pictures of each fish for the food chain bar, rendered once with a throwaway renderer.
export function makeIcons(specs) {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(96, 64, false);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x446688, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, 2, 3);
  sc.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1.5, 0.1, 10);
  cam.position.set(-0.12, 0, 2.5);
  const out = {};
  for (const s of specs) {
    const f = makeFish(s);
    f.yaw.rotation.y = s.shape === 'long' ? -0.25 : -0.5;
    if (f.spikes) f.spikes.scale.setScalar(0.6);
    sc.add(f.root);
    r.render(sc, cam);
    out[s.key] = r.domElement.toDataURL();
    sc.remove(f.root);
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}

// ---------- Scenery ----------
// Everything static is merged into one mesh (one draw call), coloured per vertex.
function colored(geo, color, m) {
  const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
  const c = new THREE.Color(color), col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) c.toArray(col, i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// How far the scenery reaches either side (a little past the edge of the play area), and how many times wider that
// is than the original sea, so prop counts keep the same density.
const SPAN = WORLD.x + 300, WIDE = SPAN / 4200;
const across = (i, n, jitter, R) => -SPAN + (i + 0.5) * 2 * SPAN / n + R(-jitter, jitter); // n things spread evenly across

// The sea floor's dunes, so props can sit on it.
const floorAt = (x, z, base) => base + 30 * Math.sin(x / 420) + 22 * Math.sin(z / 310 + x / 760);

// The water's colour at a height: lighter near the surface, darker down deep. The fog follows it.
// water: { top, bottom } colours (a level's own, or its zone's).
export const waterAt = (water, y, c = new THREE.Color()) =>
  c.set(water.bottom).lerp(new THREE.Color(water.top), Math.min(1, Math.max(0, (y + WORLD.y) / (2 * WORLD.y))));

// Each level's landmark: big scenery that makes the spot recognisable, merged in with the other props.
function landmark(kind, geos, R, base, rand, CORAL) {
  const at = (x, z) => floorAt(x, z, base), pick = () => CORAL[Math.floor(rand() * CORAL.length)];
  if (kind === 'garden') { // giant brain corals with tall coral trees around them
    for (let i = 0, n = Math.round(7 * WIDE); i < n; i++) {
      const x = across(i, n, 300, R), z = R(-1900, -900), r = R(220, 340);
      geos.push(colored(new THREE.IcosahedronGeometry(1, 2), pick(), M(x, at(x, z), z, 0, R(0, 3), 0, r, r * 0.65, r)));
      for (let b = 0; b < 6; b++) {
        const len = R(300, 520);
        geos.push(colored(new THREE.CylinderGeometry(10, 22, len, 5).translate(0, len / 2, 0), pick(), M(x + R(-280, 280), at(x, z), z + R(-200, 200), R(-0.3, 0.3), 0, R(-0.5, 0.5))));
      }
    }
  } else if (kind === 'grass') { // a seagrass meadow
    for (let i = 0, n = Math.round(520 * WIDE); i < n; i++) {
      const x = R(-SPAN, SPAN), z = R(-2200, -150), h = R(70, 230);
      geos.push(colored(new THREE.ConeGeometry(6, h, 3).translate(0, h / 2, 0), i % 3 ? 0x58b85c : 0x7fcf5a, M(x, at(x, z), z, R(-0.2, 0.2), R(0, 3), R(-0.3, 0.3))));
    }
  } else if (kind === 'wreck') { // a sunken ship, half buried and tilted, with barrels scattered around
    const x = R(-400, 400), z = -1500, tilt = M(x, at(x, z) + 120, z, 0, 0.35, 0.18);
    const part = (geo, color, m) => geos.push(colored(geo, color, tilt.clone().multiply(m)));
    part(new THREE.BoxGeometry(1700, 300, 420), 0x5b4632, M(0, 0, 0));
    part(new THREE.ConeGeometry(300, 420, 4).rotateZ(-Math.PI / 2), 0x5b4632, M(1060, 0, 0, Math.PI / 4, 0, 0, 1, 0.75, 1)); // bow
    part(new THREE.BoxGeometry(420, 220, 320), 0x3e2f22, M(-450, 260, 0)); // cabin
    part(new THREE.CylinderGeometry(20, 26, 1100, 6).translate(0, 550, 0), 0x3e2f22, M(150, 150, 0, 0, 0, -0.25)); // mast
    part(new THREE.CylinderGeometry(18, 22, 650, 6).translate(0, 325, 0), 0x3e2f22, M(-200, 150, 0, 0, 0, 1.1)); // broken mast
    for (let i = 0; i < 7; i++) {
      const bx = x + R(-1000, 1000), bz = z + R(250, 600);
      geos.push(colored(new THREE.CylinderGeometry(45, 45, 90, 8), 0x7a5a38, M(bx, at(bx, bz) + 40, bz, R(0, 1.6), 0, R(0, 1.6))));
    }
  } else if (kind === 'arches') { // stone arches standing on the floor, coral on top
    for (let i = 0, n = Math.round(4 * WIDE); i < n; i++) {
      const x = across(i, n, 300, R), z = R(-2200, -900), r = R(380, 520), t = R(70, 110);
      geos.push(colored(new THREE.TorusGeometry(r, t, 5, 12, Math.PI), 0x76889a, M(x, at(x, z) - t * 0.5, z, 0, R(-0.5, 0.5), 0)));
      geos.push(colored(new THREE.IcosahedronGeometry(1, 1), pick(), M(x, at(x, z) + r + t * 0.6, z, 0, 0, 0, t * 1.2, t * 0.6, t * 1.2)));
    }
  } else if (kind === 'wall') { // the reef wall at the edge of the drop-off
    for (let i = 0, n = Math.round(70 * WIDE); i < n; i++) {
      const x = across(i, n, 40, R), z = R(-1500, -1250), h = R(500, 1100), r = R(140, 220), y0 = at(x, z);
      for (let y = y0; y < y0 + h; y += r * 1.1) geos.push(colored(new THREE.DodecahedronGeometry(1, 0), (i + Math.round(y / r)) % 2 ? 0x6d7f92 : 0x7a8ea0, M(x, y, z + R(-60, 60), R(0, 3), R(0, 3), R(0, 3), r, r * 0.8, r)));
      if (rand() < 0.7) geos.push(colored(new THREE.IcosahedronGeometry(1, 1), pick(), M(x, y0 + h, z + 40, 0, 0, 0, r * 0.8, r * 0.45, r * 0.8)));
    }
  }
}

// Obstacles on the play plane (z = 0): rock pillars rising from the floor and arches you can swim under. Each rock
// is also a collision circle (x, y, r) that you and the fish can't pass through. None near where you start.
function obstacles(geos, R, rand, CORAL, clear = []) {
  const circles = [], floor = -WORLD.y - 50, half = WORLD.x - 300, n = OBSTACLES.count;
  const rock = (x, y, r, k) => {
    geos.push(colored(new THREE.DodecahedronGeometry(1, 0), k % 2 ? 0x75899a : 0x667b8c, M(x, y, 0, R(0, 3), R(0, 3), R(0, 3), r, r * 0.92, r * 0.8)));
    circles.push({ x, y, r: r * 0.9 });
  };
  const cap = (x, y, r) => geos.push(colored(new THREE.IcosahedronGeometry(1, 1), CORAL[Math.floor(rand() * CORAL.length)], M(x, y, 0, 0, R(0, 3), 0, r, r * 0.5, r * 0.7)));
  for (let i = 0; i < n; i++) {
    let x = -half + (i + 0.5) * 2 * half / n + R(-250, 250);
    if (Math.abs(x) < OBSTACLES.clear) x = Math.sign(x || 1) * (OBSTACLES.clear + R(0, 300));
    if (clear.some(c => Math.abs(x - c) < 1500)) continue; // room for the level's wreck
    if (rand() < 0.65) { // a pillar: a stack of rocks getting smaller towards the top
      let y = floor, r = R(150, 240);
      for (let k = 0, h = 3 + Math.floor(rand() * 6); k < h; k++, r *= R(0.8, 0.9)) { // 3-8 rocks: some reach mid-water
        y += k ? r * 1.5 : r * 0.6;
        rock(x + R(-30, 30), y, r, k);
      }
      if (rand() < 0.6) cap(x, y + r * 0.8, r * 1.1);
    } else { // an arch: two legs and a curved top, with a gap underneath to swim through
      const w = R(380, 600), h = R(900, 1500), r = R(100, 140);
      for (const side of [-1, 1]) for (let y = floor + r * 0.5; y < floor + h - r; y += r * 1.4) rock(x + side * w, y, r, Math.round(y));
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI * k / 8;
        rock(x - Math.cos(a) * w, floor + h - r + Math.sin(a) * r * 2.2, r, k);
      }
      cap(x, floor + h + r * 1.4, r * 1.3);
    }
  }
  return circles;
}

// Builds one level's scenery into the scene: its zone's style with the level's own colours, prop mix and landmark.
// rand is a seeded generator, so a level looks the same every time. clear: x positions to keep free of rocks. Returns update(dt, camera) for the moving
// bits (light rays, bubbles, marine snow), dispose(), and circles: the obstacles you can't swim through.
export function makeZone(zone, spot, scene, rand, clear = []) {
  const group = new THREE.Group(), base = -WORLD.y - 70, R = (a, b) => a + rand() * (b - a), water = spot.water ?? zone.water;
  scene.add(group);

  // Background: a huge gradient wall far behind everything (no fog on it).
  const bg = new THREE.PlaneGeometry(2 * SPAN + 6000, 9000, 1, 12), bc = new Float32Array(bg.attributes.position.count * 3), c = new THREE.Color();
  for (let i = 0; i < bg.attributes.position.count; i++) waterAt(water, bg.attributes.position.getY(i) * 0.9, c).toArray(bc, i * 3);
  bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const wall = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  wall.position.z = -3800;
  group.add(wall);

  // Sea floor with dunes.
  const fl = new THREE.PlaneGeometry(2 * SPAN + 5000, 7000, Math.round(80 * WIDE), 36).rotateX(-Math.PI / 2);
  const fp = fl.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setY(i, floorAt(fp.getX(i), fp.getZ(i) - 2000, base) - base);
  fl.computeVertexNormals();
  const floor = new THREE.Mesh(fl, caustics(new THREE.MeshStandardMaterial({ color: spot.floor ?? zone.floor, flatShading: true, roughness: 0.95 }), 0.55));
  floor.position.set(0, base, -2000);
  group.add(floor);

  // The surface, seen from below: a faint sheet tinted like the water just under it (a near-white one washed the
  // top of the screen out).
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(2 * SPAN + 5000, 7000).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(water.top).lerp(new THREE.Color(0xffffff), 0.25), transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  surf.position.set(0, WORLD.y + 90, -2000);
  group.add(surf);

  // Coral, rocks and weed behind the play plane (z < 0); the camera's perspective gives them parallax.
  // The level sets how many props there are and how much of the mix is rock and weed.
  const CORAL = [0xff6f91, 0xff9f43, 0xb36bff, 0xffd166, 0x5ee6b0, 0xff5e5e];
  const geos = [], kinds = [0.3, 0.2, 0.15, 0.1, 0.15 * (spot.rocks ?? 1), 0.1 * (spot.weed ?? 1)];
  const total = kinds.reduce((a, b) => a + b), cut = kinds.map((k, i) => kinds.slice(0, i + 1).reduce((a, b) => a + b) / total);
  for (let i = 0, n = Math.round((spot.coral ?? 150) * WIDE); i < n; i++) {
    const x = R(-SPAN, SPAN), z = R(-2900, -120), y = floorAt(x, z, base), roll = rand(), col = CORAL[Math.floor(rand() * CORAL.length)];
    const kind = cut.findIndex(c => roll < c); // 0 branch, 1 brain, 2 tube, 3 fan, 4 rock, 5 weed
    if (kind === 0) { // branching coral
      for (let b = 0, n = 4 + Math.floor(rand() * 4); b < n; b++) {
        const len = R(90, 240), tilt = R(-0.7, 0.7), r = R(7, 13);
        geos.push(colored(new THREE.CylinderGeometry(r * 0.6, r, len, 5).translate(0, len / 2, 0), col, M(x + R(-20, 20), y, z + R(-20, 20), R(-0.3, 0.3), 0, tilt)));
      }
    } else if (kind === 1) { // brain coral
      const r = R(50, 120);
      geos.push(colored(new THREE.IcosahedronGeometry(1, 1), col, M(x, y, z, 0, R(0, 3), 0, r, r * 0.6, r)));
    } else if (kind === 2) { // tube coral
      for (let b = 0, n = 3 + Math.floor(rand() * 4); b < n; b++) {
        const h = R(60, 180), r = R(12, 22);
        geos.push(colored(new THREE.CylinderGeometry(r, r * 0.8, h, 7).translate(0, h / 2, 0), col, M(x + R(-40, 40), y, z + R(-30, 30))));
      }
    } else if (kind === 3) { // sea fan
      const r = R(90, 200);
      geos.push(colored(new THREE.CircleGeometry(1, 9, 0, Math.PI), col, M(x, y, z, 0, R(-0.4, 0.4), 0, r)));
    } else if (kind === 4) { // rock
      const r = R(50, 160);
      geos.push(colored(new THREE.DodecahedronGeometry(1, 0), 0x6f8796, M(x, y + r * 0.2, z, R(0, 3), R(0, 3), R(0, 3), r, r * R(0.5, 0.9), r)));
    } else { // weed
      for (let b = 0, n = 3 + Math.floor(rand() * 3); b < n; b++) {
        const h = R(120, 300);
        geos.push(colored(new THREE.ConeGeometry(10, h, 4).translate(0, h / 2, 0), 0x3fae5a, M(x + R(-25, 25), y, z, 0, 0, R(-0.25, 0.25))));
      }
    }
  }
  // Rock spires rising from the floor behind the play area: mid-distance shapes that slide past as you swim.
  for (let i = 0, n = Math.round((spot.spires ?? 14) * WIDE); i < n; i++) {
    const x = across(i, n, 200, R), z = R(-3100, -1700);
    let y = floorAt(x, z, base), r = R(110, 180);
    for (let k = 0, n = 3 + Math.floor(rand() * 4); k < n; k++, r *= R(0.72, 0.88)) {
      geos.push(colored(new THREE.DodecahedronGeometry(1, 0), k % 2 ? 0x7d93a0 : 0x6a8290, M(x + R(-40, 40), y + r * 0.7, z + R(-30, 30), R(0, 3), R(0, 3), R(0, 3), r, r * 1.2, r)));
      y += r * 1.5;
    }
    if (rand() < 0.6) geos.push(colored(new THREE.IcosahedronGeometry(1, 1), CORAL[Math.floor(rand() * CORAL.length)], M(x, y + 10, z, 0, 0, 0, r * 0.9, r * 0.5, r * 0.9)));
  }
  landmark(spot.landmark, geos, R, base, rand, CORAL);
  const circles = obstacles(geos, R, rand, CORAL, clear);
  const props = new THREE.Mesh(mergeGeometries(geos), caustics(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }), 0.4));
  group.add(props);

  // Light rays from the surface: faint additive cones that sway.
  const rayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const rays = [];
  for (let i = 0, n = Math.round((spot.rays ?? 9) * WIDE); i < n; i++) {
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(30, 260, 3600, 12, 1, true).translate(0, -1800, 0), rayMat);
    ray.position.set(across(i, n, 200, R), WORLD.y + 100, R(-1400, -300));
    ray.userData.phase = rand() * 6;
    rays.push(ray);
    group.add(ray);
  }

  // Bubbles drifting up around the camera.
  const N = 240, bp = new Float32Array(N * 3), speeds = new Float32Array(N);
  for (let i = 0; i < N; i++) { bp[i * 3] = R(-1600, 1600); bp[i * 3 + 1] = R(-1600, 1600); bp[i * 3 + 2] = R(-900, 300); speeds[i] = R(40, 120); }
  const bgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(bp, 3));
  const bubbles = new THREE.Points(bgeo, new THREE.PointsMaterial({ map: bubbleTexture(), size: 14, transparent: true, opacity: 0.6, depthWrite: false }));
  group.add(bubbles);

  // Marine snow: soft specks drifting down between the play area and the camera, so the water itself has depth.
  const S = 170, sp = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) { sp[i * 3] = R(-1600, 1600); sp[i * 3 + 1] = R(-1600, 1600); sp[i * 3 + 2] = R(150, 900); }
  const sgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3));
  group.add(new THREE.Points(sgeo, new THREE.PointsMaterial({ map: dotTexture(), size: 11, color: 0xeef8ff, transparent: true, opacity: 0.55, depthWrite: false })));

  let t = 0;
  return {
    group,
    circles,
    update(dt, cam) {
      t += dt;
      for (let i = 0; i < S; i++) {
        const j = i * 3;
        sp[j + 1] -= (10 + (i % 7) * 3) * dt;
        sp[j] += Math.sin(t * 0.4 + i) * 6 * dt;
        if (sp[j + 1] < cam.position.y - 1600) sp[j + 1] += 3200;
        if (sp[j + 1] > cam.position.y + 1600) sp[j + 1] -= 3200;
        if (sp[j] > cam.position.x + 1600) sp[j] -= 3200;
        if (sp[j] < cam.position.x - 1600) sp[j] += 3200;
      }
      sgeo.attributes.position.needsUpdate = true;
      for (const r of rays) r.rotation.z = Math.sin(t * 0.25 + r.userData.phase) * 0.12;
      for (let i = 0; i < N; i++) {
        const j = i * 3;
        bp[j + 1] += speeds[i] * dt;
        bp[j] += Math.sin(t * 2 + i) * 8 * dt;
        if (bp[j + 1] > cam.position.y + 1600) bp[j + 1] -= 3200;
        if (bp[j + 1] < cam.position.y - 1600) bp[j + 1] += 3200;
        if (bp[j] > cam.position.x + 1600) bp[j] -= 3200;
        if (bp[j] < cam.position.x - 1600) bp[j] += 3200;
      }
      bgeo.attributes.position.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => { o.geometry?.dispose(); });
    },
  };
}

let bubbleTex;
export function bubbleTexture() {
  if (bubbleTex) return bubbleTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.arc(12, 11, 4, 0, Math.PI * 2); g.fill();
  bubbleTex = new THREE.CanvasTexture(cv);
  bubbleTex.colorSpace = THREE.SRGBColorSpace; // canvas colours are sRGB, or they come out washed out
  return bubbleTex;
}

let dotTex;
function dotTexture() {
  if (dotTex) return dotTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(cv);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

// A round badge with a symbol on it, always drawn on top: the red "!" over a hunter that starts chasing you, and the
// symbols inside power-up bubbles. One material per badge, shared.
const badgeMats = new Map();
export function makeBadge(text, color, size = 54) {
  const key = `${text}/${color}`;
  if (!badgeMats.has(key)) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = color; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 32, 35);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    badgeMats.set(key, new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  }
  const s = new THREE.Sprite(badgeMats.get(key));
  s.scale.setScalar(size);
  s.renderOrder = 10;
  return s;
}
export const makeWarn = () => makeBadge('!', '#ff3b3b');

// ---------- Oysters and power-ups ----------
// An oyster at width 1, sitting on its flat bottom: a ridged bottom shell, a pink inside, a pearl, and a lid on a
// hinge at the back (lid.rotation.x below 0 opens it towards the camera). The pearl is white or black.
const oysterGeo = {};
const shellMat = caustics(new THREE.MeshStandardMaterial({ color: 0x8f8597, roughness: 0.85, flatShading: true }), 0.4);
const insideMat = new THREE.MeshStandardMaterial({ color: 0xffc7d6, roughness: 0.4, flatShading: true, side: THREE.DoubleSide });
const pearlMats = {
  white: new THREE.MeshStandardMaterial({ color: 0xfdfbff, roughness: 0.12, metalness: 0.25, emissive: 0x5a5a6a }),
  black: new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.1, metalness: 0.7, emissive: 0x2a1a44 }),
};
export function makeOyster() {
  oysterGeo.half ??= new THREE.SphereGeometry(0.5, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.32, 0.8); // a dome
  oysterGeo.inside ??= new THREE.CircleGeometry(0.47, 14).rotateX(-Math.PI / 2).scale(1, 1, 0.78);
  oysterGeo.pearl ??= new THREE.SphereGeometry(0.1, 14, 10);
  const root = new THREE.Group(), bottom = new THREE.Mesh(oysterGeo.half, shellMat);
  bottom.rotation.x = Math.PI; // upside down: the bottom shell's dome points down
  bottom.position.y = 0.16;
  const inside = new THREE.Mesh(oysterGeo.inside, insideMat);
  inside.position.y = 0.165;
  const hinge = new THREE.Group(), lid = new THREE.Mesh(oysterGeo.half, shellMat);
  hinge.position.set(0, 0.16, -0.4);
  lid.position.z = 0.4;
  hinge.add(lid);
  const pearl = new THREE.Mesh(oysterGeo.pearl, pearlMats.white);
  pearl.position.set(0, 0.25, 0.05);
  root.add(bottom, inside, hinge, pearl);
  return { root, hinge, pearl, setBlack: black => { pearl.material = black ? pearlMats.black : pearlMats.white; } };
}

// A power-up: a see-through bubble with its symbol inside.
const pickupBubble = new THREE.SphereGeometry(1, 16, 12);
const pickupMat = new THREE.MeshStandardMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1, depthWrite: false });
export function makePickup(kind) {
  const root = new THREE.Group(), k = PICKUPS.kinds[kind];
  const bubble = new THREE.Mesh(pickupBubble, pickupMat);
  bubble.scale.setScalar(48);
  root.add(bubble, makeBadge(k.symbol, k.color, 60));
  return root;
}

// ---------- Wreckage, shards and the portal ----------
// A wrecked boat on the play plane, built around x = 0 on the floor: a hull broken in two (leaning halves with a gap
// between them where the shard hides), a mast fallen across the top, and crates. Returns the mesh, its collision
// circles, where the shard sits and the openings an eel could hide in (all relative to x = 0).
const woodMat = caustics(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }), 0.35);
export function makeWreck(rand) {
  const R = (a, b) => a + rand() * (b - a), geos = [], circles = [], floor = -WORLD.y - 20;
  // A plank-built box, tilted, plus circles along its length.
  const hull = (cx, cy, len, h, tilt, color) => {
    const m = M(cx, cy, 0, 0, 0, tilt);
    geos.push(colored(new THREE.BoxGeometry(len, h, 200), color, m));
    for (let k = 0; k < 4; k++) geos.push(colored(new THREE.BoxGeometry(len * 1.01, 10, 204), 0x3a2a1c, m.clone().multiply(M(0, -h / 2 + (k + 0.5) * h / 4, 0))));
    const n = Math.ceil(len / (h * 0.75));
    for (let k = 0; k < n; k++) {
      const t = -len / 2 + h / 2 + k * (len - h) / Math.max(1, n - 1);
      circles.push({ x: cx + Math.cos(tilt) * t, y: cy + Math.sin(tilt) * t, r: h * 0.55 });
    }
  };
  hull(-470, floor + 150, 680, 230, 0.22, 0x6b5038);
  hull(450, floor + 165, 620, 240, -0.3, 0x5e4630);
  // The fallen mast across the gap, high enough to swim under.
  const mx0 = -560, my0 = floor + 520, mx1 = 560, my1 = floor + 400, ml = Math.hypot(mx1 - mx0, my1 - my0), ma = Math.atan2(my1 - my0, mx1 - mx0);
  geos.push(colored(new THREE.CylinderGeometry(24, 30, ml, 7).rotateZ(Math.PI / 2), 0x4a3726, M((mx0 + mx1) / 2, (my0 + my1) / 2, 0, 0, 0, ma)));
  for (let k = 0; k <= 12; k++) circles.push({ x: mx0 + (mx1 - mx0) * k / 12, y: my0 + (my1 - my0) * k / 12, r: 40 });
  // Crates scattered on the floor either side.
  for (const x of [-980 + R(-60, 60), 920 + R(-60, 60), -1130 + R(-40, 40)]) {
    const s = R(90, 130);
    geos.push(colored(new THREE.BoxGeometry(s, s, s), 0x8a6a44, M(x, floor + s / 2, 0, 0, R(0, 1), R(-0.2, 0.2))));
    circles.push({ x, y: floor + s / 2, r: s * 0.62 });
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), woodMat);
  return { mesh, circles, shard: { x: 0, y: floor + 95 }, holes: [{ x: -470, y: floor + 150, dir: -1 }, { x: 0, y: floor + 95, dir: 1 }, { x: 450, y: floor + 165, dir: 1 }] };
}

// A glowing crystal shard, and a sparkle that shows where it is once you're close.
const shardMat = new THREE.MeshStandardMaterial({ color: 0x9ef0ff, emissive: 0x3fc8ff, emissiveIntensity: 1.2, roughness: 0.15, metalness: 0.3, flatShading: true });
export function makeShard() {
  const root = new THREE.Group(), gem = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), shardMat);
  gem.scale.set(26, 52, 26);
  const glint = makeBadge('✦', '#3fc8ff', 70);
  glint.position.y = 90;
  root.add(gem, glint);
  return { root, gem, glint };
}

// The portal: a glowing ring with a swirling disc inside, and the orb (the five shards made whole) at its heart.
const portalMat = new THREE.MeshStandardMaterial({ color: 0xc58bff, emissive: 0x8a3fff, emissiveIntensity: 1.4, roughness: 0.3, flatShading: true });
const swirlMat = new THREE.MeshBasicMaterial({ color: 0x6a2fd0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
export function makePortal() {
  const root = new THREE.Group(), ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 8, 28), portalMat);
  const swirl = new THREE.Mesh(new THREE.CircleGeometry(0.95, 6), swirlMat), orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), shardMat);
  root.add(ring, swirl, orb);
  return { root, swirl, orb };
}
