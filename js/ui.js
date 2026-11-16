// Gulp! menus, saves, sound and input. The menus are plain HTML on top of the 3D canvas. Plain script, loaded
// before the game module; the game sets window.game when it's ready.

// Settings and best scores are saved in this browser. Private windows can block storage, so every access is guarded.
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
const settings = { sound: true, vibrate: true, cls: 'scamp', ...store.get('gulp-settings', {}) };
const saveSettings = () => store.set('gulp-settings', settings);
const oldBest = store.get('gulp-best', {}); // step 1 saved "depth"; it's "level" now
let best = { score: oldBest.score ?? 0, level: oldBest.level ?? oldBest.depth ?? 0 };
// What unlocks classes, kept between runs: the furthest level reached and the best score in one run.
const progress = { bestLevel: best.level, bestScore: best.score, ...store.get('gulp-progress', {}) };
const unlockedClasses = () => CLASSES.filter(c => classUnlocked(c, progress)).map(c => c.key);
// Called by the game as you clear levels, so a class can unlock mid-run.
function noteProgress({ level = 0, score = 0, apex = false, portal = false }) {
  progress.bestLevel = Math.max(progress.bestLevel, level);
  progress.bestScore = Math.max(progress.bestScore, score);
  if (apex) progress.apexBeaten = true;
  if (portal) progress.portals = (progress.portals ?? 0) + 1;
  store.set('gulp-progress', progress);
}

// ---------- Sound: tiny synth notes and noise bursts, no audio files. ----------
// Browsers (iPhones especially) only allow sound after a tap or key press, so the audio is created on the first one.
let audio;
function unlockAudio() { try { audio ??= new AudioContext(); audio.resume(); } catch {} }
addEventListener('pointerup', unlockAudio);
addEventListener('keydown', unlockAudio);
function beep(freq, ms = 60, vol = 0.05, type = 'triangle', slide = 0) {
  if (!audio || !settings.sound) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + ms / 1000);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(t + ms / 1000);
  } catch {}
}
function boom(ms = 300, vol = 0.1) {
  if (!audio || !settings.sound) return;
  try {
    const len = Math.floor(audio.sampleRate * ms / 1000), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = audio.createBufferSource(), g = audio.createGain(), lp = audio.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(lp).connect(g).connect(audio.destination);
    src.start();
  } catch {}
}
const jingle = (notes, gap = 90) => notes.forEach((f, i) => setTimeout(() => beep(f, 120, 0.05), i * gap));
const buzz = ms => { if (settings.vibrate) try { navigator.vibrate?.(ms); } catch {} };

// ---------- Menus ----------
const $ = id => document.getElementById(id);
// The whole game is in one of these states; only 'playing' accepts game input.
// 'menu' | 'playing' | 'paused' | 'tree' (skill tree between levels) | 'keep' (skills to keep through a portal) | 'over'
const app = { state: 'menu', settingsFrom: 'main' };
// What the player is pressing, read by the game every frame. stick: the floating joystick (x right, y up, length
// up to 1); mouse: the pointer's page position; keys: arrow keys / WASD held down.
const input = { stick: null, mouse: null, keys: new Set() };

