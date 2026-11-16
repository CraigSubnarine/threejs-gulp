// Gulp! game: the 3D scene, the camera, the player, the fish and the HUD. Loaded last, as a module. The rules
// (who eats whom, growth, score, spawns, skills, classes) live in rules.js; this file moves things and draws them.
import * as THREE from 'three';
import { makeFish, makeIcons, makeZone, waterAt, makeWarn, bubbleTexture, water, makeOyster, makePickup, makeWreck, makeShard, makePortal, makeLair, makeBadge, makeAura, makeRing } from './art.js';
import { createPvp } from './pvp.js';

const FOV = 45, DEG = Math.PI / 180, TAN = Math.tan(FOV / 2 * DEG);
const MAX_ASPECT = 2.3; // a phone held sideways fills its screen; only very wide screens get side bars
const camDist = viewH => viewH / 2 / TAN; // how far the camera sits from what it looks at to show that much of the plane
const zoomMul = () => ZOOM[settings.zoom] ?? 1; // the Zoom setting
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clampMid = (v, a, b) => (a > b ? (a + b) / 2 : clamp(v, a, b)); // if the range is inside out, sit in the middle
const $ = id => document.getElementById(id);
// Seconds for each part of the move between levels: the clear card, the camera widening, the fade out and in.
const CLEAR_T = 1.3, WIDEN_T = 1.6, FADE_OUT_T = 0.35, FADE_IN_T = 0.5;

// ---------- Renderer, scene, camera, lights ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.id = 'view';
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x4cbfdc, 1000, 5000);
scene.background = new THREE.Color(0x4cbfdc); // follows the fog, so looking past the backdrop shows water, not black
const camera = new THREE.PerspectiveCamera(FOV, 1, 50, 14000);
// The camera looks at a point on the play plane from above and in front (CAMERA.tilt), swung round a little
// (yaw) as you swim. dist sets how much of the plane it shows.
const cam = { x: 0, y: 0, dist: camDist(VIEW_H[2]), yaw: 0 };
function placeCamera() {
  const pitch = CAMERA.tilt * DEG, flat = Math.cos(pitch) * cam.dist;
  camera.position.set(cam.x + Math.sin(cam.yaw) * flat, cam.y + Math.sin(pitch) * cam.dist, Math.cos(cam.yaw) * flat);
  camera.lookAt(cam.x, cam.y, 0);
  camera.updateMatrixWorld();
  view = viewRect();
}
// The part of the play plane on screen: where the four screen corners' rays hit z = 0. With a tilted camera it's a
// trapezoid; this is its bounding box.
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
let view = { x0: -600, x1: 600, y0: -700, y1: 700, xb0: -600, xb1: 600 };
function viewRect() {
  const r = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, xb0: Infinity, xb1: -Infinity };
  for (const [cx, cy] of CORNERS) {
    ndc.set(cx, cy);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) continue;
    r.x0 = Math.min(r.x0, hit.x); r.x1 = Math.max(r.x1, hit.x);
    r.y0 = Math.min(r.y0, hit.y); r.y1 = Math.max(r.y1, hit.y);
    if (cy < 0) { r.xb0 = Math.min(r.xb0, hit.x); r.xb1 = Math.max(r.xb1, hit.x); } // the bottom edge: the narrowest part of the view
  }
  return r;
}
const hemi = new THREE.HemisphereLight(0xffffff, 0x336688, 1.6);
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(0.4, 1, 0.7);
scene.add(hemi, sun);

let viewW = 0, viewH = 0, viewLeft = 0;
function resize() {
  viewH = innerHeight;
  viewW = Math.min(innerWidth, Math.round(innerHeight * MAX_ASPECT));
  viewLeft = Math.round((innerWidth - viewW) / 2);
  renderer.setSize(viewW, viewH);
  renderer.domElement.style.left = `${viewLeft}px`;
  for (const id of ['hud', 'banner']) { $(id).style.left = $(id).style.right = `${viewLeft}px`; } // line up with the sea, not the window
  $('pauseBtn').style.right = `calc(${viewLeft}px + max(10px, env(safe-area-inset-right)))`;
  $('boostBtn').style.right = `calc(${viewLeft}px + max(18px, env(safe-area-inset-right)))`;
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();
  render();
}

// ---------- Effects: bubble bursts when something gets eaten ----------
const FX = 200, fxPos = new Float32Array(FX * 3).fill(1e6), fxVel = new Float32Array(FX * 3), fxLife = new Float32Array(FX);
const fxGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(fxPos, 3));
scene.add(new THREE.Points(fxGeo, new THREE.PointsMaterial({ map: bubbleTexture(), size: 22, transparent: true, depthWrite: false })));
let fxNext = 0;
function burst(x, y, n, spread = 120) {
  for (let k = 0; k < n; k++) {
    const i = fxNext++ % FX, a = Math.random() * Math.PI * 2, s = spread * (0.4 + Math.random());
    fxPos.set([x, y, 5], i * 3);
    fxVel.set([Math.cos(a) * s, Math.sin(a) * s + 60, 0], i * 3);
    fxLife[i] = 0.5 + Math.random() * 0.4;
  }
}
function updateFx(dt) {
  for (let i = 0; i < FX; i++) {
    if (fxLife[i] <= 0) continue;
    if ((fxLife[i] -= dt) <= 0) { fxPos[i * 3 + 1] = 1e6; continue; }
    for (let a = 0; a < 3; a++) { fxVel[i * 3 + a] *= 1 - dt * 3; fxPos[i * 3 + a] += fxVel[i * 3 + a] * dt; }
    fxPos[i * 3 + 1] += 40 * dt;
  }
  fxGeo.attributes.position.needsUpdate = true;
}

// ---------- HUD ----------
const classSpec = c => ({ key: `class-${c.key}`, ...c.spec });
const icons = makeIcons([...ZONES.flatMap(z => z.fish), ...CLASSES.map(classSpec)]);
let bannerTimer = 0;
function banner(title, sub = '', ms = 1800) {
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;
  const b = $('banner');
  b.hidden = true;
  void b.offsetWidth; // restart the pop animation
  b.hidden = false;
  bannerTimer = ms / 1000;
}
// A "+30" that floats up from where a fish was eaten (world position -> page position).
const tmp = new THREE.Vector3();
function popup(text, x, y, kind = '') {
  tmp.set(x, y, 0).project(camera);
  const el = document.createElement('div');
  el.className = `pop ${kind}`;
  el.textContent = text;
  el.style.left = `${viewLeft + (tmp.x + 1) / 2 * viewW}px`;
  el.style.top = `${(1 - tmp.y) / 2 * viewH}px`;
  el.addEventListener('animationend', () => el.remove());
  $('pops').append(el);
}
// The food chain bar: one chip per size (tier) holding that size's fish, so it fits a phone however many species
// a zone has. Green chips are food, red ones can eat you.
function buildChain() {
  const jellies = G.levelFish.filter(s => s.behavior === 'jelly');
  $('chain').replaceChildren(...[0, 1, 2, 3].map(t => {
    const list = G.levelFish.filter(s => s.tier === t && s.behavior !== 'jelly'), chip = document.createElement('div');
    chip.dataset.tier = t;
    chip.title = list.map(s => (s.behavior === 'puff' ? `${s.name} (puffs up when you get close)` : s.name)).join(', ');
    chip.innerHTML = list.map(s => `<img src="${icons[s.key]}" alt="">`).join('') + `<i>${t}</i>`; // game data only
    return chip;
  }), ...(jellies.length ? [Object.assign(document.createElement('div'), { // jellyfish: never food, they sting
    className: 'chip sting', title: `${jellies.map(s => s.name).join(', ')}: can't be eaten, and they sting`,
    innerHTML: `${jellies.map(s => `<img src="${icons[s.key]}" alt="">`).join('')}<i>!</i>`, // game data only
  })] : []));
}
function updateChain() {
  for (const chip of $('chain').children) {
    if (!chip.dataset.tier) continue; // the jellyfish chip
    const t = Number(chip.dataset.tier);
    chip.className = `chip ${P.tier > t ? 'food' : P.tier < t ? 'danger' : 'same'}`;
  }
}
let shown = {};
function updateHud() {
  const combo = G.comboT > 0 && G.combo > 1 ? `×${Math.min(G.combo, G.stats.comboMax)}` : '';
  if (shown.score !== G.score) $('score').textContent = (shown.score = G.score).toLocaleString();
  if (shown.combo !== combo) $('combo').textContent = shown.combo = combo;
  const where = G.pvp ? G.pvp.whereText() : `${G.world ? `World ${G.world + 1} \u00B7 ` : ''}${G.zone.name} ${G.index + 1}/${LEVELS_PER_ZONE}`;
  if (shown.where !== where) $('whereName').textContent = shown.where = where;
  const fill = `${G.pvp ? (P.tier >= PVP.tiers ? 100 : (G.meter % PVP.perTier) / PVP.perTier * 100) : (G.meter / METER_NEED) * 100}%`; // online: progress to your next size
  if (shown.fill !== fill) $('meterFill').style.width = shown.fill = fill;
  if (shown.tier !== P.tier) { shown.tier = P.tier; updateChain(); }
  if (G.apex) { // the apex's health bar
    const w = `${G.apex.hp / G.apex.maxHp * 100}%`;
    if (shown.boss !== w) $('bossFill').style.width = shown.boss = w;
  }
  // Once-per-level powers you still have, so you know what's left.
  const perks = [P.power && `${PICKUPS.kinds[P.power.kind].name.toUpperCase()} ${Math.ceil(P.power.t)}s`, P.shields && `SHIELD ×${P.shields}`, P.gulps && `GULP ×${P.gulps}`, windLeft() && 'SECOND WIND'].filter(Boolean).join(' · ');
  const shards = [...Array(LEVELS_PER_ZONE).keys()].map(i => (G.shards.has(i) ? '\u25C6' : '\u25C7')).join('');
  const pearls = G.pvp ? `\u25C9 ${G.pearls} pearls \u00B7 size ${P.tier}/${PVP.tiers}` : `\u25C9 ${G.pearls % PEARLS_PER_POINT}/${PEARLS_PER_POINT} \u00B7 ${shards}`; // pearls towards the next bonus skill point, and this world's shards
  if (shown.pearls !== pearls) $('pearls').textContent = shown.pearls = pearls;
  if (shown.perks !== perks) $('perks').textContent = shown.perks = perks;
  const charge = Math.round(P.charge * 50) / 50; // the boost button fills up like a clock while it recharges
  if (shown.charge !== charge) {
    if (Math.floor(charge) > Math.floor(shown.charge ?? 0)) beep(1200, 50, 0.025); // a little ping when a charge is ready
    shown.charge = charge;
    const b = $('boostBtn'), full = charge >= G.stats.boostCharges;
    b.style.setProperty('--charge', full ? 1 : charge % 1);
    b.classList.toggle('ready', charge >= 1);
    b.dataset.n = G.stats.boostCharges > 1 ? `\u00D7${Math.floor(charge)}` : ''; // Double Dash: how many are ready
  }
  shardArrow();
  G.pvp?.hud();
}

