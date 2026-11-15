// Gulp! game: the 3D scene, the camera, the player, the fish and the HUD. Loaded last, as a module. The rules
// (who eats whom, growth, score, spawns) live in rules.js; this file moves things and draws them.
import * as THREE from 'three';
import { makeFish, makeIcons, makeZone, waterAt, makeWarn, bubbleTexture, water } from './art.js';

const FOV = 45, DEG = Math.PI / 180, TAN = Math.tan(FOV / 2 * DEG);
const MAX_ASPECT = 1.25; // wider screens get side bars, so a desktop doesn't see far more of the sea than a phone
const camDist = viewH => viewH / 2 / TAN; // how far the camera sits from what it looks at to show that much of the plane
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clampMid = (v, a, b) => (a > b ? (a + b) / 2 : clamp(v, a, b)); // if the range is inside out, sit in the middle
const $ = id => document.getElementById(id);

// ---------- Renderer, scene, camera, lights ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.id = 'view';
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x4cbfdc, 1000, 5000);
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
let view = { x0: -600, x1: 600, y0: -700, y1: 700 };
function viewRect() {
  const r = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const [cx, cy] of CORNERS) {
    ndc.set(cx, cy);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) continue;
    r.x0 = Math.min(r.x0, hit.x); r.x1 = Math.max(r.x1, hit.x);
    r.y0 = Math.min(r.y0, hit.y); r.y1 = Math.max(r.y1, hit.y);
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
const FX = 160, fxPos = new Float32Array(FX * 3).fill(1e6), fxVel = new Float32Array(FX * 3), fxLife = new Float32Array(FX);
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
const PLAYER_SPEC = { key: 'player', eye: 1.35, ...PLAYER };
const icons = makeIcons([...ZONES.flatMap(z => z.fish), PLAYER_SPEC]);
$('youIcon').src = icons.player;
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
function popup(text, x, y, big) {
  tmp.set(x, y, 0).project(camera);
  const el = document.createElement('div');
  el.className = big ? 'pop combo' : 'pop';
  el.textContent = text;
  el.style.left = `${viewLeft + (tmp.x + 1) / 2 * viewW}px`;
  el.style.top = `${(1 - tmp.y) / 2 * viewH}px`;
  el.addEventListener('animationend', () => el.remove());
  $('pops').append(el);
}
function buildChain() {
  const list = [...G.zone.fish].sort((a, b) => a.tier - b.tier);
  $('chain').replaceChildren(...list.map(s => {
    const chip = document.createElement('div');
    chip.dataset.tier = s.tier;
    chip.title = s.behavior === 'puff' ? `${s.name} (puffs up when you get close)` : s.name;
    chip.innerHTML = `<img src="${icons[s.key]}" alt=""><i>${s.behavior === 'puff' ? 'puff' : s.tier}</i>`; // game data only
    return chip;
  }));
}
function updateChain() {
  for (const chip of $('chain').children) {
    const t = Number(chip.dataset.tier);
    chip.className = `chip ${G.player.tier > t ? 'food' : G.player.tier < t ? 'danger' : 'same'}`;
  }
}
let shown = {};
function updateHud() {
  const P = G.player, combo = G.comboT > 0 && G.combo > 1 ? `×${Math.min(G.combo, COMBO_MAX)}` : '';
  if (shown.score !== G.score) $('score').textContent = (shown.score = G.score).toLocaleString();
  if (shown.combo !== combo) $('combo').textContent = shown.combo = combo;
  const where = `${G.zone.name} · depth ${G.depth}`;
  if (shown.where !== where) $('where').textContent = shown.where = where;
  const fill = `${(G.meter / METER_NEED) * 100}%`;
  if (shown.fill !== fill) $('meterFill').style.width = shown.fill = fill;
  if (shown.tier !== P.tier) { shown.tier = P.tier; updateChain(); }
  const charge = Math.round(P.charge * 50) / 50; // the boost button fills up like a clock while it recharges
  if (shown.charge !== charge) {
    if (charge >= 1 && shown.charge < 1) beep(1200, 50, 0.025); // a little ping when it's ready again
    shown.charge = charge;
    const b = $('boostBtn');
    b.style.setProperty('--charge', charge);
    b.classList.toggle('ready', charge >= 1);
  }
}

