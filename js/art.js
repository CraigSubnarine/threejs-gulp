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

// Geometry and materials are built once per species and shared by every fish of it.
const cache = new Map();
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
    bodyMat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05 }),
    finMat: new THREE.MeshStandardMaterial({ color: spec.fin, flatShading: true, roughness: 0.6, side: THREE.DoubleSide }),
    spikes: spec.behavior === 'puff' ? spikeGeometry(sh) : null,
  };
  cache.set(spec.key, p);
  return p;
}
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.2 });

// One fish at length 1, facing +x. root: position and size; yaw: which way it faces; pitch: nose up or down;
// tail: wags. The game scales root by the fish's length.
export function makeFish(spec) {
  const p = partsFor(spec), sh = p.sh;
  const root = new THREE.Group(), yaw = new THREE.Group(), pitch = new THREE.Group(), tail = new THREE.Group();
  root.add(yaw);
  yaw.add(pitch);
  pitch.add(new THREE.Mesh(p.body, p.bodyMat));
  tail.position.x = -0.46;
  tail.add(new THREE.Mesh(p.tail, p.finMat));
  pitch.add(tail);
  if (spec.shape !== 'round') {
    const d = new THREE.Mesh(p.dorsal, p.finMat);
    d.position.set(0.02, sh.h / 2 * 0.9 * (sh.head ? 1.05 : 1), 0);
    d.scale.setScalar(spec.shape === 'disc' ? 1.5 : 1);
    pitch.add(d);
  }
  for (const side of [1, -1]) {
    const f = new THREE.Mesh(p.side, p.finMat);
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
  if (p.spikes) {
    spikes = new THREE.Mesh(p.spikes, p.finMat);
    spikes.scale.setScalar(0.001);
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
    f.yaw.rotation.y = -0.5;
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
export const waterAt = (zone, y, c = new THREE.Color()) =>
  c.set(zone.water.bottom).lerp(new THREE.Color(zone.water.top), Math.min(1, Math.max(0, (y + WORLD.y) / (2 * WORLD.y))));

// Builds a zone's scenery into the scene. rand is a seeded generator, so a zone looks the same every time.
// Returns update(dt, camera) for the moving bits (light rays, bubbles) and dispose().
export function makeZone(zone, scene, rand) {
  const group = new THREE.Group(), base = -WORLD.y - 70, R = (a, b) => a + rand() * (b - a);
  scene.add(group);

  // Background: a huge gradient wall far behind everything (no fog on it).
  const bg = new THREE.PlaneGeometry(16000, 9000, 1, 12), bc = new Float32Array(bg.attributes.position.count * 3), c = new THREE.Color();
  for (let i = 0; i < bg.attributes.position.count; i++) waterAt(zone, bg.attributes.position.getY(i) * 0.9, c).toArray(bc, i * 3);
  bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const wall = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  wall.position.z = -3800;
  group.add(wall);

  // Sea floor with dunes.
  const fl = new THREE.PlaneGeometry(16000, 7000, 80, 36).rotateX(-Math.PI / 2);
  const fp = fl.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setY(i, floorAt(fp.getX(i), fp.getZ(i) - 2000, base) - base);
  fl.computeVertexNormals();
  const floor = new THREE.Mesh(fl, new THREE.MeshStandardMaterial({ color: zone.floor, flatShading: true, roughness: 0.95 }));
  floor.position.set(0, base, -2000);
  group.add(floor);

  // The surface, seen from below.
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(16000, 7000).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe6fdff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  surf.position.set(0, WORLD.y + 90, -2000);
  group.add(surf);

  // Coral, rocks and weed behind the play plane (z < 0); the camera's perspective gives them parallax.
  const CORAL = [0xff6f91, 0xff9f43, 0xb36bff, 0xffd166, 0x5ee6b0, 0xff5e5e];
  const geos = [];
  for (let i = 0; i < 150; i++) {
    const x = R(-4200, 4200), z = R(-2900, -120), y = floorAt(x, z, base), kind = rand(), col = CORAL[Math.floor(rand() * CORAL.length)];
    if (kind < 0.3) { // branching coral
      for (let b = 0, n = 4 + Math.floor(rand() * 4); b < n; b++) {
        const len = R(90, 240), tilt = R(-0.7, 0.7), r = R(7, 13);
        geos.push(colored(new THREE.CylinderGeometry(r * 0.6, r, len, 5).translate(0, len / 2, 0), col, M(x + R(-20, 20), y, z + R(-20, 20), R(-0.3, 0.3), 0, tilt)));
      }
    } else if (kind < 0.5) { // brain coral
      const r = R(50, 120);
      geos.push(colored(new THREE.IcosahedronGeometry(1, 1), col, M(x, y, z, 0, R(0, 3), 0, r, r * 0.6, r)));
    } else if (kind < 0.65) { // tube coral
      for (let b = 0, n = 3 + Math.floor(rand() * 4); b < n; b++) {
        const h = R(60, 180), r = R(12, 22);
        geos.push(colored(new THREE.CylinderGeometry(r, r * 0.8, h, 7).translate(0, h / 2, 0), col, M(x + R(-40, 40), y, z + R(-30, 30))));
      }
    } else if (kind < 0.75) { // sea fan
      const r = R(90, 200);
      geos.push(colored(new THREE.CircleGeometry(1, 9, 0, Math.PI), col, M(x, y, z, 0, R(-0.4, 0.4), 0, r)));
    } else if (kind < 0.9) { // rock
      const r = R(50, 160);
      geos.push(colored(new THREE.DodecahedronGeometry(1, 0), 0x6f8796, M(x, y + r * 0.2, z, R(0, 3), R(0, 3), R(0, 3), r, r * R(0.5, 0.9), r)));
    } else { // weed
      for (let b = 0, n = 3 + Math.floor(rand() * 3); b < n; b++) {
        const h = R(120, 300);
        geos.push(colored(new THREE.ConeGeometry(10, h, 4).translate(0, h / 2, 0), 0x3fae5a, M(x + R(-25, 25), y, z, 0, 0, R(-0.25, 0.25))));
      }
    }
  }
  const props = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }));
  group.add(props);

  // Light rays from the surface: faint additive cones that sway.
  const rayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const rays = [];
  for (let i = 0; i < 9; i++) {
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(30, 260, 3600, 12, 1, true).translate(0, -1800, 0), rayMat);
    ray.position.set(-4000 + i * 1000 + R(-200, 200), WORLD.y + 100, R(-1400, -300));
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

  let t = 0;
  return {
    group,
    update(dt, cam) {
      t += dt;
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