// An arrow at the edge of the screen pointing the way to the level's shard (Shard Sense) or to a lair apex's rock,
// while it's off screen.
function shardArrow() {
  const el = $('shardArrow');
  let show = false;
  const target = G.apex?.mode === 'lurk' ? G.lair : G.stats.shardSense && G.phase === 'swim' ? G.shard : null;
  if (target) {
    tmp.set(target.x, target.y, 0).project(camera);
    if (Math.abs(tmp.x) > 0.92 || Math.abs(tmp.y) > 0.92) {
      const a = Math.atan2(tmp.y * viewH, tmp.x * viewW), k = 0.86 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      el.style.transform = `translate(${viewLeft + (1 + Math.cos(a) * k) / 2 * viewW}px, ${(1 - Math.sin(a) * k) / 2 * viewH}px) translate(-50%, -50%) rotate(${-a}rad)`;
      show = true;
    }
  }
  el.hidden = !show;
}

// ---------- Game state ----------
// mode: 'menu' (fish swim behind the main menu) | 'play'.
// phase while playing: 'swim' | 'dying' | 'cleared' (clear card) | 'widen' (camera pulls back) | 'tree' (skill
// screen up) | 'fadeout' | 'fadein' (into the next level).
const G = { mode: 'menu', phase: 'swim', level: 1, zone: null, index: 0, spot: null, scenery: null, seed: 0, spawner: null, fish: [], t: 0,
  spawnT: 0, phaseT: 0, score: 0, combo: 0, comboT: 0, meter: 0, eatenBy: '', points: 0, owned: [], cls: CLASSES[0], stats: computeStats('shark', []), windUsed: 0,
  oysters: [], pickups: [], pickT: 0, pickRand: null, pearls: 0, inkT: 0, pvp: null, // pvp: the online match (js/pvp.js) while one is on
  world: 0, shards: new Set(), worldPearls: 0, wreck: null, shard: null, portal: null, newWorld: false }; // shards: level indexes (0-4) whose shard you have

const P = { obj: null, x: 0, y: 0, vx: 0, vy: 0, len: fishLen(1), tier: 1, face: 1, pulse: 0, safe: 0, alive: false, phase: 0, gulp: 0, boost: 0, charge: 1,
  stun: 0, shields: 0, gulps: 0, power: null, ghost: 0, regrowT: 0, stingT: 0, aura: null }; // power: the timed power-up you have ({ kind, t })
G.player = P;
function setClass(cls) { // a different kind of fish: a new model
  if (P.obj && G.cls === cls) return;
  if (P.obj) scene.remove(P.obj.root);
  G.cls = cls;
  P.obj = makeFish(classSpec(cls));
  P.obj.root.visible = false;
  scene.add(P.obj.root);
}
setClass(CLASSES[0]);
const windLeft = () => G.stats.secondWind - G.windUsed;

// Build one level: its scenery, its fish, its spawner. You start it at tier 1.
function startLevel() {
  const info = levelInfo(G.level, G.world);
  removeApex();
  removePortal();
  G.scenery?.dispose();
  let spot = info.spot;
  const lap = Math.floor(G.world / ZONES.length);
  if (lap > 0) { // the worlds have come round again: the same zone, its water tinted round the colour wheel
    const w = spot.water ?? info.zone.water, hue = c => new THREE.Color(c).offsetHSL(SHARDS.worldHue * lap, 0, 0).getHex();
    spot = { ...spot, water: { top: hue(w.top), bottom: hue(w.bottom) } };
  }
  Object.assign(G, { zone: info.zone, index: info.index, spot, water: spot.water ?? info.zone.water });
  // The wreck hiding this level's shard: somewhere out in the wide sea, a different place each run.
  const wr = mulberry32(hashSeed(`${G.seed}/${G.level}/wreck`)), side = wr() < 0.5 ? -1 : 1;
  const wreckX = side * Math.min(WORLD.x - 1300, WORLD.x * (SHARDS.wreckFrom + wr() * 0.5));
  // A lair apex (the Giant Moray) gets its own holed rock on the zone's last level, on the other side from the wreck,
  // so the fight never gets in the way of the shard.
  const lairX = G.zone.apex.lair && G.index === LEVELS_PER_ZONE - 1 ? -side * Math.min(WORLD.x - 1200, WORLD.x * 0.55) : null;
  G.scenery = makeZone(G.zone, G.spot, scene, mulberry32(hashSeed(`${G.zone.key}/${G.index}`)), lairX === null ? [wreckX] : [wreckX, lairX]);
  const wreck = makeWreck(wr);
  wreck.mesh.position.x = wreckX;
  G.scenery.group.add(wreck.mesh);
  G.circles = [...G.scenery.circles, ...wreck.circles.map(c => ({ ...c, x: c.x + wreckX }))]; // rocks and wreckage on the play plane
  G.wreck = { x: wreckX, y: wreck.shard.y };
  G.lair = null;
  if (lairX !== null) {
    const lair = makeLair(wr);
    lair.mesh.position.x = lairX;
    G.scenery.group.add(lair.mesh);
    G.circles.push(...lair.circles.map(c => ({ ...c, x: c.x + lairX })));
    G.lair = { x: lairX, y: -WORLD.y + 450, holes: lair.holes.map(h => ({ ...h, x: h.x + lairX })) };
  }
  G.shard = null;
  if (G.mode === 'play' && !G.pvp && !G.shards.has(G.index)) { // already found on an earlier lap: no shard this time (none online)
    const sh = makeShard();
    sh.root.position.set(wreckX + wreck.shard.x, wreck.shard.y, 0);
    G.scenery.group.add(sh.root);
    G.shard = { x: wreckX + wreck.shard.x, y: wreck.shard.y, ...sh };
  }
  hemi.color.set(G.zone.sky);
  hemi.groundColor.set(G.zone.ground);
  sun.intensity = G.zone.sun;
  G.levelFish = levelFish(G.zone, G.index); // this level's window of the size ladder, each with its tier here
  buildChain();
  clearFish();
  G.spawner = makeSpawner(hashSeed(`${G.seed}/${G.level}`), G.zone, G.spot, G.index);
  G.meter = 0;
  G.phase = 'swim';
  G.spawnT = 0;
  placeOysters();
  removePickup();
  G.pickRand = mulberry32(hashSeed(`${G.seed}/${G.level}/pickups`));
  G.pickT = PICKUPS.every * 0.5;
  if (G.mode === 'play') {
    Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0, tier: 1, safe: PLAYER.safe, stun: 0, shields: G.stats.shields, gulps: G.stats.gulps, power: null });
    Object.assign(cam, { x: 0, y: 0, yaw: 0 });
  }
  placeCamera();
  if (!G.pvp || G.pvp.isHost) for (let i = 0; i < 8; i++) spawn(true); // online, only the host runs the sea
}
function clearFish() {
  for (const f of G.fish) removeFishObj(f);
  G.fish.length = 0;
}
function removeFishObj(f) {
  scene.remove(f.obj.root);
  if (f.warn) scene.remove(f.warn);
}
function removeFish(f) {
  removeFishObj(f);
  G.fish.splice(G.fish.indexOf(f), 1);
}

// A species as it is on this level (with its tier here), by key. It also works for fish outside the level's window.
const speciesAt = key => G.levelFish.find(s => s.key === key) ?? atLevel(G.zone.fish.find(s => s.key === key), G.index);
const yawFor = face => (face > 0 ? -0.35 : -Math.PI + 0.35); // turned a little towards the camera, so you see 3D
let fishIds = 0;
function spawnFish(species, x, y, dir, variant = null, id = ++fishIds) {
  const tier = species.tier + (variant === 'giant' ? VARIANTS.giant.tier : 0);
  const f = { id, s: species, variant, tier, x, y, vx: dir * species.speed, vy: 0, dir, face: dir, len: fishLen(tier) * (species.behavior === 'puff' ? 0.9 : 1),
    obj: makeFish(species, variant), phase: Math.random() * 6, wob: Math.random() * 6, chase: 0, rest: 0, puff: 0, puffT: -2, warn: null,
    baseTier: tier, stun: 0, shrink: 0, sk: 1, stuck: 0 }; // stun: Shock power-up; shrink: Shrink power-up (one size smaller), sk: its drawn scale
  f.obj.yaw.rotation.y = yawFor(dir);
  if (G.circles) pushOut(f, f.len * SHAPE_R[species.shape], G.circles); // never born inside a rock
  scene.add(f.obj.root);
  G.fish.push(f);
  return f;
}
// The patch of sea around a fish that its player's screen would show (online, the host fills the sea around everyone).
function rectAround(e) {
  const hh = VIEW_H[clamp(e.tier, 1, 5)] * 0.55, hw = hh * 1.7;
  return { x0: e.x - hw, x1: e.x + hw, y0: e.y - hh, y1: e.y + hh };
}
// A new fish (or a school) arrives from just past the left or right edge of the view (around: another player's).
function spawn(inside = false, around = null) {
  const T = around ?? P, r = around ? rectAround(around) : view;
  const sp = G.spawner.next(G.mode === 'play' ? clamp(T.tier, 1, 3) : 2, G.stats.variants), dir = sp.fromLeft ? 1 : -1;
  const len = fishLen(sp.species.tier);
  let x0 = dir > 0 ? r.x0 - 80 - len : r.x1 + 80 + len;
  if (inside) { // filling the sea at the start of a level: anywhere in view, but not on top of you
    x0 = r.x0 + G.spawner.rand() * (r.x1 - r.x0);
    if (G.mode === 'play' && Math.abs(x0 - T.x) < 320) x0 = T.x + Math.sign(x0 - T.x || 1) * 320;
  }
  x0 = clamp(x0, -WORLD.x - 600, WORLD.x + 600);
  const y0 = clamp((r.y0 + r.y1) / 2 + sp.y * (r.y1 - r.y0) / 2 * 0.85, -WORLD.y + 80, WORLD.y - 80);
  for (let i = 0; i < sp.count; i++) spawnFish(sp.species, x0 - dir * Math.random() * 160, clamp(y0 + (Math.random() - 0.5) * 140, -WORLD.y + 40, WORLD.y - 40), dir, sp.variant);
}