// ---------- Game state ----------
// mode: 'menu' (fish swim behind the main menu) | 'play'. phase while playing: 'swim' | 'dying' | 'cleared'.
const G = { mode: 'menu', phase: 'swim', zone: null, scenery: null, depth: 1, seed: 0, spawner: null, fish: [], t: 0,
  spawnT: 0, phaseT: 0, score: 0, combo: 0, comboT: 0, meter: 0, eatenBy: '', player: null };

const P = G.player = { obj: makeFish(PLAYER_SPEC), x: 0, y: 0, vx: 0, vy: 0, len: FISH_LEN[1], tier: 1, face: 1, pulse: 0, safe: 0, alive: false, phase: 0, gulp: 0, boost: 0, charge: 1 };
scene.add(P.obj.root);
P.obj.root.visible = false;

function setZone(zone) {
  if (G.zone === zone) return;
  G.scenery?.dispose();
  G.zone = zone;
  G.scenery = makeZone(zone, scene, mulberry32(hashSeed(zone.key)));
  hemi.color.set(zone.sky);
  hemi.groundColor.set(zone.ground);
  sun.intensity = zone.sun;
  buildChain();
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

const yawFor = face => (face > 0 ? -0.35 : -Math.PI + 0.35); // turned a little towards the camera, so you see 3D
function spawnFish(species, x, y, dir) {
  const f = { s: species, tier: species.tier, x, y, vx: dir * species.speed, vy: 0, dir, face: dir, len: FISH_LEN[species.tier] * (species.behavior === 'puff' ? 0.9 : 1),
    obj: makeFish(species), phase: Math.random() * 6, wob: Math.random() * 6, chase: 0, rest: 0, puff: 0, puffT: -2, warn: null };
  f.obj.yaw.rotation.y = yawFor(dir);
  scene.add(f.obj.root);
  G.fish.push(f);
  return f;
}
// A new fish (or a school) arrives from just past the left or right edge of the view.
function spawn(inside = false) {
  const sp = G.spawner.next(G.mode === 'play' ? P.tier : 2), dir = sp.fromLeft ? 1 : -1;
  const len = FISH_LEN[sp.species.tier];
  let x0 = dir > 0 ? view.x0 - 80 - len : view.x1 + 80 + len;
  if (inside) { // filling the sea at the start of a zone: anywhere in view, but not on top of you
    x0 = view.x0 + G.spawner.rand() * (view.x1 - view.x0);
    if (G.mode === 'play' && Math.abs(x0 - P.x) < 320) x0 = P.x + Math.sign(x0 - P.x || 1) * 320;
  }
  const y0 = clamp((view.y0 + view.y1) / 2 + sp.y * (view.y1 - view.y0) / 2 * 0.85, -WORLD.y + 80, WORLD.y - 80);
  for (let i = 0; i < sp.count; i++) spawnFish(sp.species, x0 - dir * Math.random() * 160, clamp(y0 + (Math.random() - 0.5) * 140, -WORLD.y + 40, WORLD.y - 40), dir);
}
function startZone() {
  setZone(ZONES[(G.depth - 1) % ZONES.length]);
  clearFish();
  G.spawner = makeSpawner(hashSeed(`${G.seed}/${G.depth}`), G.zone);
  G.meter = 0;
  G.phase = 'swim';
  G.spawnT = 0;
  if (G.mode === 'play') {
    Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0, tier: 1, safe: PLAYER.safe });
    Object.assign(cam, { x: 0, y: 0, yaw: 0 });
  }
  placeCamera();
  for (let i = 0; i < 8; i++) spawn(true);
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
function boost() {
  if (app.state !== 'playing' || !P.alive || P.charge < 1) return;
  let { x, y } = stick();
  const m = Math.hypot(x, y);
  if (m < 0.2) { x = P.face; y = 0; } else { x /= m; y /= m; }
  const s = PLAYER.speed * BOOST.speed;
  P.vx = x * s;
  P.vy = y * s;
  P.boost = BOOST.time;
  P.charge = 0;
  burst(P.x, P.y, 14, 160);
  beep(220, 260, 0.05, 'sawtooth', 3);
  buzz(30);
}

