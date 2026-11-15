// Gulp! menus, saves, sound and input. The menus are plain HTML on top of the 3D canvas. Plain script, loaded
// before the game module; the game sets window.game when it's ready.

// Settings and best scores are saved in this browser. Private windows can block storage, so every access is guarded.
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
const settings = { sound: true, vibrate: true, ...store.get('gulp-settings', {}) };
const saveSettings = () => store.set('gulp-settings', settings);
let best = { score: 0, depth: 0, ...store.get('gulp-best', {}) };

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
// The whole game is in one of these states; only 'playing' accepts game input. 'menu' | 'playing' | 'paused' | 'over'
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
  $('hud').hidden = !(playing || app.state === 'paused');
  if (!playing) endStick();
}
function updateMain() {
  $('mainBest').textContent = best.score ? `Best: ${best.score.toLocaleString()} · depth ${best.depth}` : 'No best score yet';
}
function startRun() {
  if (!window.game) return;
  app.state = 'playing';
  game.startRun();
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
  $('pauseInfo').textContent = `${i.zone} · depth ${i.depth} · score ${i.score.toLocaleString()}`;
  showScreen('pause');
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
function runOver({ score, depth, eatenBy }) {
  const isBest = score > best.score;
  if (isBest) {
    best = { score, depth };
    store.set('gulp-best', best);
  }
  app.state = 'over';
  $('overWho').textContent = `Gulped by ${/^[aeiou]/i.test(eatenBy) ? 'an' : 'a'} ${eatenBy} at depth ${depth}.`;
  $('overScore').textContent = `Score ${score.toLocaleString()}`;
  $('overBest').textContent = isBest ? 'New best!' : `Best: ${best.score.toLocaleString()}`;
  showScreen('over');
}

$('ui').addEventListener('click', e => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action || !window.game) return;
  if (action === 'play') startRun();
  else if (action === 'resume') resumeGame();
  else if (action === 'menu') toMenu();
  else if (action === 'settings') openSettings();
  else if (action === 'back') showScreen(app.settingsFrom);
});
$('pauseBtn').addEventListener('click', pauseGame);
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
  if (e.pointerType === 'mouse') { input.mouse = { x: e.clientX, y: e.clientY }; return; }
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