// ---------- Moving things ----------
// Where the player wants to go, as a stick: x right, y up, length 0..1.
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
function stick() {
  const k = input.keys, kx = (k.has('arrowright') || k.has('d')) - (k.has('arrowleft') || k.has('a')), ky = (k.has('arrowup') || k.has('w')) - (k.has('arrowdown') || k.has('s'));
  if (kx || ky) { const m = Math.hypot(kx, ky); return { x: kx / m, y: ky / m }; }
  if (input.stick) return input.stick;
  if (input.mouse) {
    ndc.set((input.mouse.x - viewLeft) / viewW * 2 - 1, -input.mouse.y / viewH * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      const dx = hit.x - P.x, dy = hit.y - P.y, m = Math.hypot(dx, dy);
      if (m > 10) { const s = Math.min(1, m / (P.len * 1.6)); return { x: dx / m * s, y: dy / m * s }; }
    }
  }
  return { x: 0, y: 0 };
}

// Turn a fish's model to match how it's moving: face left or right (banking into the turn), nose up or down,
// and swim: the tail wags and the body swings the other way, harder the faster it goes.
function pose(e, dt) {
  const o = e.obj;
  if (Math.abs(e.vx) > 12) e.face = Math.sign(e.vx);
  o.root.position.set(e.x, e.y, 0);
  const turn = yawFor(e.face) - o.yaw.rotation.y;
  o.yaw.rotation.y += turn * Math.min(1, dt * 6);
  const pitch = clamp(Math.atan2(e.vy, Math.abs(e.vx) + 20), -0.6, 0.6);
  o.pitch.rotation.z += (pitch - o.pitch.rotation.z) * Math.min(1, dt * 5);
  o.pitch.rotation.x += (clamp(turn * 0.45, -0.7, 0.7) - o.pitch.rotation.x) * Math.min(1, dt * 8);
  const speed = Math.hypot(e.vx, e.vy);
  e.phase += dt * (5 + speed / 35);
  const swing = 0.6 + Math.min(1, speed / 300) * 0.4;
  o.tail.rotation.y = Math.sin(e.phase) * 0.55 * swing;
  o.pitch.rotation.y = -Math.sin(e.phase - 0.6) * 0.13 * swing;
}

// Boost: a burst of speed the way you're steering (or facing), then the button recharges.
const mySpeed = () => PLAYER.speed * G.stats.speed;
function boost() {
  if (app.state !== 'playing' || !P.alive || P.charge < 1 || !['swim', 'apex'].includes(G.phase)) return; // the apex fight too: boost bites do double damage
  let { x, y } = stick();
  const m = Math.hypot(x, y);
  if (m < 0.2) { x = P.face; y = 0; } else { x /= m; y /= m; }
  const s = mySpeed() * BOOST.speed * G.stats.boostSpeed;
  P.vx = x * s;
  P.vy = y * s;
  P.boost = BOOST.time * G.stats.boostTime;
  P.charge -= 1; // Double Dash holds two charges
  if (G.stats.ghostFin) P.ghost = P.boost + 2; // Ghost Fin: hunters can't see you for 2 s after
  burst(P.x, P.y, 14, 160);
  beep(220, 260, 0.05, 'sawtooth', 3);
  buzz(30);
}

function updatePlayer(dt) {
  if (P.alive) {
    const s = { ...stick() }; // a copy: the joystick's own vector mustn't change
    let speed = mySpeed(), turn = PLAYER.turn;
    if (P.boost > 0) { // boosting: full speed ahead, steering still works
      P.boost -= dt;
      speed *= BOOST.speed * G.stats.boostSpeed;
      turn *= 2;
      const m = Math.hypot(s.x, s.y), v = Math.hypot(P.vx, P.vy) || 1;
      if (m < 0.2) { s.x = P.vx / v; s.y = P.vy / v; } else { s.x /= m; s.y /= m; }
      if (Math.random() < 0.6) burst(P.x - P.vx / v * P.len * 0.5, P.y - P.vy / v * P.len * 0.5, 1, 30); // bubble trail
      if (G.stats.wake) for (const f of G.fish) if (!canEat(P, f) && Math.hypot(f.x - P.x, f.y - P.y) < P.len * 0.9 + f.len * 0.3) f.stun = Math.max(f.stun, 1.2); // Wake
    } else P.charge = Math.min(G.stats.boostCharges, P.charge + dt / (BOOST.recharge * G.stats.boostRecharge));
    P.ghost -= dt;
    P.stingT -= dt;
    if (G.stats.regrow && P.shields < G.stats.shields) { // Regrow: a used shield grows back
      if ((P.regrowT += dt) >= G.stats.regrow) { P.shields++; P.regrowT = 0; popup('SHIELD REGROWN', P.x, P.y + P.len, 'combo'); }
    } else P.regrowT = 0;
    if (P.stun > 0) { P.stun -= dt; speed *= 0.3; } // stung: sluggish for a moment
    if (P.power && (P.power.t -= dt) <= 0) P.power = null;
    if (P.power?.kind === 'rush') speed *= PICKUPS.kinds.rush.speed;
    P.vx += (s.x * speed - P.vx) * Math.min(1, dt * turn);
    P.vy += (s.y * speed - P.vy) * Math.min(1, dt * turn);
    P.x = clamp(P.x + P.vx * dt, -WORLD.x + 40, WORLD.x - 40);
    P.y = clamp(P.y + P.vy * dt, -WORLD.y + P.len * 0.25, WORLD.y - P.len * 0.25);
    const vx0 = P.vx, vy0 = P.vy, rock = pushOut(P, P.len * SHAPE_R[G.cls.spec.shape], G.circles); // rocks: slide along them
    if (rock?.crack !== undefined && P.boost > 0) { smash(rock.crack); P.vx = vx0; P.vy = vy0; } // boosting into a cracked pillar: straight through it
  }
  P.len += (fishLen(P.tier) - P.len) * Math.min(1, dt * 4);
  P.pulse = Math.max(0, P.pulse - dt * 5);
  P.safe -= dt;
  pose(P, dt);
  let scale = P.len * (1 + 0.15 * P.pulse);
  if (!P.alive) { // being swallowed: shrink into the predator's mouth
    P.gulp = Math.min(1, P.gulp + dt * 3);
    scale *= 1 - P.gulp;
  }
  P.obj.root.scale.setScalar(Math.max(scale, 0.001));
  P.obj.root.visible = P.safe > 0 && P.safe < 50 && P.alive ? G.t * 8 % 2 < 1.5 : true; // blink while nothing can eat you
  if (G.pvp?.out) P.obj.root.visible = false; // out of a Last Fish Standing match: watching
  indicate(P, { shield: P.shields > 0, rush: P.power?.kind === 'rush' || P.boost > 0 && P.power?.kind === 'rush' });
}
// Power-up indicators on a fish (yours, other players', sea fish): a bubble for a shield, a blue glow for Rush,
// purple for a shrunk fish, sparks over a stunned one. Built the first time one is needed.
function indicate(e, { shield = false, rush = false, shrink = false, stun = false }) {
  if (!e.aura) {
    if (!shield && !rush && !shrink && !stun) return;
    e.aura = makeAura();
    e.obj.root.add(e.aura.group);
  }
  const a = e.aura, pulse = 0.5 + Math.sin(G.t * 6) * 0.5;
  a.shield.visible = shield;
  a.rush.visible = rush;
  a.rush.material.opacity = 0.25 + pulse * 0.25;
  a.shrink.visible = shrink;
  a.spark.visible = stun && G.t * 5 % 1 < 0.7;
  if (rush && Math.random() < 0.5) burst(e.x - (e.face ?? 1) * e.len * 0.5, e.y, 1, 40);
}