function updatePlayer(dt) {
  if (P.alive) {
    const s = { ...stick() }; // a copy: the joystick's own vector mustn't change
    let speed = PLAYER.speed, turn = PLAYER.turn;
    if (P.boost > 0) { // boosting: full speed ahead, steering still works
      P.boost -= dt;
      speed *= BOOST.speed;
      turn *= 2;
      const m = Math.hypot(s.x, s.y), v = Math.hypot(P.vx, P.vy) || 1;
      if (m < 0.2) { s.x = P.vx / v; s.y = P.vy / v; } else { s.x /= m; s.y /= m; }
      if (Math.random() < 0.6) burst(P.x - P.vx / v * P.len * 0.5, P.y - P.vy / v * P.len * 0.5, 1, 30); // bubble trail
    } else P.charge = Math.min(1, P.charge + dt / BOOST.recharge);
    P.vx += (s.x * speed - P.vx) * Math.min(1, dt * turn);
    P.vy += (s.y * speed - P.vy) * Math.min(1, dt * turn);
    P.x = clamp(P.x + P.vx * dt, -WORLD.x + 40, WORLD.x - 40);
    P.y = clamp(P.y + P.vy * dt, -WORLD.y + P.len * 0.25, WORLD.y - P.len * 0.25);
  }
  P.len += (FISH_LEN[P.tier] - P.len) * Math.min(1, dt * 4);
  P.pulse = Math.max(0, P.pulse - dt * 5);
  P.safe -= dt;
  pose(P, dt);
  let scale = P.len * (1 + 0.15 * P.pulse);
  if (!P.alive) { // being swallowed: shrink into the predator's mouth
    P.gulp = Math.min(1, P.gulp + dt * 3);
    scale *= 1 - P.gulp;
  }
  P.obj.root.scale.setScalar(Math.max(scale, 0.001));
  P.obj.root.visible = P.safe > 0 && P.alive ? G.t * 8 % 2 < 1.5 : true; // blink while nothing can eat you
}

function updateFish(f, dt) {
  const s = f.s, live = G.mode === 'play' && P.alive && G.phase === 'swim', mult = speedAt(G.depth), sp = s.speed * mult;
  let tx = f.dir * sp, ty = Math.sin(G.t * 0.8 + f.wob) * sp * 0.25, rate = 2.5;
  const dx = P.x - f.x, dy = P.y - f.y, d = Math.hypot(dx, dy) || 1;
  if (s.behavior === 'puff') { // swells up (and becomes dangerous) when you swim close, then slowly shrinks
    f.puffT -= dt;
    if (live && f.puffT <= -1.5 && d < 200 + P.len * 0.5) { f.puffT = 2.6; beep(220, 160, 0.04, 'sine', 2); }
    const want = f.puffT > 0.5 ? 1 : 0;
    f.puff += (want - f.puff) * Math.min(1, dt * (want ? 9 : 3));
    f.tier = f.puff > 0.5 ? s.puffTo : s.tier;
    tx *= 1 - f.puff * 0.8;
    ty *= 1 - f.puff * 0.8;
    f.obj.spikes.scale.setScalar(Math.max(f.puff, 0.001));
  }
  if (live && (s.behavior === 'skittish' || s.behavior === 'school') && canEat(P, f) && d < TUNING.fleeRange) {
    tx = -dx / d * sp * 1.7; // swim away from you
    ty = -dy / d * sp * 1.7;
    rate = 5;
    f.dir = Math.sign(tx) || f.dir;
  }
  if (s.behavior === 'hunter') {
    f.rest -= dt;
    if (f.chase > 0 && live && canEat(f, P)) {
      f.chase -= dt;
      const cs = Math.min(TUNING.chaseSpeed * mult, 0.95) * PLAYER.speed;
      tx = dx / d * cs;
      ty = dy / d * cs;
      rate = 4;
      if (f.chase <= 0) { f.rest = TUNING.chaseRest; f.dir = Math.sign(f.vx) || f.dir; }
    } else if (live && canEat(f, P) && f.rest <= 0 && d < TUNING.chaseRange && P.safe <= 0) {
      f.chase = TUNING.chaseTime;
      beep(880, 90, 0.04, 'square');
      if (!f.warn) scene.add(f.warn = makeWarn());
    } else f.chase = 0;
  }
  f.vx += (tx - f.vx) * Math.min(1, dt * rate);
  f.vy += (ty - f.vy) * Math.min(1, dt * rate);
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  const lim = WORLD.y - f.len * 0.3;
  if (Math.abs(f.y) > lim) { f.y = Math.sign(f.y) * lim; f.vy = 0; }
  pose(f, dt);
  f.obj.root.scale.setScalar(f.len * (1 + 0.7 * f.puff));
  if (f.warn) {
    f.warn.visible = f.chase > TUNING.chaseTime - 1.2; // shows for the first moment of a chase
    f.warn.position.set(f.x, f.y + f.len * 0.5 + 40, 20);
  }
}