// Show one menu screen (or none, while playing) and put keyboard focus on its main button.
function showScreen(id) {
  $('ui').hidden = !id;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  if (id) $(id).querySelector('.primary, button')?.focus({ preventScroll: true });
  const playing = app.state === 'playing';
  $('pauseBtn').hidden = !playing;
  $('boostBtn').hidden = !playing;
  $('hud').hidden = !(playing || app.state === 'paused');
  if (!playing) endStick();
}
function updateMain() {
  $('mainBest').textContent = best.score ? `Best: ${best.score.toLocaleString()} · level ${best.level}` : 'No best score yet';
  buildClassPicker();
}
// The kind of fish you start as: unlocked classes can be picked; locked ones say how to open them.
function buildClassPicker() {
  if (!window.game) return;
  const open = unlockedClasses();
  if (!open.includes(settings.cls)) settings.cls = 'scamp';
  $('classes').replaceChildren(...CLASSES.map(c => {
    const b = document.createElement('button'), locked = !open.includes(c.key);
    b.className = `cls${c.key === settings.cls ? ' sel' : ''}${locked ? ' locked' : ''}`;
    b.dataset.cls = c.key;
    b.setAttribute('aria-label', locked ? `${c.name}, locked: ${c.unlock.text}` : `${c.name}: ${c.desc}`);
    b.innerHTML = `<img src="${game.icons[`class-${c.key}`]}" alt=""><span>${locked ? '&#128274; ' : ''}${c.name}</span>`; // game data only
    return b;
  }));
  const c = CLASSES.find(k => k.key === settings.cls);
  $('classInfo').textContent = `${c.name}: ${c.desc}`;
}
function pickClass(key) {
  const c = CLASSES.find(k => k.key === key);
  if (!unlockedClasses().includes(key)) { $('classInfo').textContent = `${c.name} is locked. ${c.unlock.text} to unlock it.`; return; }
  settings.cls = key;
  saveSettings();
  buildClassPicker();
  $('classes').querySelector('.sel')?.focus({ preventScroll: true });
}
// Called once the game module has loaded.
function gameReady() { updateMain(); }
function startRun() {
  if (!window.game) return;
  app.state = 'playing';
  game.startRun(undefined, settings.cls);
  showScreen(null);
  document.activeElement?.blur();
}
function toMenu() {
  app.state = 'menu';
  window.game?.toMenu();
  updateMain();
  showScreen('main');
}
function pauseGame() {
  if (app.state !== 'playing') return;
  app.state = 'paused';
  const i = game.info;
  $('pauseInfo').textContent = `World ${i.world + 1} · ${i.zone} ${i.index + 1}/${LEVELS_PER_ZONE} (level ${i.level}) · ${i.shards}/${LEVELS_PER_ZONE} shards · score ${i.score.toLocaleString()}`;
  showScreen('pause');
}