function updateFish(f, dt) {
  const T = G.pvp ? G.pvp.nearest(f) ?? P : P; // online: whichever player is nearest
  const s = f.s, live = G.mode === 'play' && T.alive && G.phase === 'swim', mult = speedAt(G.level) * (f.variant === 'speedy' ? VARIANTS.speedy.speed : 1);
  const sp = s.speed * mult;
  let tx = f.dir * sp, ty = Math.sin(G.t * 0.8 + f.wob) * sp * 0.25, rate = 2.5;
  const dx = T.x - f.x, dy = T.y - f.y, d = Math.hypot(dx, dy) || 1;
  if (f.shrink > 0) f.shrink -= dt;
  if (f.stun > 0) f.stun -= dt;
  const stunned = f.stun > 0, small = f.shrink > 0 ? 2 : 0;
  if (s.behavior !== 'puff') f.tier = f.baseTier - small; // shrunk: from one size bigger than you to one size smaller, for a while
  if (s.behavior === 'jelly') return driftJelly(f, dt, s.speed * speedAt(G.level));
  if (s.behavior === 'puff') { // swells up (and becomes dangerous) when you swim close, then slowly shrinks
    f.puffT -= dt;
    if (live && f.puffT <= -1.5 && d < 200 + T.len * 0.5) { f.puffT = 2.6; if (T === P) beep(220, 160, 0.04, 'sine', 2); }
    const want = f.puffT > 0.5 ? 1 : 0;
    f.puff += (want - f.puff) * Math.min(1, dt * (want ? 9 : 3));
    f.tier = f.puff > 0.5 && !G.stats.ironJaw ? s.puffTo : s.tier; // Iron Jaw: still food when puffed up
    tx *= 1 - f.puff * 0.8;
    ty *= 1 - f.puff * 0.8;
    f.obj.spikes.scale.setScalar(Math.max(f.puff, 0.001));
  }
  const flees = s.behavior === 'skittish' || s.behavior === 'school' || f.variant === 'speedy';
  const clearOff = ['widen', 'apex', 'apexdown', 'portal'].includes(G.phase); // everyone leaves while the camera widens or the apex is here
  if ((live && flees && !stunned && canEat(T, f) && d < TUNING.fleeRange * (f.variant === 'speedy' ? 1.5 : 1)) || clearOff) {
    tx = -dx / d * sp * 1.7; // swim away from you
    ty = -dy / d * sp * 1.7;
    rate = 5;
    f.dir = Math.sign(tx) || f.dir;
  }
  if (s.behavior === 'hunter' && stunned) f.chase = 0;
  else if (s.behavior === 'hunter') {
    f.rest -= dt;
    const ghosted = (G.stats.combos.ghost && T.boost > 0) || T.ghost > 0; // Ghost combo / Ghost Fin: boosting shakes off hunters
    const still = G.stats.mimic && Math.hypot(T.vx, T.vy) < 40; // Mimic: hold still and they take you for a rock
    if (f.chase > 0 && live && canEat(f, T) && !ghosted) {
      f.chase -= dt;
      const cs = Math.min(TUNING.chaseSpeed * speedAt(G.level), 0.95) * PLAYER.speed;
      tx = dx / d * cs;
      ty = dy / d * cs;
      rate = 4;
      if (f.chase <= 0) { f.rest = TUNING.chaseRest; f.dir = Math.sign(f.vx) || f.dir; }
    } else if (live && !ghosted && !still && canEat(f, T) && f.rest <= 0 && d < TUNING.chaseRange * G.stats.notice && T.safe <= 0) {
      if (G.stats.ink && G.inkT <= 0) { // Ink Cloud: a puff of ink and it loses you
        G.inkT = 10;
        f.rest = TUNING.chaseRest * 2;
        popup('INK!', P.x, P.y + P.len, 'ouch');
        burst(P.x, P.y, 16, 120);
      } else {
        f.chase = TUNING.chaseTime * G.stats.chase;
        if (T === P) beep(880, 90, 0.04, 'square');
        if (!f.warn) scene.add(f.warn = makeWarn());
      }
    } else f.chase = 0;
  }
  if (stunned) { tx *= 0.1; ty = -30; rate = 3; } // limp: drifting and sinking slowly
  if (rate < 5) { // calm fish (not fleeing in a panic) swim over or under a rock in their way
    for (const c of G.circles) {
      const ax = c.x - f.x, ay = c.y - f.y, reach = c.r + f.len * 0.5 + 160;
      if (Math.abs(ax) < reach && Math.abs(ay) < reach && ax * tx > 0 && Math.hypot(ax, ay) < reach) ty += (f.y >= c.y ? 1 : -1) * sp * 1.4;
    }
  }
  if (f.climb > 0) { f.climb -= dt; ty = sp * 1.6; }
  if (f.variant === 'golden' && Math.random() < dt * 4) burst(f.x + (Math.random() - 0.5) * f.len * 0.6, f.y, 1, 25); // sparkle
  f.vx += (tx - f.vx) * Math.min(1, dt * rate);
  f.vy += (ty - f.vy) * Math.min(1, dt * rate);
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  const lim = WORLD.y - f.len * 0.3;
  if (Math.abs(f.y) > lim) { f.y = Math.sign(f.y) * lim; f.vy = 0; }
  if (pushOut(f, f.len * SHAPE_R[f.s.shape] * (1 + 0.7 * f.puff), G.circles) && rate < 5) { // a calm fish stuck on a rock turns back
    if ((f.stuck += dt) > 0.4) {
      f.dir = -f.dir;
      f.stuck = 0;
      if (G.t - (f.flipAt ?? -9) < 2) f.climb = 1.2; // stuck both ways (wedged between rocks): swim up and out
      f.flipAt = G.t;
    }
  } else f.stuck = 0;
  pose(f, dt);
  if (stunned) f.obj.pitch.rotation.x = 1.3; // rolled on its side
  f.sk += ((small ? 0.55 : 1) - f.sk) * Math.min(1, dt * 6);
  f.obj.root.scale.setScalar(f.len * (1 + 0.7 * f.puff) * f.sk);
  indicate(f, { shrink: small > 0, stun: stunned });
  if (f.warn) {
    f.warn.visible = f.chase > TUNING.chaseTime * G.stats.chase - 1.2; // shows for the first moment of a chase
    f.warn.position.set(f.x, f.y + f.len * 0.5 + 40, 20);
  }
}

// A jellyfish drifts in slow pulses (the bell squeezes, the tentacles trail). Nothing chases it or runs from it.
function driftJelly(f, dt, sp) {
  const beat = Math.max(0, Math.sin(G.t * 2.2 + f.wob)), k = Math.min(1, dt * 2);
  f.vx += (f.dir * sp * (0.4 + beat) - f.vx) * k;
  f.vy += ((Math.sin(G.t * 0.5 + f.wob) * 0.6 + beat * 0.5) * sp - f.vy) * k;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  const lim = WORLD.y - f.len * 0.5;
  if (Math.abs(f.y) > lim) { f.y = Math.sign(f.y) * lim; f.vy = 0; }
  pushOut(f, f.len * SHAPE_R.jelly, G.circles);
  const o = f.obj;
  o.root.position.set(f.x, f.y, 0);
  o.pitch.scale.set(1 + beat * 0.12, 1 - beat * 0.15, 1 + beat * 0.12);
  o.tail.rotation.z = Math.sin(G.t * 1.5 + f.wob) * 0.25 - f.vx / 600;
  o.tail.rotation.x = Math.cos(G.t * 1.2 + f.wob) * 0.2;
  o.root.scale.setScalar(f.len * f.sk);
}
// A jellyfish sting: stunned for a moment and shoved away (Tough Skin halves it). It never eats you.
function sting(f) {
  P.stun = JELLY.stun * G.stats.stun;
  P.stingT = JELLY.again;
  const nx = (P.x - f.x) || 1, ny = P.y - f.y, m = Math.hypot(nx, ny);
  P.vx = nx / m * JELLY.push;
  P.vy = ny / m * JELLY.push;
  popup('STUNG!', P.x, P.y + P.len * 0.8, 'ouch');
  beep(900, 120, 0.05, 'sawtooth', 0.4);
  buzz(70);
}

// Boosting into a cracked pillar smashes the whole pillar: its rocks burst apart and the way is open.
function smash(id, remote = false) {
  const parts = G.circles.filter(c => c.crack === id);
  if (!parts.length) return;
  if (!remote) G.pvp?.smashed(id);
  G.circles = G.circles.filter(c => c.crack !== id);
  for (const c of parts) {
    c.mesh.visible = false;
    burst(c.x, c.y, 10, c.r * 1.5);
  }
  boom(500, remote ? 0.05 : 0.14);
  if (remote) return;
  const pts = 50 * G.level;
  G.score += pts;
  popup(`SMASH! +${pts}`, P.x, P.y + P.len, 'combo');
  beep(110, 260, 0.08, 'sawtooth', 0.5);
  buzz(120);
}

// Touching: bigger eats smaller, the same size bumps. Skills bend it: Torpedo eats your own size while
// boosting, Gulp swallows one size bigger once per level.
function collide() {
  const myR = P.len * SHAPE_R[G.cls.spec.shape], biteR = P.len * SHAPE_R.oval * G.stats.reach;
  for (const f of [...G.fish]) {
    const dx = f.x - P.x, dy = f.y - P.y, d = Math.hypot(dx, dy) || 1, fr = f.len * SHAPE_R[f.s.shape] * (1 + 0.7 * f.puff) * f.sk;
    if (f.s.behavior === 'jelly') { if (P.safe <= 0 && P.stingT <= 0 && d < (myR + fr) * 0.8) sting(f); continue; } // never food, at any size
    const torpedo = G.stats.torpedo && P.boost > 0 && f.tier === P.tier, gulp = P.gulps > 0 && f.tier === P.tier + 1 && f.s.behavior !== 'puff';
    if ((canEat(P, f) || torpedo) && d < biteR * 1.15 + fr * 0.8) eat(f);
    else if (gulp && d < biteR * 1.15 + fr * 0.6) { P.gulps--; popup('GULP!', P.x, P.y + P.len, 'combo'); eat(f); }
    else if (canEat(f, P) && P.safe <= 0 && d < (myR + fr) * 0.72) { if (bitten(f)) return; }
    else if (!canEat(f, P) && d < (myR + fr) * 0.9) { // same size: push apart
      const push = ((myR + fr) * 0.9 - d) / 2, nx = dx / d, ny = dy / d;
      P.x -= nx * push; P.y -= ny * push; f.x += nx * push; f.y += ny * push;
      P.vx -= nx * 120; P.vy -= ny * 120; f.vx += nx * 120; f.vy += ny * 120;
    }
  }
}
// A bigger fish caught you: Spines or Second Wind save you, otherwise the run is over. Returns true if you died.
function bitten(f) {
  const save = P.shields > 0 ? 'SPAT OUT!' : windLeft() > 0 ? 'SECOND WIND!' : null;
  if (!save) { die(f); return true; }
  if (P.shields > 0) P.shields--; else G.windUsed++;
  P.safe = 2;
  const nx = (P.x - f.x) || 1, ny = P.y - f.y, m = Math.hypot(nx, ny);
  P.vx = nx / m * 700; P.vy = ny / m * 700;
  f.vx = -nx / m * 400; f.vy = -ny / m * 400; f.chase = 0; f.rest = TUNING.chaseRest;
  popup(save, P.x, P.y + P.len, 'combo');
  burst(P.x, P.y, 20, 200);
  beep(160, 200, 0.06, 'square', 2);
  buzz(80);
  return false;
}
function eat(f) {
  removeFish(f);
  G.pvp?.ateFish(f); // online: tell the host (it takes the fish out of everyone's sea)
  const V = VARIANTS, st = G.stats, v = f.variant;
  G.combo = G.comboT > 0 ? G.combo + 1 : 1;
  G.comboT = st.comboGap;
  const mult = Math.min(G.combo, st.comboMax) * (V[v]?.points ?? 1);
  const pts = pointsFor(f.s.rank + (v === 'giant' ? 1 : 0)) * mult; // bigger fish (higher up the ladder) are worth more
  G.score += pts;
  let grow = GROW[clamp(f.tier, -1, 3)] * st.growth;
  if (v === 'spiny') { // it stings, but it's very filling (Shark Skin: no sting, even more filling)
    grow *= st.combos.sharkSkin ? 3 : V.spiny.growth;
    const stun = st.combos.sharkSkin || st.ironJaw ? 0 : V.spiny.stun * st.stun;
    if (stun > 0) { P.stun = stun; popup('OUCH!', P.x, P.y + P.len * 0.8, 'ouch'); beep(140, 150, 0.05, 'square'); }
  }
  if (v === 'golden' && st.combos.hoarder) P.shields = Math.min(P.shields + 1, st.shields);
  if (P.boost > 0 && st.refund) P.charge = Math.min(st.boostCharges, P.charge + st.refund);
  if (st.combos.frenzyFuel && G.combo % 5 === 0) { P.charge = st.boostCharges; popup('FRENZY!', P.x, P.y + P.len, 'combo'); }
  G.meter = G.pvp ? G.meter + grow : Math.min(METER_NEED, G.meter + grow); // online: sizes 1-5, no level clear
  const tag = v === 'golden' ? ' GOLD!' : '';
  popup(mult > 1 ? `+${pts} ×${mult}${tag}` : `+${pts}`, f.x, f.y + f.len * 0.4, v === 'golden' ? 'gold' : G.combo > 1 ? 'combo' : '');
  burst(f.x, f.y, 6 + Math.min(f.tier, 3) * 4);
  P.pulse = 1;
  beep(380 + Math.min(f.tier, 3) * 140 + Math.min(G.combo, COMBO_MAX) * 40, 70, 0.06, 'square', 0.5);
  if (v === 'golden') jingle([1319, 1568, 2093], 60);
  buzz(15);
  if (G.pvp) return G.pvp.grown();
  if (G.meter >= METER_NEED) return G.index === LEVELS_PER_ZONE - 1 ? startApex() : levelCleared(); // a zone's last level ends with its apex
  const t = tierFor(G.meter);
  if (t > P.tier) {
    P.tier = t;
    const food = G.levelFish.filter(s => s.tier === t - 1).map(s => s.name); // the ones you just outgrew
    banner('GROWN!', `Now you can eat: ${food.join(', ')}`);
    burst(P.x, P.y, 24, 260);
    jingle([523, 659, 784, 1047]);
    buzz(60);
  }
}
function die(f) {
  if (G.pvp) return G.pvp.died((f.variant ? `${VARIANTS[f.variant].name.toLowerCase()} ` : '') + f.s.name, f);
  P.alive = false;
  P.gulp = 0;
  G.phase = 'dying';
  G.phaseT = 1.3;
  G.eatenBy = (f.variant ? `${VARIANTS[f.variant].name.toLowerCase()} ` : '') + f.s.name;
  f.vx = (P.x - f.x) * 3; // the predator lunges through you
  f.vy = (P.y - f.y) * 3;
  burst(P.x, P.y, 30, 220);
  boom(400, 0.12);
  beep(300, 400, 0.06, 'sawtooth', 0.25);
  buzz(250);
}

