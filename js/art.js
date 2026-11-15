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
    d.scale.setScalar(spec.shape === 'disc' ? 1.5 : 1);
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
  return { root, yaw, pitch, tail, spikes };
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
    for (let i = 0; i < 7; i++) {
      const x = -3600 + i * 1200 + R(-300, 300), z = R(-1900, -900), r = R(220, 340);
      geos.push(colored(new THREE.IcosahedronGeometry(1, 2), pick(), M(x, at(x, z), z, 0, R(0, 3), 0, r, r * 0.65, r)));
      for (let b = 0; b < 6; b++) {
        const len = R(300, 520);
        geos.push(colored(new THREE.CylinderGeometry(10, 22, len, 5).translate(0, len / 2, 0), pick(), M(x + R(-280, 280), at(x, z), z + R(-200, 200), R(-0.3, 0.3), 0, R(-0.5, 0.5))));
      }
    }
  } else if (kind === 'grass') { // a seagrass meadow
    for (let i = 0; i < 520; i++) {
      const x = R(-4500, 4500), z = R(-2200, -150), h = R(70, 230);
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
    for (let i = 0; i < 4; i++) {
      const x = -3000 + i * 2000 + R(-300, 300), z = R(-2200, -900), r = R(380, 520), t = R(70, 110);
      geos.push(colored(new THREE.TorusGeometry(r, t, 5, 12, Math.PI), 0x76889a, M(x, at(x, z) - t * 0.5, z, 0, R(-0.5, 0.5), 0)));
      geos.push(colored(new THREE.IcosahedronGeometry(1, 1), pick(), M(x, at(x, z) + r + t * 0.6, z, 0, 0, 0, t * 1.2, t * 0.6, t * 1.2)));
    }
  } else if (kind === 'wall') { // the reef wall at the edge of the drop-off
    for (let i = 0; i < 70; i++) {
      const x = -4600 + i * 135 + R(-40, 40), z = R(-1500, -1250), h = R(500, 1100), r = R(140, 220), y0 = at(x, z);
      for (let y = y0; y < y0 + h; y += r * 1.1) geos.push(colored(new THREE.DodecahedronGeometry(1, 0), (i + Math.round(y / r)) % 2 ? 0x6d7f92 : 0x7a8ea0, M(x, y, z + R(-60, 60), R(0, 3), R(0, 3), R(0, 3), r, r * 0.8, r)));
      if (rand() < 0.7) geos.push(colored(new THREE.IcosahedronGeometry(1, 1), pick(), M(x, y0 + h, z + 40, 0, 0, 0, r * 0.8, r * 0.45, r * 0.8)));
    }
  }
}

// Builds one level's scenery into the scene: its zone's style with the level's own colours, prop mix and landmark.
// rand is a seeded generator, so a level looks the same every time. Returns update(dt, camera) for the moving
// bits (light rays, bubbles, marine snow) and dispose().
export function makeZone(zone, spot, scene, rand) {
  const group = new THREE.Group(), base = -WORLD.y - 70, R = (a, b) => a + rand() * (b - a), water = spot.water ?? zone.water;
  scene.add(group);

  // Background: a huge gradient wall far behind everything (no fog on it).
  const bg = new THREE.PlaneGeometry(16000, 9000, 1, 12), bc = new Float32Array(bg.attributes.position.count * 3), c = new THREE.Color();
  for (let i = 0; i < bg.attributes.position.count; i++) waterAt(water, bg.attributes.position.getY(i) * 0.9, c).toArray(bc, i * 3);
  bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const wall = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  wall.position.z = -3800;
  group.add(wall);

  // Sea floor with dunes.
  const fl = new THREE.PlaneGeometry(16000, 7000, 80, 36).rotateX(-Math.PI / 2);
  const fp = fl.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setY(i, floorAt(fp.getX(i), fp.getZ(i) - 2000, base) - base);
  fl.computeVertexNormals();
  const floor = new THREE.Mesh(fl, caustics(new THREE.MeshStandardMaterial({ color: spot.floor ?? zone.floor, flatShading: true, roughness: 0.95 }), 0.55));
  floor.position.set(0, base, -2000);
  group.add(floor);

  // The surface, seen from below.
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(16000, 7000).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe6fdff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  surf.position.set(0, WORLD.y + 90, -2000);
  group.add(surf);

  // Coral, rocks and weed behind the play plane (z < 0); the camera's perspective gives them parallax.
  // The level sets how many props there are and how much of the mix is rock and weed.
  const CORAL = [0xff6f91, 0xff9f43, 0xb36bff, 0xffd166, 0x5ee6b0, 0xff5e5e];
  const geos = [], kinds = [0.3, 0.2, 0.15, 0.1, 0.15 * (spot.rocks ?? 1), 0.1 * (spot.weed ?? 1)];
  const total = kinds.reduce((a, b) => a + b), cut = kinds.map((k, i) => kinds.slice(0, i + 1).reduce((a, b) => a + b) / total);
  for (let i = 0, n = spot.coral ?? 150; i < n; i++) {
    const x = R(-4200, 4200), z = R(-2900, -120), y = floorAt(x, z, base), roll = rand(), col = CORAL[Math.floor(rand() * CORAL.length)];
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
  for (let i = 0, n = spot.spires ?? 14; i < n; i++) {
    const x = -4200 + (i + 0.5) * 8400 / n + R(-200, 200), z = R(-3100, -1700);
    let y = floorAt(x, z, base), r = R(110, 180);
    for (let k = 0, n = 3 + Math.floor(rand() * 4); k < n; k++, r *= R(0.72, 0.88)) {
      geos.push(colored(new THREE.DodecahedronGeometry(1, 0), k % 2 ? 0x7d93a0 : 0x6a8290, M(x + R(-40, 40), y + r * 0.7, z + R(-30, 30), R(0, 3), R(0, 3), R(0, 3), r, r * 1.2, r)));
      y += r * 1.5;
    }
    if (rand() < 0.6) geos.push(colored(new THREE.IcosahedronGeometry(1, 1), CORAL[Math.floor(rand() * CORAL.length)], M(x, y + 10, z, 0, 0, 0, r * 0.9, r * 0.5, r * 0.9)));
  }
  landmark(spot.landmark, geos, R, base, rand, CORAL);
  const props = new THREE.Mesh(mergeGeometries(geos), caustics(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }), 0.4));
  group.add(props);

  // Light rays from the surface: faint additive cones that sway.
  const rayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const rays = [];
  for (let i = 0, n = spot.rays ?? 9; i < n; i++) {
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(30, 260, 3600, 12, 1, true).translate(0, -1800, 0), rayMat);
    ray.position.set(-4500 + (i + 0.5) * 9000 / n + R(-200, 200), WORLD.y + 100, R(-1400, -300));
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

// The red "!" that pops up over a hunter when it starts chasing you.
let warnMat;
export function makeWarn() {
  if (!warnMat) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 32, 35);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    warnMat = new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false });
  }
  const s = new THREE.Sprite(warnMat);
  s.scale.setScalar(54);
  s.renderOrder = 10;
  return s;
}