// ---------- The skill tree, between levels ----------
let treeSel = null; // the node being looked at, e.g. "jaws2"
function openTree() {
  app.state = 'tree';
  treeSel = null;
  drawTree();
  showScreen('tree');
}
function drawTree() {
  const i = game.info, owned = i.owned;
  $('treeTitle').textContent = `LEVEL ${i.level} CLEAR!`;
  $('treePoints').textContent = `${i.points} skill point${i.points === 1 ? '' : 's'} to spend`;
  $('treeGrid').replaceChildren(...SKILLS.map(br => {
    const col = document.createElement('div');
    col.className = 'branch';
    col.style.setProperty('--c', br.color);
    col.innerHTML = `<h3>${br.name}</h3>`; // game data only
    br.nodes.forEach((n, k) => {
      const id = nodeId(br.key, k), b = document.createElement('button'), have = owned.includes(id);
      const open = !have && (k === 0 || owned.includes(nodeId(br.key, k - 1)));
      b.className = `node${have ? ' owned' : open ? ' open' : ' locked'}${treeSel === id ? ' sel' : ''}`;
      b.dataset.node = id;
      b.innerHTML = `<b>${n.name}</b><small>${have ? '&#10003;' : `${nodeCost(k)} pt${k ? 's' : ''}`}</small>`;
      col.append(b);
    });
    return col;
  }));
  // The selected node's details and whether you can learn it.
  const sel = treeSel && SKILLS.map(br => br.nodes.map((n, k) => ({ br, n, k }))).flat().find(x => nodeId(x.br.key, x.k) === treeSel);
  const learn = $('learnBtn');
  if (!sel) {
    $('treeDetail').textContent = 'Tap a skill to see what it does. Each branch unlocks in order, and you can save points for later.';
    learn.hidden = true;
  } else {
    const have = owned.includes(treeSel), prev = sel.k > 0 && sel.br.nodes[sel.k - 1];
    const why = have ? 'Learned.' : !canBuy(owned, sel.br.key, sel.k, Infinity) ? `Learn ${prev.name} first.` : i.points < nodeCost(sel.k) ? `Needs ${nodeCost(sel.k)} points.` : '';
    $('treeDetail').textContent = `${sel.n.name} (${sel.br.name} ${sel.k + 1}): ${sel.n.desc}. ${why}`;
    learn.hidden = have;
    learn.disabled = !canBuy(owned, sel.br.key, sel.k, i.points);
    learn.textContent = `Learn for ${nodeCost(sel.k)} point${sel.k ? 's' : ''}`;
  }
  const name = id => { const b = SKILLS.find(s => id.startsWith(s.key)); return b.nodes[Number(id.slice(b.key.length)) - 1].name; };
  $('treeCombos').innerHTML = '<b>Combos</b> ' + COMBOS.map(c => { // game data only
    const on = c.needs.every(n => owned.includes(n));
    return `<span class="${on ? 'on' : ''}">${on ? '&#10003; ' : ''}<b>${c.name}</b> (${c.needs.map(name).join(' + ')}): ${c.desc}</span>`;
  }).join('');
  $('treeNext').classList.toggle('primary', i.points === 0 || !sel);
}
function leaveTree() {
  app.state = 'playing';
  showScreen(null);
  document.activeElement?.blur();
  game.nextLevel();
}
// ---------- Through the portal: pick the skills to keep ----------
let keepMax = 1, keepSel = [];
function openKeep(n) {
  app.state = 'keep';
  keepMax = n;
  keepSel = [];
  drawKeep();
  showScreen('keep');
}
function drawKeep() {
  const i = game.info, list = i.owned.filter(id => id !== i.free);
  $('keepInfo').textContent = list.length
    ? `Your size, skill tree and shards start over in the next world. Keep ${keepMax} skill${keepMax > 1 ? 's' : ''} (pearls found in this world let you keep more): ${keepSel.length}/${keepMax} picked.`
    : 'You have no skills to keep yet. Your size and shards start over in the next world.';
  $('keepList').replaceChildren(...list.map(id => {
    const b = document.createElement('button'), on = keepSel.includes(id);
    b.className = `keepSkill${on ? ' on' : ''}`;
    b.dataset.keep = id;
    b.textContent = `${on ? '\u2713 ' : ''}${skillName(id)}`;
    return b;
  }));
}
function toggleKeep(id) {
  if (keepSel.includes(id)) keepSel = keepSel.filter(k => k !== id);
  else if (keepSel.length < keepMax) keepSel.push(id);
  drawKeep();
}
function diveIn() {
  app.state = 'playing';
  showScreen(null);
  document.activeElement?.blur();
  game.enterWorld(keepSel);
}
function resumeGame() {
  app.state = 'playing';
  showScreen(null);
  document.activeElement?.blur();
}
function openSettings() {
  app.settingsFrom = app.state === 'paused' ? 'pause' : app.state === 'over' ? 'over' : 'main';
  showScreen('settings');
}
// Called by the game when you get eaten.
function runOver({ score, level, eatenBy, world = 1, shards = 0 }) {
  const before = unlockedClasses();
  noteProgress({ level, score });
  const isBest = score > best.score;
  if (isBest) {
    best = { score, level };
    store.set('gulp-best', best);
  }
  app.state = 'over';
  $('overWho').textContent = `Gulped by ${/^[aeiou]/i.test(eatenBy) ? 'an' : 'a'} ${eatenBy} on level ${level}, in world ${world} (${shards}/${LEVELS_PER_ZONE} shards).`;
  $('overScore').textContent = `Score ${score.toLocaleString()}`;
  $('overBest').textContent = isBest ? 'New best!' : `Best: ${best.score.toLocaleString()}`;
  const fresh = CLASSES.filter(c => unlockedClasses().includes(c.key) && !before.includes(c.key)).map(c => c.name);
  $('overUnlock').textContent = fresh.length ? `New fish unlocked: ${fresh.join(', ')}! Pick it on the main menu.` : '';
  showScreen('over');
}