// ---------- Oysters and pearls ----------
// A few oysters sit on the sea floor, away from rocks and from where you start. Each one opens to show a pearl,
// shivers, and snaps shut: grab the pearl while it's open. A small you caught in the snap is eaten; a bigger you
// gets pinched.
function placeOysters() {
  for (const o of G.oysters) scene.remove(o.obj.root);
  G.oysters = [];
  const rand = mulberry32(hashSeed(`${G.seed}/${G.level}/oysters`)), size = OYSTER.size, y = -WORLD.y - 12;
  for (let i = 0; i < OYSTER.perLevel; i++) {
    let x = 0;
    for (let k = 0; k < 30; k++) { // somewhere clear of rocks, not right where you start
      x = (rand() * 2 - 1) * (WORLD.x - 600);
      if (Math.abs(x) > 700 && G.circles.every(c => Math.abs(c.x - x) > c.r + size || c.y > y + c.r + size)) break;
    }
    const obj = makeOyster();
    obj.root.position.set(x, y, 0);
    obj.root.scale.setScalar(size);
    scene.add(obj.root);
    const black = rand() < OYSTER.blackChance;
    obj.setBlack(black);
    G.oysters.push({ obj, x, y, t: rand() * 6, mode: 'closed', has: true, black, regrow: 0, rand });
  }
}
function updateOysters(dt, live) {
  const size = OYSTER.size, open = G.stats.oysterOpen ?? 1;
  for (const o of G.oysters) {
    o.t += dt;
    const mode = oysterPhase(o.t, open), lid = o.obj.hinge.rotation;
    const want = mode === 'open' || mode === 'tell' ? -0.95 : 0;
    lid.x += (want - lid.x) * Math.min(1, dt * (mode === 'snap' ? 30 : 4));
    if (mode === 'tell') lid.x += Math.sin(G.t * 70) * 0.05; // the shiver: it's about to snap
    if (!o.has && (o.regrow -= dt) <= 0 && mode === 'closed') { // a new pearl grows inside
      o.has = true;
      o.black = o.rand() < OYSTER.blackChance;
      o.obj.setBlack(o.black);
    }
    o.obj.pearl.visible = o.has;
    const pr = P.len * SHAPE_R[G.cls.spec.shape];
    if (live && o.has && (mode === 'open' || mode === 'tell') && Math.hypot(P.x - o.x, P.y - (o.y + size * 0.25)) < pr + size * 0.14 + (G.stats.magnet ? 120 : 0)) takePearl(o);
    if (live && mode === 'snap' && o.mode !== 'snap' && P.safe <= 0 && Math.abs(P.x - o.x) < size * 0.45 + pr * 0.3 && P.y - o.y < size * 0.3 + pr * 0.5) snapOn(o);
    o.mode = mode;
  }
}
function takePearl(o, granted = false) {
  if (G.pvp && !granted && !G.pvp.claimPearl(o)) return; // online: the host decides who got it first
  o.has = false;
  o.regrow = OYSTER.regrow;
  const n = pearlCount(o.black) * (G.stats.pearlMul ?? 1), pts = pearlPoints(o.black, G.level), before = Math.floor(G.pearls / PEARLS_PER_POINT);
  G.pearls += n;
  G.worldPearls += n;
  G.score += pts;
  popup(`${o.black ? 'BLACK PEARL' : 'PEARL'} +${pts}`, o.x, o.y + OYSTER.size * 0.6, 'gold');
  burst(o.x, o.y + OYSTER.size * 0.3, 14, 150);
  jingle(o.black ? [988, 1319, 1568, 2093] : [1319, 1760], 70);
  buzz(20);
  const gained = G.pvp ? 0 : Math.floor(G.pearls / PEARLS_PER_POINT) - before; // no skill points online
  if (gained > 0) { // every few pearls: a bonus skill point
    G.points += gained;
    popup(`+${gained} SKILL POINT${gained > 1 ? 'S' : ''}`, P.x, P.y + P.len * 1.4, 'combo');
  }
}
function snapOn(o) {
  beep(120, 160, 0.08, 'square', 0.5);
  boom(200, 0.08);
  if (P.tier <= OYSTER.catchTier && !G.stats.oysterProof) { bitten({ s: { name: 'oyster' }, x: o.x, y: o.y }); return; }
  P.stun = OYSTER.pinch * G.stats.stun; // too big to swallow: just a nasty pinch
  P.vy = 520;
  popup('PINCHED!', P.x, P.y + P.len * 0.8, 'ouch');
  buzz(60);
}

// ---------- Power-ups ----------
// A bubble drifts down from the top of the view now and then; swim into it to take it. Online, the host drops them
// (near a random player) and decides who got each one; Power-up rain drops more, several at once.
let pickupIds = 0;
function spawnPickup(kind, x, y, id = ++pickupIds) {
  const near = G.pvp?.randomPlayer() ?? P, r = G.pickRand ?? Math.random;
  if (!G.pvp) removePickup();
  x ??= clamp(near.x + (r() - 0.5) * 0.7 * (view.x1 - view.x0), -WORLD.x + 200, WORLD.x - 200);
  y ??= Math.min(near.y + (view.y1 - view.y0) * 0.45, WORLD.y - 80);
  const obj = makePickup(kind);
  obj.position.set(x, y, 0);
  scene.add(obj);
  const p = { id, kind, x, y, tx: x, ty: y, t: PICKUPS.life, obj };
  G.pickups.push(p);
  return p;
}
// Removes one bubble, or all of them.
function removePickup(p = null) {
  for (const q of p ? [p] : G.pickups) scene.remove(q.obj);
  G.pickups = p ? G.pickups.filter(q => q !== p) : [];
}
function updatePickup(dt) {
  const host = !G.pvp || G.pvp.isHost, rain = G.pvp?.rain ? PVP.rain : 1;
  if (host && G.phase === 'swim' && G.pickups.length < rain && (G.pickT -= dt) <= 0) {
    G.pickT = PICKUPS.every / rain;
    spawnPickup(rollPickup(G.pickRand));
  }
  for (const p of [...G.pickups]) {
    if (host) {
      p.t -= dt;
      p.y -= PICKUPS.fall * dt;
      p.x += Math.sin(G.t * 1.3 + p.id) * 25 * dt;
      const pd = Math.hypot(P.x - p.x, P.y - p.y);
      if (G.stats.magnet && pd < 700 && pd > 1) { p.x += (P.x - p.x) / pd * 320 * dt; p.y += (P.y - p.y) / pd * 320 * dt; } // Magnet
      if (p.t <= 0 || p.y < -WORLD.y + 40) { burst(p.x, p.y, 10, 100); removePickup(p); G.pvp?.pickupGone(p); continue; }
    } else { // a guest: glide towards where the host says it is
      p.x += (p.tx - p.x) * Math.min(1, dt * 8);
      p.y += (p.ty - p.y) * Math.min(1, dt * 8);
    }
    p.obj.position.set(p.x, p.y, 0);
    p.obj.visible = p.t > 2 || G.t * 6 % 1 < 0.6; // blinks before it pops
    if (P.alive && G.phase === 'swim' && Math.hypot(P.x - p.x, P.y - p.y) < P.len * 0.35 + 48) {
      if (G.pvp) G.pvp.claimPickup(p); else takePickup(p);
    }
  }
}
// You took a bubble: its power is yours (and Shock and Shrink hit the sea around you).
function takePickup(p) {
  const k = PICKUPS.kinds[p.kind];
  removePickup(p);
  popup(k.name.toUpperCase(), P.x, P.y + P.len, 'combo');
  jingle([784, 1047, 1319], 60);
  burst(P.x, P.y, 18, 220);
  buzz(40);
  if (k.time) P.power = { kind: p.kind, t: k.time };
  if (p.kind === 'shield') P.shields++;
  if (!G.pvp) pickupWorld(p.kind, P);
}
// Shock and Shrink: their effect on the sea around whoever took them (online, the host runs this).
function pickupWorld(kind, who) {
  const k = PICKUPS.kinds[kind];
  if (kind === 'shock') { // fish near you go limp
    boom(300, 0.08);
    ring(who.x, who.y, k.range, 0xffd23b);
    for (const f of G.fish) if (Math.hypot(f.x - who.x, f.y - who.y) < k.range) { f.stun = k.time; f.chase = 0; f.rest = Math.max(f.rest, k.time); }
  } else if (kind === 'shrink') { // fish one size bigger than you shrink into food
    ring(who.x, who.y, 700, 0xb36bff);
    for (const f of G.fish) if (f.baseTier === clamp(who.tier, 1, 3) + 1 && f.s.behavior !== 'puff' && Math.abs(f.x - who.x) < 1400) f.shrink = k.time;
  }
}
// An expanding ring (Shock's jolt, Shrink's wave), fading as it grows.
const rings = [];
function ring(x, y, r, color) {
  const m = makeRing(color);
  m.position.set(x, y, 10);
  scene.add(m);
  rings.push({ m, r, t: 0 });
}
function updateRings(dt) {
  for (const g of [...rings]) {
    g.t += dt * 2;
    g.m.scale.setScalar(Math.max(1, g.r * g.t));
    g.m.material.opacity = Math.max(0, 0.8 * (1 - g.t));
    if (g.t >= 1) { scene.remove(g.m); rings.splice(rings.indexOf(g), 1); }
  }
}

