// Gulp! menus, saves, sound and input. The menus are plain HTML on top of the 3D canvas. Plain script, loaded
// before the game module; the game sets window.game when it's ready.

// Settings and best scores are saved in this browser. Private windows can block storage, so every access is guarded.
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
const settings = { sound: true, vibrate: true, cls: 'shark', ...store.get('gulp-settings', {}) };
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
  if (!open.includes(settings.cls)) settings.cls = 'shark'; // also replaces a fish from an older version
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
// Three dark panels (on a phone held upright: one at a time, picked with tabs), each a web of glowing hexagons joined
// by lines, under its branch's emblem. Owned nodes glow, ones you could learn have a lit edge, the rest are dim.
// Icons are tiny hand-drawn SVGs (24 × 24, in the branch's colour).
const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const GLYPHS = {
  target: `<g ${S}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></g>`,
  skull: '<path d="M12 2C7 2 3.5 5.5 3.5 10c0 2.6 1.2 4.6 3 5.8V19a1 1 0 0 0 1 1h1.5v-2h2v2h2v-2h2v2h1.5a1 1 0 0 0 1-1v-3.2c1.8-1.2 3-3.2 3-5.8C20.5 5.5 17 2 12 2Zm-3.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
  bolt: '<path d="M13.5 1 4 13.5h6.5L9 23l10-13h-6.8z"/>',
  eye: `<g ${S}><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></g>`,
  shield: '<path d="M12 1.5 3.5 5v6.5c0 5 3.6 9.2 8.5 11 4.9-1.8 8.5-6 8.5-11V5Zm0 3 5.5 2.3v4.7c0 3.4-2.3 6.4-5.5 7.8Z"/>',
  cloud: '<path d="M7 19a5 5 0 0 1-.6-10A6.5 6.5 0 0 1 19 9.5 4.8 4.8 0 0 1 18 19Z"/><circle cx="5" cy="21.5" r="1.4"/><circle cx="10" cy="22" r="1"/>',
  shell: '<path d="M12 3C6 3 2 8 2 13.5c0 1 .8 1.5 1.6 1.5h16.8c.8 0 1.6-.5 1.6-1.5C22 8 18 3 12 3Z"/><path d="M5 17h14l-2 3.5H7Z"/>',
  spikes: '<path d="M12 1 14 7 20 4 17 10 23 12 17 14 20 20 14 17 12 23 10 17 4 20 7 14 1 12 7 10 4 4 10 7Z"/>',
  rock: '<path d="M4 20 2 13l4-7 7-3 6 3 3 8-3 6Z"/>',
  drop: '<path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/>',
  bubble: `<g ${S}><circle cx="12" cy="12" r="9"/><path d="M8 9a4 4 0 0 1 3-3"/></g>`,
  regrow: `<g ${S}><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v5h-5"/></g>`,
  heart: '<path d="M12 21S2 14.5 2 8.2C2 5 4.4 3 7 3c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 2.6 0 5 2 5 5.2C22 14.5 12 21 12 21Z"/>',
  mouth: '<path d="M2 8c3-3 17-3 20 0-1 6-5 10-10 10S3 14 2 8Zm4 1.5 1.5 2.5L9 9.8l1.5 2.4L12 10l1.5 2.2L15 9.8l1.5 2.2L18 9.5Z"/>',
  bowl: '<path d="M2 11h20c0 5.5-4.5 9-10 9S2 16.5 2 11Z"/><path d="M8 3c-1 2 1 3 0 5M12 2c-1 2 1 4 0 6M16 3c-1 2 1 3 0 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  pearl: '<path d="M2 15c2-6 6-9 10-9s8 3 10 9Z" opacity=".55"/><circle cx="12" cy="13" r="4.5"/>',
  star: '<path d="m12 1.5 3.2 6.6 7.3 1-5.3 5.1 1.3 7.3L12 18l-6.5 3.5 1.3-7.3L1.5 9.1l7.3-1Z"/>',
  tooth: '<path d="M5 3c2-1 4 0 7 0s5-1 7 0c2 1.5 1.5 5 .5 7.5S18 21 16 21c-1.5 0-1.5-6-4-6s-2.5 6-4 6c-2 0-2.5-8-3.5-10.5S3 4.5 5 3Z"/>',
  magnet: '<path d="M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0Z"/><path d="M4 3h5v3H4zM15 3h5v3h-5z" fill="#fff" opacity=".7"/>',
  jaw: '<path d="M3 4h18l-2 3H5Z"/><path d="M5 9h14l-1 2.5h-1.6l-.9 2-.9-2h-1.7l-.9 2-.9-2H9.4l-.9 2-.9-2H6Z"/><path d="M4 15h16l-3 6H7Z"/>',
  compass: `<g ${S}><circle cx="12" cy="12" r="9.5"/></g><path d="m15.5 8.5-2 5-5 2 2-5Z"/>`,
  gem: '<path d="M6 3h12l4 6-10 13L2 9Zm-1.5 6h15L12 19Z"/>',
  gulp: '<path d="M12 2a10 10 0 1 0 8.7 15L12 12l8.7-5A10 10 0 0 0 12 2Zm-2 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/>',
  fin: '<path d="M2 20C6 9 13 3 22 2c-3 4-4 9-3 18Z"/>',
  gauge: `<g ${S}><path d="M3 17a9 9 0 1 1 18 0"/><path d="M12 17 16 9"/></g><circle cx="12" cy="17" r="2"/>`,
  wind: `<g ${S}><path d="M2 8h12a3 3 0 1 0-3-3M2 13h17a3 3 0 1 1-3 3M2 18h8"/></g>`,
  double: '<path d="M2 4l8 8-8 8Zm9 0 8 8-8 8Z"/>',
  arrow: '<path d="M2 10h13V4l8 8-8 8v-6H2Z"/>',
  wave: `<g ${S}><path d="M1 9c3-3 5 3 8 0s5 3 8 0 4-2 6-1M1 16c3-3 5 3 8 0s5 3 8 0 4-2 6-1"/></g>`,
  flame: '<path d="M12 1c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 2-7 1.5 1 2 2.5 2 4 1.5-2 2.5-5 2-9Z"/>',
  ghost: '<path d="M12 2a8 8 0 0 0-8 8v12l3-2.5L9.5 22l2.5-2.5 2.5 2.5 2.5-2.5L20 22V10a8 8 0 0 0-8-8Zm-3 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/>',
  jet: '<path d="M22 12 12 6v4H6L3 7v10l3-3h6v4Z"/><path d="M1 11h3v2H1z"/>',
  torpedo: '<path d="M3 9h13c3 0 6 1.5 6 3s-3 3-6 3H3l-2 3V6Z"/>',
};
const glyph = name => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${GLYPHS[name] ?? ''}</svg>`; // game data only
let treeSel = null;          // the node being looked at, e.g. "spines"
let treeTab = SKILLS[0].key; // which branch shows on a narrow screen
function openTree() {
  app.state = 'tree';
  treeSel = null;
  drawTree();
  showScreen('tree');
}
let ROW_H = 74; // px between rows of hexagons (less on a phone held upright)
function drawTree() {
  ROW_H = innerWidth <= 640 ? 54 : 74;
  const i = game.info, owned = i.owned;
  $('treeTitle').textContent = `LEVEL ${i.level} CLEAR!`;
  $('treePoints').textContent = `${i.points} skill point${i.points === 1 ? '' : 's'} to spend`;
  $('treeTabs').replaceChildren(...SKILLS.map(br => {
    const b = document.createElement('button');
    b.className = `tab${br.key === treeTab ? ' on' : ''}`;
    b.dataset.tab = br.key;
    b.style.setProperty('--c', br.color);
    b.innerHTML = `${glyph(br.emblem)}<span>${br.name}</span>`; // game data only
    return b;
  }));
  $('treeGrid').replaceChildren(...SKILLS.map(br => {
    const panel = document.createElement('div'), rows = Math.max(...br.nodes.map(n => n.row)) + 1, H = rows * ROW_H;
    panel.className = `panel${br.key === treeTab ? ' on' : ''}`;
    panel.style.setProperty('--c', br.color);
    // Lines first (behind): from each node up to each node it needs, as an elbow like a circuit.
    const at = n => ({ x: 50 + n.col * 33, y: n.row * ROW_H + ROW_H / 2 }), lines = [];
    for (const n of br.nodes) for (const id of n.needs) {
      const a = at(br.nodes.find(m => m.id === id)), b = at(n), lit = owned.includes(id);
      const mid = a.y + ROW_H / 2;
      lines.push(`<path class="${lit ? 'lit' : ''}" d="M${a.x} ${a.y} V${mid} H${b.x} V${b.y}"/>`);
    }
    panel.innerHTML = `<div class="emblem">${glyph(br.emblem)}</div><h3>${br.name} <small>${br.blurb}</small></h3>`
      + `<div class="web" style="height:${H}px"><svg viewBox="0 0 100 ${H}" preserveAspectRatio="none">${lines.join('')}</svg></div>`; // game data only
    const web = panel.querySelector('.web');
    for (const n of br.nodes) {
      const have = owned.includes(n.id), open = !have && nodeOpen(owned, n), p = at(n), b = document.createElement('button');
      b.className = `hex${have ? ' owned' : open ? ' open' : ' locked'}${treeSel === n.id ? ' sel' : ''}`;
      b.dataset.node = n.id;
      b.style.left = `${p.x}%`;
      b.style.top = `${p.y}px`;
      b.setAttribute('aria-label', `${n.name}${have ? ', learned' : `, ${nodeCost(n)} point${nodeCost(n) > 1 ? 's' : ''}`}`);
      b.innerHTML = `<span>${glyph(n.icon)}</span>`; // game data only
      web.append(b);
    }
    return panel;
  }));
  // The selected node's details and whether you can learn it.
  const sel = treeSel && findNode(treeSel), learn = $('learnBtn');
  if (!sel) {
    $('treeDetail').textContent = 'Tap a skill to see what it does. Each one opens from any skill joined to it above. Unspent points carry over.';
    learn.hidden = true;
  } else {
    const have = owned.includes(sel.id), cost = nodeCost(sel), names = sel.needs.map(skillName);
    const why = have ? 'Learned.' : !nodeOpen(owned, sel) ? `Learn ${names.join(' or ')} first.` : i.points < cost ? `Needs ${cost} point${cost > 1 ? 's' : ''}.` : '';
    $('treeDetail').innerHTML = `<b style="color:${sel.branch.color}">${sel.name}</b>: ${sel.desc}. ${why}`; // game data only
    learn.hidden = have;
    learn.disabled = !canBuy(owned, sel.id, i.points);
    learn.textContent = `Learn (${cost} pt${cost > 1 ? 's' : ''})`;
  }
  $('treeCombos').innerHTML = COMBOS.map(c => { // game data only
    const on = c.needs.every(n => owned.includes(n));
    return `<span class="${on ? 'on' : ''}">${on ? '&#10003; ' : ''}<b>${c.name}</b> (${c.needs.map(skillName).join(' + ')}): ${c.desc}</span>`;
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
  if (btn.dataset.tab) { treeTab = btn.dataset.tab; return drawTree(); }
  if (btn.dataset.node) { treeSel = btn.dataset.node; drawTree(); return $('learnBtn').hidden ? null : $('learnBtn').focus({ preventScroll: true }); }
  const action = btn.dataset.action;
  if (action === 'learn' && treeSel) {
    if (game.buy(treeSel)) jingle([659, 880, 1175], 70);
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
