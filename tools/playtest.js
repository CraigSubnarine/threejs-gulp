// Headless playtest for Gulp!: drives the real page in Chromium on a phone and a desktop screen, checks the main
// flows, saves screenshots to playtest-output/ and exits 1 on any failure or page error.
// Run from this game's folder: node tools/playtest.js   (needs the playwright or playwright-core package + its Chromium)
const path = require('path');
const fs = require('fs');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const { serve } = require('./server');

let url; // the game, served over http like GitHub Pages does (set when the server starts)
const out = path.resolve(__dirname, '..', 'playtest-output');
fs.mkdirSync(out, { recursive: true });
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// Installed in the page: the game stops running on its own clock, and __step(n) runs n frames of 1/60 s then draws
// one (minutes of play in seconds). Helpers put fish exactly where a check needs them.
function installHarness() {
  game.manual = true;
  window.__step = n => { for (let i = 0; i < n; i++) game.update(1 / 60); game.render(); };
  window.__P = () => game.G.player;
  window.__species = key => game.G.zone.fish.find(s => s.key === key);
  window.__put = (key, dx, dy, dir = -1) => game.spawnFish(__species(key), __P().x + dx, __P().y + dy, dir);
  // A bot that can't be eaten and always swims for the nearest fish it can eat.
  window.__bot = (expr, maxSeconds) => {
    const until = new Function(`return ${expr}`);
    for (let f = 0; f < maxSeconds * 60 && !until(); f++) {
      if (app.state !== 'playing') break;
      const P = __P();
      P.safe = 1;
      let best = null, bd = Infinity;
      for (const fish of game.G.fish) {
        const d = Math.hypot(fish.x - P.x, fish.y - P.y);
        if (fish.tier < P.tier && d < bd) { bd = d; best = fish; }
      }
      input.stick = best ? { x: (best.x - P.x) / bd, y: (best.y - P.y) / bd } : { x: 0, y: 0 };
      game.update(1 / 60);
    }
    input.stick = null;
    game.render();
    return until();
  };
}

const visible = (page, id) => page.evaluate(i => !document.getElementById(i).hidden && !document.getElementById('ui').hidden, id);
const state = page => page.evaluate(() => app.state);