// ---------- Between levels ----------
// The meter is full: a clear card, then the camera pulls back while you stay the same size (the view widens),
// then the skill tree, then a fade into the next level, where you're a tier-1 fish among bigger ones.
function levelCleared(title = 'LEVEL CLEAR!', note = '') {
  const bonus = CLEAR_BONUS * G.level;
  G.score += bonus;
  G.points += 1;
  G.phase = 'cleared';
  G.phaseT = CLEAR_T;
  P.tier = 3;
  P.safe = 99;
  P.boost = 0;
  noteProgress({ level: G.level + 1, score: G.score });
  banner(title, `+${bonus.toLocaleString()} · +1 skill point${note}`, (CLEAR_T + (note ? 1.5 : 0)) * 1000);
  if (note) G.phaseT += 1.5; // time to read it
  burst(P.x, P.y, 40, 320);
  jingle([523, 659, 784, 1047, 1319], 110);
  buzz(120);
}
// ---------- A lair apex: the Giant Moray in its rock ----------
// It hides in one of its rock's holes. A hole glows and shakes (the tell), then it strikes out towards you and stays
// stretched out for a moment, tail end still in the hole: bite it there! Then it pulls back in and picks a hole.
function updateLair(A, dt) {
  const a = A.a, rage = A.stage > 0 ? 1.35 : 1, len = A.len, holes = G.lair.holes;
  const out = k => { // its body k of the way out of the hole (0 hidden, 1 fully out), along its heading
    A.x = A.hole.x + A.hx * len * (k - 0.5);
    A.y = A.hole.y + A.hy * len * (k - 0.5);
  };
  if (A.mode === 'lurk') { // waiting for you to come to its rock
    if (Math.hypot(P.x - G.lair.x, P.y - G.lair.y) < 1300) {
      A.mode = 'hide';
      A.t = 1.2;
      popup(`"${a.intro}"`, G.lair.x, G.lair.y + 600, 'taunt');
      boom(500, 0.1);
    }
  } else if (A.mode === 'hide' && A.t <= 0) { // pick a hole (the nearest to you, or another one)
    const sorted = [...holes].sort((h, k) => Math.hypot(P.x - h.x, P.y - h.y) - Math.hypot(P.x - k.x, P.y - k.y));
    A.hole = Math.random() < 0.6 ? sorted[0] : sorted[1 + Math.floor(Math.random() * (sorted.length - 1))];
    const kind = a.phases[A.stage][Math.floor(Math.random() * a.phases[A.stage].length)];
    A.left = kind === 'double' ? 2 : 1;
    A.mode = 'tell';
    A.t = a.tell / rage;
    beep(500, 300, 0.04, 'square', 1.6);
  } else if (A.mode === 'tell') { // the hole shakes and bubbles
    if (Math.random() < dt * 30) burst(A.hole.x + (Math.random() - 0.5) * 160, A.hole.y + 40, 1, 60);
    if (A.t <= 0) { // strike towards where you are, but no steeper than it can pose
      const side = A.hole.dir || Math.sign(P.x - A.hole.x) || 1; // out of the rock's face, never back through it
      const p = clamp(Math.atan2(P.y - A.hole.y, Math.max(1, (P.x - A.hole.x) * side)), A.hole.dir ? -0.6 : 0, 0.6);
      Object.assign(A, { hx: side * Math.cos(p), hy: Math.sin(p), face: side, mode: 'lunge', t: 1 / (a.lunge * PLAYER.speed * rage / len) });
      out(0);
      boom(200, 0.06);
      beep(150, 220, 0.05, 'sawtooth', 0.5);
    }
  } else if (A.mode === 'lunge') { // shooting out of the hole
    const total = 1 / (a.lunge * PLAYER.speed * rage / len);
    out(clamp(1 - A.t / total, 0, 1));
    if (A.t <= 0) { A.mode = 'exposed'; A.t = (A.stage > 0 ? 1.5 : 2) ; out(1); }
  } else if (A.mode === 'exposed') { // stretched out: its tail is right there
    if (A.t <= 0) { A.mode = 'retract'; A.t = 0.5; }
  } else if (A.mode === 'retract') { // pulling back in
    out(clamp(A.t / 0.5, 0, 1));
    if (A.t <= 0) {
      if (--A.left > 0) { A.mode = 'hide'; A.t = 0.25; } // phase 2: straight out of another hole
      else { A.mode = 'hide'; A.t = (A.stage > 0 ? 1.1 : 1.6) + Math.random() * 0.6; }
    }
  }
  const seen = ['lunge', 'exposed', 'retract'].includes(A.mode);
  A.obj.root.visible = seen;
  const sp = A.mode === 'lunge' ? a.lunge * PLAYER.speed * rage : 600; // what pose() reads its heading and swim speed from
  A.vx = A.hx * sp;
  A.vy = A.hy * sp;
  pose(A, dt);
  A.obj.root.scale.setScalar(A.len);
  A.obj.mats.body.emissive.setRGB(A.flash, 0, 0);
  A.obj.mats.stripe?.emissive.setRGB(A.flash, 0, 0);
  if (A.obj.segs) { // it ripples like a snake, faster when it strikes; the jaw gapes while it's out
    const fast = A.mode === 'lunge' ? 14 : 6, n = A.obj.segs.length;
    A.obj.segs.forEach((g, i) => { g.position.y = Math.sin(G.t * fast - i * 0.55) * 0.022 * (0.2 + i / n); g.position.z = Math.cos(G.t * fast * 0.7 - i * 0.5) * 0.02 * (i / n); });
    A.obj.jaw.rotation.z += ((seen && A.mode !== 'retract' ? -0.45 : 0) - A.obj.jaw.rotation.z) * Math.min(1, dt * 10);
  }
  A.warn.visible = A.mode === 'tell';
  if (A.hole) A.warn.position.set(A.hole.x, A.hole.y + 170, 30);
  if (seen && G.phase === 'apex' && P.alive) apexTouch(A);
}