$('ui').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || !window.game) return;
  if (btn.dataset.cls) return pickClass(btn.dataset.cls);
  if (btn.dataset.keep) return toggleKeep(btn.dataset.keep);
  if (btn.dataset.node) { treeSel = btn.dataset.node; drawTree(); return $('learnBtn').hidden ? null : $('learnBtn').focus({ preventScroll: true }); }
  const action = btn.dataset.action;
  if (action === 'learn' && treeSel) {
    const b = SKILLS.find(s => treeSel.startsWith(s.key));
    if (game.buy(b.key, Number(treeSel.slice(b.key.length)) - 1)) jingle([659, 880, 1175], 70);
    drawTree();
  } else if (action === 'next') leaveTree();
  else if (action === 'dive') diveIn();
  else if (action === 'play') startRun();
  else if (action === 'resume') resumeGame();
  else if (action === 'menu') toMenu();
  else if (action === 'settings') openSettings();
  else if (action === 'back') showScreen(app.settingsFrom);
});
$('pauseBtn').addEventListener('click', pauseGame);
// Boost fires the moment a finger lands (not on release), so it works while the other thumb holds the joystick.
$('boostBtn').addEventListener('pointerdown', e => { e.preventDefault(); window.game?.boost(); });
for (const id of ['sound', 'vibrate']) {
  $(id).checked = settings[id];
  $(id).addEventListener('change', e => { settings[id] = e.target.checked; saveSettings(); });
}
const MOVE_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'];
addEventListener('keydown', e => {
  const key = e.key?.toLowerCase();
  if (MOVE_KEYS.includes(key)) {
    input.keys.add(key);
    if (app.state === 'playing') e.preventDefault();
  }
  if (key === ' ' && app.state === 'playing') {
    e.preventDefault();
    if (!e.repeat) game.boost();
  }
  if (key !== 'escape' && key !== 'p') return;
  if (app.state === 'playing') pauseGame();
  else if (app.state === 'paused') resumeGame();
});
addEventListener('keyup', e => input.keys.delete(e.key?.toLowerCase()));
addEventListener('blur', () => input.keys.clear());
// Switching apps or tabs mid-run opens the pause menu.
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// Touch: a floating joystick. Put a thumb down anywhere (even below the game) and drag: the direction is where you
// swim, and the distance (up to STICK_R) is how fast. Mouse: the fish swims towards the pointer.
const STICK_R = 56;
let stickId = null, ox = 0, oy = 0;
function endStick(e) {
  if (e && e.pointerId !== stickId) return;
  stickId = null;
  input.stick = null;
  $('stick').hidden = true;
}
addEventListener('pointerdown', e => {
  if (e.target.closest?.('button, a, label, input') || app.state !== 'playing') return; // menu taps aren't game input
  if (e.pointerType === 'mouse') { // the fish follows the mouse; a click boosts
    input.mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 0) game.boost();
    return;
  }
  if (stickId !== null) return;
  stickId = e.pointerId;
  ox = e.clientX;
  oy = e.clientY;
  input.stick = { x: 0, y: 0 };
  const s = $('stick');
  s.style.left = `${ox}px`;
  s.style.top = `${oy}px`;
  $('knob').style.transform = 'translate(0px, 0px)';
  s.hidden = false;
});
addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { input.mouse = { x: e.clientX, y: e.clientY }; return; }
  if (e.pointerId !== stickId) return;
  const dx = e.clientX - ox, dy = e.clientY - oy, m = Math.hypot(dx, dy), k = Math.min(1, m / STICK_R);
  input.stick = m < 6 ? { x: 0, y: 0 } : { x: dx / m * k, y: -dy / m * k };
  const r = Math.min(m, STICK_R) / (m || 1);
  $('knob').style.transform = `translate(${dx * r}px, ${dy * r}px)`;
});
addEventListener('pointerup', endStick);
addEventListener('pointercancel', endStick);
document.documentElement.addEventListener('mouseleave', () => { input.mouse = null; });
addEventListener('contextmenu', e => e.preventDefault());

updateMain();