async function run(browser, name, options) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim()); });
  const shot = file => page.screenshot({ path: path.join(out, `${name}-${file}.png`), timeout: 15000 })
    .catch(e => check(`${name}: screenshot ${file}`, false, e.message.split('\n')[0]));
  const tap = sel => (options.hasTouch ? page.tap(sel) : page.click(sel));
  const P = () => page.evaluate(() => { const p = __P(); return { x: p.x, y: p.y, tier: p.tier, alive: p.alive }; });

  await page.goto(url);
  await page.waitForFunction(() => !!window.game, null, { timeout: 20000 });
  await page.evaluate(installHarness);
  await page.evaluate(() => __step(120)); // let the menu fish swim in
  check(`${name}: main menu on load`, await visible(page, 'main'));
  check(`${name}: Back to Arcade link`, await page.evaluate(() => !!document.querySelector('#main a[href="../"]')));
  check(`${name}: fish swim behind the menu`, await page.evaluate(() => game.G.fish.length > 5));
  await shot('01-menu');

  // ---------- Settings ----------
  await tap('#main [data-action=settings]');
  check(`${name}: settings open`, await visible(page, 'settings'));
  await tap('label:has(#sound)');
  check(`${name}: the sound setting is saved`, await page.evaluate(() => store.get('gulp-settings', {}).sound === false));
  await tap('label:has(#sound)');
  await tap('#settings [data-action=back]');
  check(`${name}: back to the main menu`, await visible(page, 'main'));

  // ---------- A run starts ----------
  await tap('#main [data-action=play]');
  await page.evaluate(() => __step(30));
  const start = await page.evaluate(() => ({ state: app.state, hud: !document.getElementById('hud').hidden, chips: document.querySelectorAll('#chain .chip').length,
    tier: __P().tier, score: game.G.score, pause: !document.getElementById('pauseBtn').hidden, banner: document.getElementById('bannerTitle').textContent }));
  check(`${name}: Play starts a run at tier 1 with the HUD`, start.state === 'playing' && start.hud && start.chips === 5 && start.tier === 1 && start.score === 0 && start.pause, JSON.stringify(start));
  check(`${name}: the zone card names the reef`, start.banner === 'SUNNY REEF');
  const chips = await page.evaluate(() => [...document.querySelectorAll('#chain .chip')].map(c => c.className.split(' ')[1]).join());
  check(`${name}: the food chain bar shows minnows as food, bigger fish as danger`, chips === 'food,same,same,danger,danger', chips);
  await page.evaluate(() => { game.G.fish.forEach(f => (f.x += 5000)); __step(1); }); // clear the area for the steering checks
  await shot('02-start');

  // ---------- Steering ----------
  const p0 = await P();
  if (options.hasTouch) { // a real touch drag: down, then move up and to the right
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 600 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 240, y: 560 }] });
    const stickShown = await page.evaluate(() => !document.getElementById('stick').hidden);
    await page.evaluate(() => __step(40));
    const p1 = await P();
    check(`${name}: dragging the joystick swims that way (and shows the ring)`, stickShown && p1.x > p0.x + 100 && p1.y > p0.y + 40, `${Math.round(p1.x - p0.x)}, ${Math.round(p1.y - p0.y)}`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(`${name}: letting go hides the joystick`, await page.evaluate(() => document.getElementById('stick').hidden && input.stick === null));
  } else { // the mouse: the fish swims towards the pointer
    const vw = await page.evaluate(() => innerWidth);
    await page.mouse.move(vw / 2 - 300, 400);
    await page.evaluate(() => __step(40));
    const p1 = await P();
    check(`${name}: the fish swims towards the mouse`, p1.x < p0.x - 100, `${Math.round(p1.x - p0.x)}`);
    await page.evaluate(() => { input.mouse = null; });
  }
  await page.keyboard.down('ArrowDown');
  const p2 = await P();
  await page.evaluate(() => __step(30));
  const p3 = await P();
  await page.keyboard.up('ArrowDown');
  check(`${name}: arrow keys steer too`, p3.y < p2.y - 80, `${Math.round(p3.y - p2.y)}`);

  // ---------- Boost ----------
  const boostState = () => page.evaluate(() => { const p = __P(), b = document.getElementById('boostBtn');
    return { shown: !b.hidden, ready: b.classList.contains('ready'), boost: p.boost > 0, fast: Math.hypot(p.vx, p.vy) > PLAYER.speed * 1.5, charge: +p.charge.toFixed(2) }; });
  const b0 = await boostState();
  check(`${name}: the boost button shows, ready`, b0.shown && b0.ready, JSON.stringify(b0));
  await tap('#boostBtn');
  await page.evaluate(() => __step(6));
  const b1 = await boostState();
  check(`${name}: tapping boost gives a burst of speed and starts the recharge`, b1.boost && b1.fast && !b1.ready && b1.charge === 0, JSON.stringify(b1));
  await page.evaluate(() => __step(40));
  await tap('#boostBtn');
  const b2 = await boostState();
  check(`${name}: no boost while it's recharging`, !b2.boost && !b2.ready, JSON.stringify(b2));
  await page.evaluate(() => __step(60 * 1.5));
  await shot('02b-boost-recharging');
  await page.evaluate(() => __step(Math.ceil(60 * BOOST.recharge)));
  const b3 = await boostState();
  check(`${name}: the boost is ready again after the recharge`, b3.ready && b3.charge === 1, JSON.stringify(b3));
  if (!options.hasTouch) {
    await page.keyboard.press('Space');
    check(`${name}: Space boosts`, (await boostState()).boost);
  }
  await page.evaluate(() => __step(60));

  // ---------- Eating, combos, growing ----------
  const eat1 = await page.evaluate(() => {
    const g = game.G;
    g.fish.forEach(f => (f.x += 5000)); // a clean slate: the boost checks may have eaten something already
    __step(1);
    Object.assign(g, { meter: 0, score: 0, comboT: 0 });
    __P().safe = 0;
    const before = g.fish.length;
    __put('minnow', 10, 0);
    __step(1);
    return { meter: g.meter, score: g.score, gone: g.fish.length === before };
  });
  check(`${name}: eating a minnow fills the meter and scores`, eat1.meter === 1 && eat1.score === 10 && eat1.gone, JSON.stringify(eat1));
  const eat2 = await page.evaluate(() => { __put('minnow', 10, 0); __step(1); return { score: game.G.score, combo: game.G.combo }; });
  check(`${name}: a quick second bite doubles the points (combo)`, eat2.combo === 2 && eat2.score === 30, JSON.stringify(eat2));
  const bump = await page.evaluate(() => { const f = __put('butterfly', 30, 0); __step(1); return { alive: __P().alive, there: game.G.fish.includes(f) }; });
  check(`${name}: the same size just bumps`, bump.alive && bump.there, JSON.stringify(bump));
  const z1 = await page.evaluate(() => game.camera.position.z);
  const grow = await page.evaluate(() => {
    game.G.meter = METER_NEED / 3 - 1;
    __put('minnow', 10, 0);
    __step(1);
    return { tier: __P().tier, banner: document.getElementById('bannerTitle').textContent };
  });
  check(`${name}: a third of the meter grows you to tier 2`, grow.tier === 2 && grow.banner === 'GROWN!', JSON.stringify(grow));
  await page.evaluate(() => __step(150));
  const z2 = await page.evaluate(() => game.camera.position.z);
  check(`${name}: growing pulls the camera back`, z2 > z1 + 250, `${Math.round(z1)} -> ${Math.round(z2)}`);
  const chips2 = await page.evaluate(() => [...document.querySelectorAll('#chain .chip')].map(c => c.className.split(' ')[1]).join());
  check(`${name}: at tier 2 butterflyfish and puffers are food`, chips2 === 'food,food,food,same,danger', chips2);
  await page.evaluate(() => { __put('butterfly', 220, 60); __put('minnow', -180, -90); __put('minnow', -150, -60, 1); __put('parrot', 260, -200); __step(2); });
  await shot('03-tier2');

  // ---------- Hazards: the puffer, the hunter ----------
  const puff = await page.evaluate(() => {
    const f = __put('puffer', 170, 0);
    __step(30);
    return { tier: f.tier, spikes: f.obj.spikes.scale.x };
  });
  check(`${name}: a puffer swells into a danger when you get close`, puff.tier === 3 && puff.spikes > 0.8, JSON.stringify(puff));
  await page.evaluate(() => { game.G.fish.forEach(f => (f.x += 5000)); __step(1); __P().safe = 0; });
  const hunt = await page.evaluate(() => {
    const f = __put('grouper', 300, 0);
    __step(20);
    return { chase: f.chase > 0, warn: !!f.warn, closer: Math.abs(f.x - __P().x) < 300 };
  });
  check(`${name}: a grouper gives chase and flashes a warning`, hunt.chase && hunt.warn && hunt.closer, JSON.stringify(hunt));
  await shot('04-chased');

  // ---------- Pause ----------
  await tap('#pauseBtn');
  check(`${name}: the pause button opens the pause menu`, (await state(page)) === 'paused' && await visible(page, 'pause'));
  const frozen = await page.evaluate(async () => {
    const t = game.G.t;
    game.manual = false;
    await new Promise(r => setTimeout(r, 400));
    game.manual = true;
    return game.G.t === t;
  });
  check(`${name}: nothing moves while paused`, frozen);
  await tap('#pause [data-action=resume]');
  check(`${name}: Resume goes back to the game`, (await state(page)) === 'playing');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check(`${name}: switching apps pauses`, (await state(page)) === 'paused');
  await page.evaluate(() => { delete document.hidden; });
  await tap('#pause [data-action=resume]');

  // ---------- Getting eaten ----------
  const dead = await page.evaluate(() => {
    __P().safe = 0;
    __put('grouper', 15, 0);
    __step(1);
    const dying = !__P().alive;
    __step(100);
    return { dying, state: app.state, who: document.getElementById('overWho').textContent, best: store.get('gulp-best', {}).score };
  });
  check(`${name}: a bigger fish eats you and the run ends`, dead.dying && dead.state === 'over' && dead.who.includes('Grouper'), JSON.stringify(dead));
  check(`${name}: the best score is saved`, dead.best > 0, String(dead.best));
  await shot('05-over');

  // ---------- Play again, and a full zone with the bot ----------
  await tap('#over [data-action=play]');
  const again = await page.evaluate(() => ({ state: app.state, score: game.G.score, depth: game.G.depth, alive: __P().alive, tier: __P().tier }));
  check(`${name}: Play again starts fresh`, again.state === 'playing' && again.score === 0 && again.depth === 1 && again.alive && again.tier === 1, JSON.stringify(again));
  const t0 = await page.evaluate(() => game.G.t);
  const cleared = await page.evaluate(() => __bot(`game.G.phase === 'cleared'`, 300));
  const took = Math.round((await page.evaluate(() => game.G.t)) - t0);
  check(`${name}: a bot that eats everything it can clears the reef`, cleared, `${took} s of game time`);
  if (cleared) {
    await page.evaluate(() => __step(1));
    check(`${name}: the clear card shows`, (await page.evaluate(() => document.getElementById('bannerTitle').textContent)).includes('CLEARED'));
    await shot('06-cleared');
    const next = await page.evaluate(() => { __step(200); return { depth: game.G.depth, meter: game.G.meter, tier: __P().tier, score: game.G.score }; });
    check(`${name}: then the reef starts again, deeper and faster`, next.depth === 2 && next.meter === 0 && next.tier === 1 && next.score >= 1000, JSON.stringify(next));
    await shot('07-depth2');
  }

  // ---------- Back to the menu ----------
  await tap('#pauseBtn');
  await tap('#pause [data-action=menu]');
  const menu = await page.evaluate(() => ({ state: app.state, hud: document.getElementById('hud').hidden, best: document.getElementById('mainBest').textContent }));
  check(`${name}: Main menu from pause, with the best score`, menu.state === 'menu' && menu.hud && menu.best.startsWith('Best:'), JSON.stringify(menu));
  check(`${name}: no page errors`, !errors.length, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

(async () => {
  const server = await serve(path.resolve(__dirname, '..'));
  url = `${server.url}/index.html`;
  // Headless Chromium has no GPU: draw WebGL in software.
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await run(browser, 'phone', { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await run(browser, 'desktop', { viewport: { width: 1280, height: 800 } });
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