// ---------- The apex predator at the end of a zone ----------
// It circles you, shakes (a red "!") and lunges. After a lunge it slows right down: that's your chance to bite its
// tail. Its jaws (the front of its body) eat you. Its health bar splits into phases, and each phase adds attacks.
function startApex() {
  const a = G.zone.apex, len = fishLen(3) * a.size, side = Math.random() < 0.5 ? -1 : 1, hp = apexHp(a, levelInfo(G.level).loop);
  const obj = makeFish({ key: `apex-${a.key}`, ...a.spec }), warn = makeWarn();
  warn.scale.setScalar(80);
  warn.visible = false;
  scene.add(obj.root, warn);
  // stage: which fight phase it's in (not "phase": pose() uses that for the tail wag)
  G.apex = { a, obj, warn, s: { name: a.short }, len, hp, maxHp: hp, stage: 0, phase: 0, mode: 'enter', t: 1.6, left: 0, inv: 0, flash: 0,
    x: P.x + side * ((view.x1 - view.x0) / 2 + len * 0.6), y: clamp(P.y + 150, -WORLD.y + len * 0.2, WORLD.y - len * 0.2),
    vx: -side * 400, vy: 0, face: -side, ang: Math.atan2(150, side * 600), spin: Math.random() < 0.5 ? 1 : -1, hole: null, hx: 1, hy: 0 };
  if (a.lair) { // it waits inside its rock until you come to it
    Object.assign(G.apex, { mode: 'lurk', x: G.lair.x, y: G.lair.y });
    obj.root.visible = false;
  }
  G.phase = 'apex';
  removePickup();
  Object.assign(P, { tier: 3, safe: 1.5, boost: 0 });
  banner(a.name.toUpperCase(), a.lair ? 'Something huge lives in the rock with the holes. Follow the arrow.' : `"${a.intro}"`, 3200);
  $('bossName').textContent = a.name;
  $('boss').hidden = false;
  shown.boss = null;
  boom(600, 0.14);
  beep(90, 700, 0.07, 'sawtooth', 0.6);
  buzz(200);
}
function removeApex() {
  if (!G.apex) return;
  scene.remove(G.apex.obj.root, G.apex.warn);
  G.apex = null;
  $('boss').hidden = true;
}
// Its heading, matching how its model is posed: facing left or right, nose tilted up to ±0.6 rad.
function apexHeading(A) {
  if (A.a.lair) return { hx: A.hx, hy: A.hy };
  const p = clamp(Math.atan2(A.vy, Math.abs(A.vx) + 20), -0.6, 0.6);
  return { hx: A.face * Math.cos(p), hy: Math.sin(p) };
}
function nextAttack(A) {
  const list = A.a.phases[A.stage], kind = list[Math.floor(Math.random() * list.length)];
  A.kind = kind;
  if (kind === 'charge') { // first it swims off the side of the screen to line up
    Object.assign(A, { mode: 'away', side: Math.sign(A.x - P.x) || 1, t: 1.3, left: 1 });
    return;
  }
  A.mode = 'tell';
  A.left = kind === 'flurry' ? 3 : 1;
  A.t = kind === 'flurry' ? 0.45 : A.a.tell / (A.stage > 0 ? 1.2 : 1);
  beep(500, 300, 0.04, 'square', 1.6);
}
function updateApex(dt) {
  const A = G.apex, a = A.a, rage = A.stage > 0 ? 1.2 : 1, base = PLAYER.speed;
  A.t -= dt;
  A.inv -= dt;
  A.flash = Math.max(0, A.flash - dt * 4);
  if (A.mode === 'dying') { // rolls belly-up, sinks and shrinks away
    A.y -= 260 * dt;
    A.obj.root.position.set(A.x, A.y, 0);
    A.obj.pitch.rotation.x += dt * 4;
    A.obj.root.scale.setScalar(A.len * Math.max(0.01, A.t / 1.8));
    A.warn.visible = false;
    return;
  }
  if (a.lair) return updateLair(A, dt);
  const dx = P.x - A.x, dy = P.y - A.y, d = Math.hypot(dx, dy) || 1;
  let tx = A.vx, ty = A.vy, rate = 3;
  if (A.mode === 'enter' || A.mode === 'circle') { // circles you at a distance
    A.ang += dt * 0.7 * A.spin * rage;
    const R = A.len * 1.1, ex = P.x + Math.cos(A.ang) * R - A.x, ey = P.y + Math.sin(A.ang) * R * 0.6 - A.y, e = Math.hypot(ex, ey) || 1;
    const sp = a.speed * base * rage * Math.min(1.4, e / 250 + 0.4);
    tx = ex / e * sp;
    ty = ey / e * sp;
    if (A.t <= 0) nextAttack(A);
  } else if (A.mode === 'away') { // off to the side of the screen, level with you, ready to charge
    const ex = P.x + A.side * ((view.x1 - view.x0) / 2 + A.len * 0.55) - A.x, ey = P.y - A.y, e = Math.hypot(ex, ey) || 1, sp = base * 1.6 * rage;
    tx = ex / e * sp;
    ty = ey / e * sp;
    rate = 4;
    if (A.t <= 0) { A.mode = 'tell'; A.t = a.tell * 1.4 / rage; beep(500, 300, 0.04, 'square', 1.6); }
  } else if (A.mode === 'tell') { // stops, turns to face you and shakes: an attack is coming
    tx = dx / d * 25;
    ty = dy / d * 25;
    rate = 8;
    if (A.t <= 0) { // lunge at where you are right now
      const sp = a.lunge * base * rage;
      A.vx = dx / d * sp;
      A.vy = dy / d * sp;
      A.mode = 'lunge';
      A.t = A.left > 1 ? 0.32 : 0.55;
      if (A.kind === 'charge') { // straight across the screen, through where you are
        A.vx = Math.sign(dx || 1) * sp * 1.1;
        A.vy = dy * 0.8;
        A.t = (Math.abs(dx) + A.len) / (sp * 1.1);
      }
      boom(200, 0.06);
      beep(150, 220, 0.05, 'sawtooth', 0.5);
    }
  } else if (A.mode === 'lunge') {
    rate = 0; // straight on, no steering
    if (A.t <= 0) {
      if (--A.left > 0) { A.mode = 'tell'; A.t = 0.35; } else { A.mode = 'recover'; A.t = A.stage > 0 ? 0.85 : 1.15; }
    }
  } else if (A.mode === 'recover') { // slows right down: bite its tail now!
    tx = 0;
    ty = 0;
    rate = 2.5;
    if (A.t <= 0) { A.mode = 'circle'; A.t = (A.stage > 0 ? 1.6 : 2.3) + Math.random() * 0.8; }
  }
  if (rate) {
    A.vx += (tx - A.vx) * Math.min(1, dt * rate);
    A.vy += (ty - A.vy) * Math.min(1, dt * rate);
  }
  A.x += A.vx * dt;
  A.y += A.vy * dt;
  const lim = WORLD.y - A.len * 0.12; // stays in the water and near the play area
  if (Math.abs(A.y) > lim) { A.y = Math.sign(A.y) * lim; A.vy *= -0.3; }
  if (Math.abs(A.x) > WORLD.x + 300) { A.x = Math.sign(A.x) * (WORLD.x + 300); A.vx *= -0.3; }
  pushOut(A, A.len * 0.11, G.circles);
  pose(A, dt);
  if (A.mode === 'tell') A.obj.root.position.set(A.x + (Math.random() - 0.5) * A.len * 0.03, A.y + (Math.random() - 0.5) * A.len * 0.03, 0); // the shake
  A.obj.root.scale.setScalar(A.len);
  A.obj.mats.body.emissive.setRGB(A.flash, 0, 0); // flashes red when bitten
  A.warn.visible = A.mode === 'tell';
  const { hx, hy } = apexHeading(A); // the "!" sits over its head, where the bite comes from
  A.warn.position.set(clamp(A.x + hx * A.len * 0.35, view.xb0 + 80, view.xb1 - 80), clamp(A.y + hy * A.len * 0.35 + A.len * 0.14 + 50, view.y0 + 80, view.y1 - 200), 30); // at the screen edge if it's off screen
  if (G.phase === 'apex' && P.alive) apexTouch(A);
}
// You bite its tail; its jaws bite you; anything else just pushes you apart.
function apexTouch(A) {
  const { hx, hy } = apexHeading(A), r = A.len * (A.a.touch ?? 0.11); // about half its body height
  const bite = apexContact(A.x, A.y, hx, hy, A.len, r, P.x, P.y, P.len * SHAPE_R.oval * G.stats.reach);
  const me = apexContact(A.x, A.y, hx, hy, A.len, r, P.x, P.y, P.len * SHAPE_R[G.cls.spec.shape]);
  if (bite === 'tail' && A.inv <= 0) return biteApex(A);
  if (me === 'head' && P.safe <= 0) {
    if (!bitten(A)) { A.mode = A.a.lair ? 'retract' : 'recover'; A.t = A.a.lair ? 0.45 : 1.2; } // Spines or Second Wind saved you: it backs off
    return;
  }
  if (me) { const nx = P.x - A.x, ny = P.y - A.y, m = Math.hypot(nx, ny) || 1; P.vx += nx / m * 60; P.vy += ny / m * 60; }
}
function biteApex(A) {
  const dmg = (P.boost > 0 ? APEX.boostDamage : 1) + G.stats.apexDamage, pts = APEX.bitePoints * dmg * G.level;
  A.hp = Math.max(0, A.hp - dmg);
  A.inv = APEX.inv;
  A.flash = 1;
  G.score += pts;
  popup(dmg > 1 ? `BOOST BITE! +${pts}` : `BITE! +${pts}`, A.x, A.y + A.len * 0.15, 'combo');
  const nx = P.x - A.x, ny = P.y - A.y, m = Math.hypot(nx, ny) || 1;
  P.vx = nx / m * 500; // you bounce off
  P.vy = ny / m * 500;
  P.boost = 0;
  if (!A.a.lair) { A.vx -= nx / m * 200; A.vy -= ny / m * 200; }
  burst(P.x, P.y, 16, 200);
  beep(200, 120, 0.07, 'square', 0.5);
  boom(150, 0.06);
  buzz(50);
  if (A.hp <= 0) return apexDefeated(A);
  const ph = apexPhase(A.hp, A.maxHp, A.a.phases.length);
  if (ph > A.stage) { // angry: a new phase with more attacks
    A.stage = ph;
    popup(`"${A.a.rage}"`, A.x, A.y + A.len * 0.35, 'taunt');
    boom(500, 0.12);
    A.mode = A.a.lair ? 'retract' : 'circle';
    A.t = A.a.lair ? 0.45 : 1.2;
  } else if (A.a.lair) { A.mode = 'retract'; A.t = 0.45; A.left = 0; } // bitten: it yanks itself back in
  else if (A.mode === 'circle') A.t = Math.min(A.t, 0.8); // it strikes back soon
}
function apexDefeated(A) {
  noteProgress({ apex: true });
  const bonus = APEX.bonus * G.level;
  G.score += bonus;
  G.points += 1; // a bonus point; levelCleared adds the level's own point too
  A.mode = 'dying';
  A.t = 1.8;
  A.obj.root.visible = true;
  G.phase = 'apexdown';
  G.phaseT = 1.8;
  P.safe = 99;
  popup(`"${A.a.defeat}"`, A.x, A.y + A.len * 0.35, 'taunt');
  banner(`${A.a.short.toUpperCase()} DEFEATED!`, `+${bonus.toLocaleString()} · +1 bonus skill point`, 1800);
  burst(A.x, A.y, 60, 400);
  jingle([523, 659, 784, 1047, 1319, 1568], 100);
  boom(700, 0.14);
  buzz(300);
  $('boss').hidden = true;
}

// ---------- Shards, the orb and the portal ----------
// The level card's reminder: every level hides its own shard.
const shardNote = () => (G.shards.has(G.index) ? `◆ You already found this level's shard` : `◇ Shard ${G.index + 1} of ${LEVELS_PER_ZONE} is hidden in a wreck here`);
// The shard glints once you're close; touch it to take it.
function updateShard(dt, live) {
  const sh = G.shard;
  if (!sh) return;
  const d = Math.hypot(P.x - sh.x, P.y - sh.y);
  sh.gem.rotation.y += dt * 1.5;
  sh.glint.visible = G.mode === 'play' && d < 1100 && G.t * 3 % 1 < 0.75;
  if (live && d < P.len * SHAPE_R[G.cls.spec.shape] + 45 + (G.stats.magnet ? 120 : 0)) {
    G.shards.add(G.index);
    G.scenery.group.remove(sh.root);
    G.shard = null;
    const pts = SHARDS.points * G.level, n = G.shards.size;
    G.score += pts;
    banner(`SHARD ${n}/${LEVELS_PER_ZONE}`, n >= LEVELS_PER_ZONE ? 'The orb is whole! Beat the apex to open the portal.' : `+${pts.toLocaleString()} · each level hides one: find all ${LEVELS_PER_ZONE} to open the portal`, 2200);
    burst(sh.x, sh.y, 30, 260);
    jingle([659, 988, 1319, 1760], 80);
    buzz(80);
  }
}
// After the apex: with all five shards the orb opens a portal; without them the portal stays dark and the world
// starts over (faster), keeping the shards you found.
function worldEnd() {
  const n = G.shards.size;
  if (n < LEVELS_PER_ZONE) return levelCleared('ZONE CLEAR!', ` · the portal is dark: ${n}/${LEVELS_PER_ZONE} shards`);
  G.phase = 'portal';
  const side = P.x > 0 ? -1 : 1, x = clamp(P.x + side * Math.min(520, (view.x1 - view.x0) * 0.3), -WORLD.x + 300, WORLD.x - 300), y = clamp(P.y + 120, -WORLD.y + 400, WORLD.y - 400);
  const obj = makePortal();
  obj.root.position.set(x, y, 0);
  obj.root.scale.setScalar(170);
  scene.add(obj.root);
  G.portal = { x, y, ...obj };
  banner('THE ORB IS WHOLE!', 'A portal opens. Swim into it!', 3000);
  jingle([523, 659, 784, 1047, 1319, 1568, 2093], 90);
  boom(800, 0.1);
}
function removePortal() {
  if (G.portal) scene.remove(G.portal.root);
  G.portal = null;
}
function updatePortal(dt) {
  const pt = G.portal;
  pt.swirl.rotation.z -= dt * 2.5;
  pt.orb.scale.setScalar(1 + Math.sin(G.t * 5) * 0.15);
  pt.root.rotation.y = Math.sin(G.t * 0.8) * 0.3;
  if (Math.random() < dt * 20) burst(pt.x + (Math.random() - 0.5) * 300, pt.y + (Math.random() - 0.5) * 300, 1, 40);
  if (G.phase === 'portal' && P.alive && Math.hypot(P.x - pt.x, P.y - pt.y) < 150) { // in you go: choose what to keep
    G.phase = 'keep';
    noteProgress({ portal: true });
    burst(P.x, P.y, 40, 300);
    jingle([1047, 1319, 1568, 2093], 70);
    openKeep(keepCount(G.worldPearls));
  }
}
// Called by the keep screen: through the portal into the next world with the skills you kept. Your size, the tree
// and the shards reset; the score, your unspent points and your class carry on.
function enterWorld(kept = []) {
  if (G.phase !== 'keep') return;
  const free = G.cls.free ? [G.cls.free] : [];
  G.owned = [...new Set([...free, ...kept.filter(id => G.owned.includes(id))])];
  G.stats = computeStats(G.cls.key, G.owned);
  Object.assign(G, { world: G.world + 1, shards: new Set(), worldPearls: 0, newWorld: true, windUsed: 0 });
  G.score += CLEAR_BONUS * G.level;
  G.points += 1; // the level's own point
  removePortal();
  G.phase = 'fadeout';
  G.phaseT = FADE_OUT_T;
}