// Touching: bigger eats smaller, the same size bumps.
function collide() {
  const pr = P.len * SHAPE_R.oval;
  for (const f of [...G.fish]) {
    const dx = f.x - P.x, dy = f.y - P.y, d = Math.hypot(dx, dy) || 1, fr = f.len * SHAPE_R[f.s.shape] * (1 + 0.7 * f.puff);
    if (canEat(P, f) && d < pr * 1.15 + fr * 0.8) eat(f);
    else if (canEat(f, P) && P.safe <= 0 && d < (pr + fr) * 0.72) return die(f);
    else if (!canEat(f, P) && d < (pr + fr) * 0.9) { // same size: push apart
      const push = ((pr + fr) * 0.9 - d) / 2, nx = dx / d, ny = dy / d;
      P.x -= nx * push; P.y -= ny * push; f.x += nx * push; f.y += ny * push;
      P.vx -= nx * 120; P.vy -= ny * 120; f.vx += nx * 120; f.vy += ny * 120;
    }
  }
}
function eat(f) {
  removeFish(f);
  G.combo = G.comboT > 0 ? G.combo + 1 : 1;
  G.comboT = COMBO_GAP;
  const pts = scoreFor(f.s.tier, G.combo);
  G.score += pts;
  G.meter = Math.min(METER_NEED, G.meter + GROW[f.s.tier]);
  popup(G.combo > 1 ? `+${pts} ×${Math.min(G.combo, COMBO_MAX)}` : `+${pts}`, f.x, f.y + f.len * 0.4, G.combo > 1);
  burst(f.x, f.y, 6 + f.s.tier * 4);
  P.pulse = 1;
  beep(380 + f.s.tier * 140 + Math.min(G.combo, COMBO_MAX) * 40, 70, 0.06, 'square', 0.5);
  buzz(15);
  const t = tierFor(G.meter);
  if (G.meter >= METER_NEED) return zoneCleared();
  if (t > P.tier) {
    P.tier = t;
    const food = G.zone.fish.filter(s => s.tier < t && s.tier > 0).map(s => s.name);
    banner('GROWN!', `Now you can eat: ${food.join(', ')}`);
    burst(P.x, P.y, 24, 260);
    jingle([523, 659, 784, 1047]);
    buzz(60);
  }
}
function die(f) {
  P.alive = false;
  P.gulp = 0;
  G.phase = 'dying';
  G.phaseT = 1.3;
  G.eatenBy = f.s.name;
  f.vx = (P.x - f.x) * 3; // the predator lunges through you
  f.vy = (P.y - f.y) * 3;
  burst(P.x, P.y, 30, 220);
  boom(400, 0.12);
  beep(300, 400, 0.06, 'sawtooth', 0.25);
  buzz(250);
}
function zoneCleared() {
  const bonus = CLEAR_BONUS * G.depth;
  G.score += bonus;
  G.phase = 'cleared';
  G.phaseT = 2.6;
  P.tier = 3;
  P.safe = 99;
  banner(`${G.zone.name.toUpperCase()} CLEARED!`, `+${bonus.toLocaleString()} · the fish get faster`, 2400);
  burst(P.x, P.y, 40, 320);
  jingle([523, 659, 784, 1047, 1319], 110);
  buzz(120);
}