// Called by the skill tree's "Next level" button.
function nextLevel() {
  if (G.phase !== 'tree') return;
  G.phase = 'fadeout';
  G.phaseT = FADE_OUT_T;
}
// Behind the fade: everything is rescaled so the new level is built at the usual size. You and the camera shrink
// by the same factor, so on screen nothing jumps.
function swapLevel() {
  G.level++;
  const len = G.newWorld ? fishLen(1) : P.len / LEVEL_SCALE; // through a portal you start small again
  cam.dist = G.newWorld ? camDist(VIEW_H[1] * zoomMul()) : cam.dist / LEVEL_SCALE; // before startLevel, so the new fish fill the view you'll actually see
  startLevel();
  P.len = len;
  G.phase = 'fadein';
  G.phaseT = FADE_IN_T;
  banner(G.newWorld ? `WORLD ${G.world + 1}` : G.zone.name.toUpperCase(), `${G.newWorld ? `${G.zone.name} · ` : ''}Level ${G.index + 1}/${LEVELS_PER_ZONE} · ${G.spot.name}
${shardNote()}`, 2600);
  G.newWorld = false;
  jingle([392, 523, 659], 110);
}
// Spend skill points (from the tree screen). Returns true if it worked.
function buy(id) {
  if (!canBuy(G.owned, id, G.points)) return false;
  G.points -= nodeCost(findNode(id));
  G.owned.push(id);
  G.stats = computeStats(G.cls.key, G.owned);
  return true;
}

// One step of the game. dt in seconds.
function update(dt) {
  G.t += dt;
  const play = G.mode === 'play';
  if (play) updatePlayer(dt);
  else Object.assign(cam, { x: Math.sin(G.t * 0.06) * 900, y: -380 + Math.sin(G.t * 0.11) * 120, dist: camDist(VIEW_H[2]), yaw: Math.sin(G.t * 0.09) * CAMERA.sway * DEG });
  if (!G.pvp || G.pvp.isHost) for (const f of [...G.fish]) updateFish(f, dt); // online guests get the sea from the host
  G.pvp?.update(dt);
  if (G.apex) updateApex(dt);
  if (play && P.alive && G.phase === 'swim') collide();
  updateOysters(dt, play && P.alive && G.phase === 'swim');
  updateShard(dt, play && P.alive && G.phase === 'swim');
  if (G.portal) updatePortal(dt);
  if (play) updatePickup(dt);
  if (play) { // the camera follows you (looking a little ahead), swings with your swimming and pulls back as you grow
    const k = Math.min(1, dt * 4), widen = G.phase === 'widen' || G.phase === 'fadeout', fight = G.phase === 'apex' || G.phase === 'apexdown';
    // Between levels it only pulls back a little; after the cut the new level carries on easing out (it's rescaled, so
    // on screen you stay the same size). The Zoom setting scales every view.
    const C = G.pvp?.watching() ?? P; // out of an online match: watch another player
    const viewTo = (widen ? VIEW_H[3] * CAMERA.widen : fight ? VIEW_H[3] * APEX.view : VIEW_H[clamp(C.tier, 1, 5)]) * zoomMul();
    cam.dist += (camDist(viewTo) - cam.dist) * Math.min(1, dt * (widen ? 2.6 : 2));
    const hw = (view.x1 - view.x0) / 2, below = cam.y - view.y0, above = view.y1 - cam.y, lim = widen ? Infinity : 1;
    cam.x += (clampMid(C.x + C.vx * CAMERA.lead, -WORLD.x * lim - 100 + hw, WORLD.x * lim + 100 - hw) - cam.x) * k;
    cam.y += (clampMid(C.y + C.vy * CAMERA.lead, -WORLD.y * lim - 160 + below, WORLD.y * lim + (view.y1 - view.y0) * 0.2 - above) - cam.y) * k; // room above the surface for the HUD, so you're never under it
    cam.yaw += (-C.vx / PLAYER.speed * CAMERA.sway * DEG - cam.yaw) * Math.min(1, dt * 1.5);
  }
  placeCamera();
  // Fish leave when they're far off screen; new ones arrive while the sea is below its population.
  if (G.pvp) G.pvp.tendSea(dt); // online: the host keeps fish around every player
  else {
    for (const f of [...G.fish]) if (f.x < view.x0 - 900 || f.x > view.x1 + 900 || f.y < view.y0 - 900 || f.y > view.y1 + 900) removeFish(f);
    G.spawnT -= dt;
    if (G.spawnT <= 0 && G.fish.length < TUNING.population && ['swim', 'dying', 'fadein'].includes(G.phase)) { spawn(); G.spawnT = TUNING.spawnEvery; }
  }
  G.comboT -= dt;
  G.inkT -= dt;
  if (G.phaseT > 0 && (G.phaseT -= dt) <= 0) {
    if (G.phase === 'dying') runOver({ score: G.score, level: G.level, eatenBy: G.eatenBy, world: G.world + 1, shards: G.shards.size });
    else if (G.phase === 'cleared') { G.phase = 'widen'; G.phaseT = WIDEN_T; }
    else if (G.phase === 'widen') { G.phase = 'tree'; openTree(); }
    else if (G.phase === 'fadeout') swapLevel();
    else if (G.phase === 'fadein') G.phase = 'swim';
    else if (G.phase === 'apexdown') { removeApex(); worldEnd(); }
  }
  $('fade').style.opacity = G.phase === 'fadeout' ? 1 - G.phaseT / FADE_OUT_T : G.phase === 'fadein' ? G.phaseT / FADE_IN_T : 0;
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) $('banner').hidden = true;
  // Water colour and fog follow the camera: lighter near the surface, darker near the floor.
  waterAt(G.water, cam.y, scene.fog.color);
  scene.background.copy(scene.fog.color);
  scene.fog.near = cam.dist * 1.15; // the bottom of a tilted view is further away than the middle
  scene.fog.far = cam.dist + 3600;
  water.uTime.value = G.t;
  G.scenery.update(dt, camera);
  updateFx(dt);
  updateRings(dt);
  if (play) updateHud();
}
function render() { renderer.render(scene, camera); }

// ---------- Online matches (js/pvp.js) ----------
// Starts a match level: one level of the chosen sea, sizes 1-5, no shards, no skill tree.
function startPvpLevel(m) {
  setClass(CLASSES.find(c => c.key === m.cls) ?? CLASSES[0]);
  Object.assign(G, { mode: 'play', seed: m.seed, level: 1, world: m.world, score: 0, combo: 0, comboT: 0, points: 0, windUsed: 0, pearls: 0, shards: new Set(), worldPearls: 0, newWorld: false, owned: [], pvp: m.pvp });
  G.stats = computeStats(G.cls.key, [], true);
  Object.assign(P, { alive: true, gulp: 0, len: fishLen(1), pulse: 0, face: 1, boost: 0, charge: G.stats.boostCharges, ghost: 0, regrowT: 0 });
  P.obj.root.visible = true;
  cam.dist = camDist(VIEW_H[1] * zoomMul());
  shown = {};
  startLevel();
  Object.assign(P, { x: m.x, y: m.y, safe: PVP.countdown + 1 });
  Object.assign(cam, { x: m.x, y: m.y });
  placeCamera();
  updateHud();
}
const pvp = createPvp({ THREE, G, P, scene, cam, camera, icons, makeFish, classSpec, spawnFish, removeFish, speciesAt, spawn, rectAround, spawnPickup, removePickup,
  takePickup, takePearl, pickupWorld, smash, burst, popup, banner, ring, indicate, pose, startPvpLevel, makeBadge, view: () => view, screen: () => ({ w: viewW, h: viewH, left: viewLeft }),
  toMenu: () => toMenu() });

// ---------- Called by the menus (ui.js) ----------
function startRun(seed = Math.floor(Math.random() * 1e9), classKey = 'shark') {
  setClass(CLASSES.find(c => c.key === classKey) ?? CLASSES[0]);
  Object.assign(G, { mode: 'play', seed, level: 1, score: 0, combo: 0, comboT: 0, points: 0, windUsed: 0, pearls: 0, world: 0, shards: new Set(), worldPearls: 0, newWorld: false, owned: G.cls.free ? [G.cls.free] : [] });
  G.stats = computeStats(G.cls.key, G.owned);
  Object.assign(P, { alive: true, gulp: 0, len: fishLen(1), pulse: 0, face: 1, boost: 0, charge: G.stats.boostCharges, ghost: 0, regrowT: 0 });
  P.obj.root.visible = true;
  cam.dist = camDist(VIEW_H[1] * zoomMul());
  shown = {};
  startLevel();
  updateHud();
  banner(G.zone.name.toUpperCase(), `Level 1/${LEVELS_PER_ZONE} · ${G.spot.name}
${shardNote()}`, 2600);
  jingle([392, 523, 659], 110);
}
function toMenu() {
  G.pvp?.end();
  G.pvp = null;
  G.mode = 'menu';
  P.alive = false;
  P.obj.root.visible = false;
  $('banner').hidden = true;
  $('fade').style.opacity = 0;
  G.level = 1 + Math.floor(Math.random() * LEVELS_PER_ZONE); // a different reef spot behind the menu each time
  G.seed = 'menu';
  G.world = 0;
  G.stats = computeStats('shark', []);
  startLevel();
}

let last = 0;
window.game = {
  manual: false, // the playtest sets this and steps the game itself
  startRun, toMenu, update, render, spawnFish, speciesAt, boost, nextLevel, buy, spawnPickup, enterWorld, pvp, G, cam, camera, icons,
  get info() { return { score: G.score, level: G.level, world: G.world, shards: G.shards.size, worldPearls: G.worldPearls, zone: G.zone.name, index: G.index, spot: G.spot.name, tier: P.tier, points: G.points, owned: G.owned, stats: G.stats, free: G.cls.free }; },
};
addEventListener('resize', resize);
resize();
toMenu();
gameReady();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (game.manual || (!['menu', 'playing', 'over', 'online', 'lobby'].includes(app.state) && !G.pvp)) return; // paused or on the skill tree: the last frame stays up (online the match never pauses)
  update(dt);
  render();
});