// One step of the game. dt in seconds.
function update(dt) {
  G.t += dt;
  const play = G.mode === 'play';
  if (play) updatePlayer(dt);
  else Object.assign(cam, { x: Math.sin(G.t * 0.06) * 900, y: -380 + Math.sin(G.t * 0.11) * 120, dist: camDist(VIEW_H[2]), yaw: Math.sin(G.t * 0.09) * CAMERA.sway * DEG });
  for (const f of [...G.fish]) updateFish(f, dt);
  if (play && P.alive && G.phase === 'swim') collide();
  if (play) { // the camera follows you (looking a little ahead), swings with your swimming and pulls back as you grow
    const k = Math.min(1, dt * 4);
    cam.dist += (camDist(VIEW_H[P.tier]) - cam.dist) * Math.min(1, dt * 2);
    const hw = (view.x1 - view.x0) / 2, below = cam.y - view.y0, above = view.y1 - cam.y;
    cam.x += (clampMid(P.x + P.vx * CAMERA.lead, -WORLD.x - 100 + hw, WORLD.x + 100 - hw) - cam.x) * k;
    cam.y += (clampMid(P.y + P.vy * CAMERA.lead, -WORLD.y - 160 + below, WORLD.y + 160 - above) - cam.y) * k;
    cam.yaw += (-P.vx / PLAYER.speed * CAMERA.sway * DEG - cam.yaw) * Math.min(1, dt * 1.5);
  }
  placeCamera();
  // Fish leave when they're far off screen; new ones arrive while the sea is below its population.
  for (const f of [...G.fish]) if (f.x < view.x0 - 900 || f.x > view.x1 + 900 || f.y < view.y0 - 900 || f.y > view.y1 + 900) removeFish(f);
  G.spawnT -= dt;
  if (G.spawnT <= 0 && G.fish.length < TUNING.population && G.phase !== 'cleared') { spawn(); G.spawnT = TUNING.spawnEvery; }
  G.comboT -= dt;
  if (G.phaseT > 0 && (G.phaseT -= dt) <= 0) {
    if (G.phase === 'dying') runOver({ score: G.score, depth: G.depth, eatenBy: G.eatenBy });
    else if (G.phase === 'cleared') {
      G.depth++;
      startZone();
      banner(G.zone.name.toUpperCase(), `Depth ${G.depth}`);
    }
  }
  if (bannerTimer > 0 && (bannerTimer -= dt) <= 0) $('banner').hidden = true;
  // Water colour and fog follow the camera: lighter near the surface, darker near the floor.
  waterAt(G.zone, cam.y, scene.fog.color);
  scene.fog.near = cam.dist * 1.15; // the bottom of a tilted view is further away than the middle
  scene.fog.far = cam.dist + 3600;
  water.uTime.value = G.t;
  G.scenery.update(dt, camera);
  updateFx(dt);
  if (play) updateHud();
}
function render() { renderer.render(scene, camera); }

// ---------- Called by the menus (ui.js) ----------
function startRun(seed = Math.floor(Math.random() * 1e9)) {
  G.mode = 'play';
  G.seed = seed;
  G.depth = 1;
  G.score = 0;
  G.combo = 0;
  G.comboT = 0;
  Object.assign(P, { alive: true, gulp: 0, len: FISH_LEN[1], pulse: 0, face: 1, boost: 0, charge: 1 });
  P.obj.root.visible = true;
  cam.dist = camDist(VIEW_H[1]);
  shown = {};
  startZone();
  updateHud();
  banner(G.zone.name.toUpperCase(), G.zone.sub);
  jingle([392, 523, 659], 110);
}
function toMenu() {
  G.mode = 'menu';
  P.alive = false;
  P.obj.root.visible = false;
  $('banner').hidden = true;
  G.depth = 1;
  G.seed = 'menu';
  startZone();
}

let last = 0;
window.game = {
  manual: false, // the playtest sets this and steps the game itself
  startRun, toMenu, update, render, spawnFish, boost, G, camera,
  get info() { return { score: G.score, depth: G.depth, zone: G.zone.name, tier: P.tier }; },
};
addEventListener('resize', resize);
resize();
toMenu();
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (game.manual || !['menu', 'playing', 'over'].includes(app.state)) return; // paused: the last frame stays up
  update(dt);
  render();
});
