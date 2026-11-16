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
const APEX_BONUS_L5 = 3000 * 5; // APEX.bonus × level 5, the least that beating the reef's apex should pay
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// Installed in the page: the game stops running on its own clock, and __step(n) runs n frames of 1/60 s then draws
// one (minutes of play in seconds). Helpers put fish exactly where a check needs them.
function installHarness() {
  game.manual = true;
  window.__step = n => { for (let i = 0; i < n; i++) { if (['playing', 'over', 'menu'].includes(app.state)) game.update(1 / 60); } game.render(); };
  window.__P = () => game.G.player;
  window.__species = key => game.speciesAt(key); // sized for the current level (its tier there)
  const plain = f => f.behavior !== 'puff' && f.behavior !== 'jelly';
  window.__food = () => game.G.levelFish.find(f => f.tier <= 0 && plain(f)).key; // the smallest fish on this level
  window.__big = () => game.G.levelFish.filter(plain).reduce((a, f) => (f.tier > a.tier ? f : a)).key; // its biggest
  window.__put = (key, dx, dy, dir = -1, variant = null) => game.spawnFish(__species(key), __P().x + dx, __P().y + dy, dir, variant);
  window.__clear = () => { game.G.fish.forEach(f => (f.x += 9000)); game.update(1 / 60); }; // send every fish far away (they despawn)
  // How tall the player looks on screen, as a share of the screen height.
  window.__onScreen = () => {
    const P = __P(), V = game.camera.position.constructor, a = new V(P.x, P.y - P.len / 2, 0).project(game.camera), b = new V(P.x, P.y + P.len / 2, 0).project(game.camera);
    return Math.abs(b.y - a.y) / 2;
  };
  // Chips on the food chain bar must match: green below your tier, red above, grey at it.
  window.__chipsOk = () => [...document.querySelectorAll('#chain .chip[data-tier]')].every(c => {
    const t = Number(c.dataset.tier), p = __P().tier;
    return c.classList.contains(p > t ? 'food' : p < t ? 'danger' : 'same');
  });
  // A bot that can't be eaten and always swims for the nearest fish it can eat.
  window.__bot = (expr, maxSeconds) => {
    const until = new Function(`return ${expr}`), skip = new Map(); // fish it gave up on (blocked by a rock) -> until when
    let last = null, stuckT = 0;
    for (let f = 0; f < maxSeconds * 60 && !until(); f++) {
      if (app.state !== 'playing') break;
      const P = __P();
      P.safe = 1;
      let best = null, bd = Infinity;
      for (const fish of game.G.fish) {
        const d = Math.hypot(fish.x - P.x, fish.y - P.y);
        if (fish.tier < P.tier && fish.s.behavior !== 'jelly' && !(skip.get(fish) > f) && d < bd) { bd = d; best = fish; }
      }
      if (last && Math.hypot(P.x - last.x, P.y - last.y) < 2) { if (++stuckT > 45 && best) { skip.set(best, f + 240); stuckT = 0; } } else stuckT = 0; // not getting anywhere: try another fish
      last = { x: P.x, y: P.y };
      input.stick = best ? { x: (best.x - P.x) / bd, y: (best.y - P.y) / bd } : { x: 0, y: 0 };
      game.update(1 / 60);
    }
    input.stick = null;
    game.render();
    return until();
  };
  // Fill the meter and play through the clear card and the camera widening, up to the skill tree.
  window.__clearLevel = () => {
    for (let i = 0; i < 120 && game.G.phase !== 'swim'; i++) game.update(1 / 60); // you can't eat while a level fades in
    __P().safe = 9;
    game.G.meter = METER_NEED - 0.2; // any bite fills it
    __put(__food(), 5, 0);
    for (let i = 0; i < 600 && app.state === 'playing'; i++) game.update(1 / 60);
    game.render();
    return app.state;
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
  const shot = file => page.screenshot({ path: path.join(out, `${name}-${file}.png`), timeout: 45000 }) // software WebGL can be slow
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
  const picker = await page.evaluate(() => ({ n: document.querySelectorAll('#classes .cls').length, locked: document.querySelectorAll('#classes .locked').length, sel: document.querySelector('#classes .sel')?.dataset.cls }));
  check(`${name}: the picker shows 4 starters, 3 locked, the Shark picked`, picker.n === 4 && picker.locked === 3 && picker.sel === 'shark', JSON.stringify(picker));
  await tap('[data-cls=barracuda]');
  check(`${name}: a locked fish says how to unlock it`, (await page.evaluate(() => document.getElementById('classInfo').textContent)).includes('Reach level 3'));
  await shot('01-menu');

  // ---------- Settings ----------
  await tap('#main [data-action=settings]');
  check(`${name}: settings open`, await visible(page, 'settings'));
  await tap('label:has(#sound)');
  check(`${name}: the sound setting is saved`, await page.evaluate(() => store.get('gulp-settings', {}).sound === false));
  await page.selectOption('#zoom', 'far');
  check(`${name}: the Zoom setting is saved`, await page.evaluate(() => store.get('gulp-settings', {}).zoom === 'far'));
  await page.selectOption('#zoom', 'normal');
  await tap('label:has(#sound)');
  await tap('#settings [data-action=back]');
  check(`${name}: back to the main menu`, await visible(page, 'main'));

  // ---------- A run starts ----------
  await tap('#main [data-action=play]');
  await page.evaluate(() => __step(30));
  const start = await page.evaluate(() => ({ state: app.state, hud: !document.getElementById('hud').hidden, chips: document.querySelectorAll('#chain .chip').length,
    tier: __P().tier, score: game.G.score, level: game.G.level, title: document.getElementById('bannerTitle').textContent, sub: document.getElementById('bannerSub').textContent }));
  check(`${name}: Play starts level 1 at tier 1 with the HUD (one chip per size)`, start.state === 'playing' && start.hud && start.chips === 4 && start.tier === 1 && start.score === 0 && start.level === 1, JSON.stringify(start));
  check(`${name}: the level card names the zone and the spot, and says this level's shard is hidden here`, start.title === 'SUNNY REEF' && start.sub.includes('Coral Garden') && start.sub.includes('Shard 1 of 5'), start.sub);
  check(`${name}: the food chain bar is green below you, red above`, await page.evaluate(() => __chipsOk()));
  // Nothing can eat you during the checks that aren't about being eaten (they sit still for seconds at a time).
  await page.evaluate(() => { __clear(); __P().safe = 1e6; });
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
  await page.evaluate(() => { input.mouse = null; __step(6); }); // a desktop click leaves the mouse on the button, and the fish would follow it
  const b1 = await boostState();
  check(`${name}: tapping boost gives a burst of speed and starts the recharge`, b1.boost && b1.fast && !b1.ready && b1.charge === 0, JSON.stringify(b1));
  await page.evaluate(() => __step(40));
  await tap('#boostBtn');
  await page.evaluate(() => { input.mouse = null; });
  const b2 = await boostState();
  check(`${name}: no boost while it's recharging`, !b2.boost && !b2.ready, JSON.stringify(b2));
  await page.evaluate(() => __step(Math.ceil(60 * BOOST.recharge)));
  check(`${name}: the boost is ready again after the recharge`, (await boostState()).ready);
  if (!options.hasTouch) {
    await page.keyboard.press('Space');
    check(`${name}: Space boosts`, (await boostState()).boost);
  }
  await page.evaluate(() => __step(60));

  // ---------- The wide sea, rocks, and the surface ----------
  const edges = await page.evaluate(() => {
    input.mouse = null; // clicking the boost button left the mouse over it, and the fish would follow it
    const P = __P(), out = {};
    for (const [key, side] of [['arrowright', 'right'], ['arrowleft', 'left']]) {
      Object.assign(P, { x: 0, y: 1000, vx: 0, vy: 0 }); // up in open water, above the rocks
      input.keys.add(key);
      for (let i = 0; i < 60 * 25; i++) game.update(1 / 60);
      input.keys.delete(key);
      out[side] = Math.round(P.x);
    }
    return out;
  });
  check(`${name}: the sea is wide: you can swim to x ≈ ±6500`, edges.right > 6400 && edges.left < -6400, JSON.stringify(edges));
  // A rock with open water to its left, at its own height: something swimming right runs into it.
  const findRock = () => page.evaluate(() => {
    const cs = game.G.circles, free = (x, y, r) => cs.every(c => Math.hypot(x - c.x, y - c.y) > c.r + r);
    const c = cs.find(c => c.x > 1000 && c.r > 90 && free(c.x - c.r - 70, c.y, 40) && free(c.x - c.r - 300, c.y, 60));
    return c && { x: c.x, y: c.y, r: c.r };
  });
  const rock = await findRock();
  check(`${name}: the level has rocks on the play plane`, !!rock && (await page.evaluate(() => game.G.circles.length)) >= 20, JSON.stringify(rock));
  if (rock) {
    const block = await page.evaluate(c => {
      const P = __P(), pr = P.len * SHAPE_R[game.G.cls.spec.shape];
      __clear();
      Object.assign(P, { x: c.x - c.r - pr - 120, y: c.y, vx: 0, vy: 0 });
      input.keys.add('arrowright');
      let closest = Infinity;
      for (let i = 0; i < 90; i++) { game.update(1 / 60); closest = Math.min(closest, Math.hypot(P.x - c.x, P.y - c.y) - c.r - pr); }
      input.keys.delete('arrowright');
      return { closest: +closest.toFixed(1), left: P.x < c.x };
    }, rock);
    check(`${name}: you can't swim through a rock`, block.closest > -1 && block.left, JSON.stringify(block));
    const trap = await page.evaluate(c => {
      const P = __P();
      __clear();
      Object.assign(P, { x: c.x - c.r - 260, y: c.y, vx: 0, vy: 0 });
      const f = __put('goby', 170, 0, 1); // a skittish fish between you and the rock: it flees straight into it
      for (let i = 0; i < 60; i++) game.update(1 / 60);
      const pinned = { gap: +(Math.hypot(f.x - c.x, f.y - c.y) - c.r).toFixed(0), left: f.x < c.x, speed: Math.round(Math.hypot(f.vx, f.vy)) };
      for (let i = 0; i < 90 && game.G.fish.includes(f); i++) { // swim at it, like a player would
        const dx = f.x - P.x, dy = f.y - P.y, m = Math.hypot(dx, dy) || 1;
        input.stick = { x: dx / m, y: dy / m };
        game.update(1 / 60);
      }
      input.stick = null;
      return { ...pinned, eaten: !game.G.fish.includes(f) };
    }, rock);
    check(`${name}: a fleeing fish gets cornered against a rock, and you catch it there`, trap.left && trap.gap < 60 && trap.eaten, JSON.stringify(trap));
    await page.evaluate(c => { const P = __P(); Object.assign(P, { x: c.x - c.r - 500, y: c.y + 200 }); __put('goby', 200, 40, 1); __put('parrot', -250, -120, 1); __step(120); }, rock);
    await shot('02b-rocks');
    const unstick = await page.evaluate(c => {
      const P = __P();
      __clear();
      Object.assign(P, { x: c.x - 1500, y: c.y + 900, vx: 0, vy: 0 });
      for (let i = 0; i < 90; i++) game.update(1 / 60);
      const f = __put('snapper', 1500 - c.r - 90, -900, 1); // a calm fish swimming straight at the rock
      let touching = 0, worst = 0;
      for (let i = 0; i < 180; i++) {
        game.update(1 / 60);
        touching = Math.hypot(f.x - c.x, f.y - c.y) < c.r + f.len * 0.4 ? touching + 1 : 0;
        worst = Math.max(worst, touching);
      }
      return { worst, gone: !game.G.fish.includes(f), away: Math.round(Math.hypot(f.x - c.x, f.y - c.y) - c.r - f.len * 0.4) };
    }, rock);
    check(`${name}: a calm fish that hits a rock goes round or turns back, instead of grinding on it`, unstick.worst < 90 && (unstick.gone || unstick.away > 0), JSON.stringify(unstick));
  }
  const smash = await page.evaluate(() => {
    const g = game.G, P = __P(), c = g.circles.find(k => k.crack !== undefined), s = Math.sign(c?.x) || 1; // come at it from the start's side
    if (!c) return { none: true, circles: g.circles.length, smashed: g.scenery.group.children.filter(m => m.isMesh && !m.visible).length, seed: g.seed, wreck: Math.round(g.wreck.x) };
    const id = c.crack, n0 = g.circles.filter(k => k.crack === id).length;
    Object.assign(P, { x: c.x - s * 700, y: c.y, vx: 0, vy: 0 });
    for (let i = 0; i < 90; i++) game.update(1 / 60);
    __clear();
    const key = s > 0 ? 'arrowright' : 'arrowleft';
    Object.assign(P, { x: c.x - s * (c.r + 150), y: c.y, vx: 0, vy: 0, charge: 1, face: s });
    input.keys.add(key);
    game.boost();
    const why = { boost: +P.boost.toFixed(2), stun: +P.stun.toFixed(2), phase: g.phase, x0: Math.round((P.x - c.x) * s) };
    for (let i = 0; i < 40; i++) game.update(1 / 60);
    input.keys.delete(key);
    why.x1 = Math.round((P.x - c.x) * s);
    game.render();
    return { n0, left: g.circles.filter(k => k.crack === id).length, hidden: !c.mesh.visible, past: (P.x - (c.x - s * c.r)) * s > 0, why };
  });
  check(`${name}: boosting into an arch's cracked door smashes it, and you go straight through (a shortcut under the arch)`, smash.n0 > 0 && smash.left === 0 && smash.hidden && smash.past, JSON.stringify(smash));
  await shot('02f-smash');
  await page.evaluate(() => { const P = __P(); __clear(); Object.assign(P, { x: 300, y: WORLD.y - 60, vx: 0, vy: 0 }); __step(150); });
  const surface = await page.evaluate(() => { const v = game.camera.position; return { camY: Math.round(v.y) }; });
  await shot('02c-surface');
  check(`${name}: the camera stops with the surface at the top of the screen`, true, JSON.stringify(surface));
  await page.evaluate(() => { const P = __P(); Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0 }); __clear(); __step(90); });

  // ---------- Oysters and pearls ----------
  const oy = await page.evaluate(() => {
    const g = game.G, P = __P(), o = g.oysters[0], size = OYSTER.size;
    __clear();
    const n = g.oysters.length, onFloor = g.oysters.every(o => o.y < -WORLD.y + 50);
    Object.assign(o, { t: OYSTER.closed + 0.2, has: true, black: false, mode: 'open' }); // just opened
    Object.assign(P, { x: o.x, y: o.y + size * 0.25, vx: 0, vy: 0 });
    const s0 = g.score, p0 = g.pearls, pts0 = g.points;
    g.pearls = PEARLS_PER_POINT - 1; // one more makes a skill point
    game.update(1 / 60);
    const took = { pearls: g.pearls, score: g.score - s0, points: g.points - pts0, has: o.has };
    g.pearls = p0 + 1;
    g.points = pts0;
    return { n, onFloor, ...took, want: OYSTER.white * g.level };
  });
  check(`${name}: oysters sit on the sea floor`, oy.n === 2 && oy.onFloor, JSON.stringify(oy));
  check(`${name}: grabbing a pearl from an open oyster scores, and every 5 pearls give a skill point`, oy.score === oy.want && oy.points === 1 && !oy.has, JSON.stringify(oy));
  const snap = await page.evaluate(() => {
    const g = game.G, P = __P(), o = g.oysters[1], size = OYSTER.size, snap0 = OYSTER.closed + OYSTER.open + OYSTER.tell;
    __clear();
    const caught = () => { Object.assign(o, { t: snap0 - 0.01, mode: 'tell' }); Object.assign(P, { x: o.x, y: o.y + size * 0.2, vx: 0, vy: 0, safe: 0 }); game.update(1 / 60); game.update(1 / 60); };
    P.shields = 1;
    caught(); // small: it would eat you, but a shield spits you out
    const small = { alive: P.alive, shields: P.shields };
    P.safe = 0; P.tier = 3;
    caught(); // big: just a pinch
    const big = { alive: P.alive, stun: P.stun > 0 };
    Object.assign(P, { tier: 1, safe: 1e6, stun: 0, shields: 0 });
    return { small, big };
  });
  check(`${name}: an oyster's snap catches a small fish (a shield saves it)`, snap.small.alive && snap.small.shields === 0, JSON.stringify(snap));
  check(`${name}: a bigger fish just gets pinched`, snap.big.alive && snap.big.stun, JSON.stringify(snap));
  await page.evaluate(() => {
    const g = game.G, P = __P(), o = g.oysters[0];
    __clear();
    Object.assign(o, { t: OYSTER.closed + 1, has: true, black: true, mode: 'open' });
    o.obj.setBlack(true);
    Object.assign(P, { x: o.x - 330, y: o.y + 260, vx: 0, vy: 0 });
    __step(120); // the camera catches up
    game.spawnPickup('shock', o.x + 180, o.y + 480);
    __step(30);
  });
  await shot('02d-oyster');

  // ---------- Power-ups ----------
  const take = kind => page.evaluate(k => { const P = __P(); game.spawnPickup(k, P.x + 10, P.y); game.update(1 / 60); return { gone: !game.G.pickup, power: P.power?.kind ?? null }; }, kind);
  await page.evaluate(() => { const P = __P(); Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0, safe: 1e6 }); __step(90); __clear(); }); // let the camera catch up, or new fish count as off screen
  const shock = await page.evaluate(async () => {
    const P = __P(), f = __put('grouper', 320, 0);
    P.safe = 0;
    __step(10);
    const chasing = f.chase > 0;
    return { chasing, f: true };
  });
  const shockTake = await take('shock');
  const shockAfter = await page.evaluate(() => { const f = game.G.fish.find(f => f.s.key === 'grouper'); __step(30); const r = { stun: f.stun > 0, chase: f.chase, alive: __P().alive }; __P().safe = 1e6; return r; });
  check(`${name}: Shock makes a chasing hunter go limp`, shock.chasing && shockTake.gone && shockTake.power === 'shock' && shockAfter.stun && shockAfter.chase === 0 && shockAfter.alive, JSON.stringify({ shock, shockTake, shockAfter }));
  const shrink = await page.evaluate(() => {
    __clear();
    const P = __P(), f = __put('parrot', 260, 0), before = canEat(P, f);
    game.spawnPickup('shrink', P.x + 10, P.y);
    game.update(1 / 60);
    __step(2);
    return { before, tier: f.tier, food: canEat(P, f), f: game.G.fish.includes(f) };
  });
  check(`${name}: Shrink turns a fish one size bigger into food`, !shrink.before && shrink.food && shrink.tier === 0, JSON.stringify(shrink));
  const rush = await page.evaluate(() => {
    __clear();
    const P = __P();
    game.spawnPickup('rush', P.x + 10, P.y);
    game.update(1 / 60);
    input.keys.add('arrowright');
    let top = 0;
    for (let i = 0; i < 60; i++) { game.update(1 / 60); top = Math.max(top, Math.hypot(P.vx, P.vy)); }
    input.keys.delete('arrowright');
    return { power: P.power?.kind, top: Math.round(top), base: Math.round(PLAYER.speed * game.G.stats.speed), hud: document.getElementById('perks').textContent };
  });
  check(`${name}: Rush makes you swim faster (and shows on the HUD)`, rush.power === 'rush' && rush.top > rush.base * 1.35 && rush.hud.includes('RUSH'), JSON.stringify(rush));
  const shield = await page.evaluate(() => { const P = __P(); P.power = null; const s0 = P.shields; game.spawnPickup('shield', P.x + 10, P.y); game.update(1 / 60); const r = P.shields - s0; P.shields = 0; return r; });
  check(`${name}: Bubble Shield gives you a save`, shield === 1, String(shield));
  const drift = await page.evaluate(() => {
    const g = game.G, P = __P(), out = {};
    P.x = 0; P.y = 0;
    g.pickT = 0.01;
    game.update(1 / 60);
    const p = g.pickup, y0 = p?.y;
    for (let i = 0; i < 120; i++) game.update(1 / 60);
    out.came = !!p; out.falls = p && g.pickup === p && p.y < y0 - 100;
    for (let i = 0; i < 60 * PICKUPS.life; i++) game.update(1 / 60);
    out.pops = g.pickup !== p;
    return out;
  });
  check(`${name}: a power-up bubble drifts down now and then, and pops if you leave it`, drift.came && drift.falls && drift.pops, JSON.stringify(drift));
  await page.evaluate(() => { const P = __P(); Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0, power: null }); game.G.pickT = 999; __clear(); __step(30); });

  // ---------- The wreck and its shard ----------
  const wreck = await page.evaluate(() => {
    const g = game.G, P = __P(), sh = g.shard;
    if (!sh) return { shard: false };
    const far = Math.abs(sh.x) > WORLD.x * 0.35;
    Object.assign(P, { x: sh.x - 260, y: sh.y + 260, vx: 0, vy: 0 });
    __step(120); // the camera catches up
    const glint = sh.glint.visible || (__step(10), sh.glint.visible);
    return { shard: true, far, glint, x: Math.round(sh.x) };
  });
  check(`${name}: each level hides a shard in a wreck far out in the sea`, wreck.shard && wreck.far, JSON.stringify(wreck));
  await shot('02e-wreck');
  const shard1 = await page.evaluate(() => {
    const g = game.G, P = __P(), sh = g.shard;
    Object.assign(P, { x: sh.x, y: sh.y, vx: 0, vy: 0 });
    game.update(1 / 60);
    return { shards: g.shards.size, gone: !g.shard, title: document.getElementById('bannerTitle').textContent, hud: document.getElementById('pearls').textContent };
  });
  check(`${name}: touching the shard takes it (1/5, on the HUD too)`, shard1.shards === 1 && shard1.gone && shard1.title === 'SHARD 1/5' && shard1.hud.includes('\u25C6\u25C7'), JSON.stringify(shard1));
  await page.evaluate(() => { const P = __P(); Object.assign(P, { x: 0, y: 0, vx: 0, vy: 0 }); __step(120); __clear(); });

  // ---------- Eating, combos, growing ----------
  const eat1 = await page.evaluate(() => {
    const g = game.G;
    __clear();
    Object.assign(g, { meter: 0, score: 0, comboT: 0 });
    const before = g.fish.length;
    __put('minnow', 10, 0);
    __step(1);
    return { meter: g.meter, want: GROW[0], score: g.score, gone: g.fish.length === before };
  });
  check(`${name}: eating a minnow fills the meter and scores`, eat1.meter === eat1.want && eat1.score === 10 && eat1.gone, JSON.stringify(eat1));
  const eat2 = await page.evaluate(() => { __put('minnow', 10, 0); __step(1); return { score: game.G.score, combo: game.G.combo }; });
  check(`${name}: a quick second bite doubles the points (combo)`, eat2.combo === 2 && eat2.score === 30, JSON.stringify(eat2));
  const bump = await page.evaluate(() => { const f = __put('butterfly', 30, 0); __step(1); return { alive: __P().alive, there: game.G.fish.includes(f) }; });
  check(`${name}: the same size just bumps`, bump.alive && bump.there, JSON.stringify(bump));
  const z1 = await page.evaluate(() => game.camera.position.z);
  const grow = await page.evaluate(() => {
    __clear();
    game.G.meter = METER_NEED / 3 - 1;
    __put('minnow', 10, 0);
    __step(1);
    return { tier: __P().tier, banner: document.getElementById('bannerTitle').textContent };
  });
  check(`${name}: a third of the meter grows you to tier 2`, grow.tier === 2 && grow.banner === 'GROWN!', JSON.stringify(grow));
  await page.evaluate(() => __step(150));
  const z2 = await page.evaluate(() => game.camera.position.z);
  check(`${name}: growing pulls the camera back`, z2 > z1 + 250, `${Math.round(z1)} -> ${Math.round(z2)}`);
  check(`${name}: the food chain bar follows your size`, await page.evaluate(() => __chipsOk()));
  const zoomed = await page.evaluate(() => {
    const dist = () => game.cam.dist, z0 = dist();
    settings.zoom = 'far'; __step(200);
    const far = dist();
    settings.zoom = 'close'; __step(200);
    const close = dist();
    settings.zoom = 'normal'; __step(200);
    return { normal: Math.round(z0), far: Math.round(far), close: Math.round(close) };
  });
  check(`${name}: Zoom Far shows more of the sea, Close shows less`, zoomed.far > zoomed.normal * 1.12 && zoomed.close < zoomed.normal * 0.9, JSON.stringify(zoomed));

  // ---------- Rare variants ----------
  const variants = await page.evaluate(() => {
    const g = game.G, P = __P();
    __clear();
    g.comboT = 0;
    let s0 = g.score;
    __put('minnow', 10, 0, -1, 'golden');
    __step(1);
    const golden = g.score - s0;
    __step(120);
    const giant = __put('minnow', 400, 0, -1, 'giant');
    const m0 = g.meter;
    __put('butterfly', 10, 0, -1, 'spiny');
    __step(1);
    const spiny = { growth: g.meter - m0, stun: P.stun > 0 };
    const fast = __put('damsel', -600, 300, 1, 'speedy');
    __step(20);
    return { golden, giantTier: giant.tier, giantLen: giant.len, spiny, speedy: Math.abs(fast.vx) > fast.s.speed * 1.4 };
  });
  check(`${name}: a golden fish is worth ×5`, variants.golden === 50, String(variants.golden));
  check(`${name}: a giant fish is one size bigger`, variants.giantTier === 1 && variants.giantLen === 70, JSON.stringify(variants));
  check(`${name}: a spiny fish stings but gives ×2 growth`, variants.spiny.stun && variants.spiny.growth === 6, JSON.stringify(variants.spiny));
  check(`${name}: a speedy fish is fast`, variants.speedy);
  await page.evaluate(() => { __put('minnow', 200, 80, -1, 'golden'); __put('minnow', -180, -90, 1, 'speedy'); __put('butterfly', -220, 120, 1, 'spiny'); __put('parrot', 260, -200); __step(3); });
  await shot('03-variants');

  // ---------- Hazards: the puffer, the hunter ----------
  const puff = await page.evaluate(() => {
    __clear();
    game.G.meter = METER_NEED / 3 + 1; // still tier 2, but far from clearing the level (eating passing fish could fill it, and a cleared level keeps you safe)
    const f = __put('puffer', 170, 0);
    __step(30);
    return { tier: f.tier, spikes: f.obj.spikes.scale.x };
  });
  check(`${name}: a puffer swells into a danger when you get close`, puff.tier === 3 && puff.spikes > 0.8, JSON.stringify(puff));
  await page.evaluate(() => { __clear(); __P().safe = 0; });
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
    Object.assign(__P(), { safe: 0, shields: 0, power: null }); // a drifting Bubble Shield may have been picked up earlier
    __put('grouper', 15, 0);
    __step(1);
    const dying = !__P().alive;
    __step(100);
    const P = __P(), g = game.G;
    return { dying, state: app.state, who: document.getElementById('overWho').textContent, best: store.get('gulp-best', {}).score, why: { phase: g.phase, safe: P.safe, tier: P.tier, shields: P.shields, wind: g.stats.secondWind - g.windUsed, x: Math.round(P.x), y: Math.round(P.y), near: g.fish.filter(f => Math.hypot(f.x - P.x, f.y - P.y) < 300).map(f => `${f.s.key}:${f.tier}`) } };
  });
  check(`${name}: a bigger fish eats you and the run ends`, dead.dying && dead.state === 'over' && dead.who.includes('Grouper'), JSON.stringify(dead));
  check(`${name}: the best score is saved`, dead.best > 0, String(dead.best));
  await shot('05-over');

  // ---------- A full level, the skill tree, and keeping your size ----------
  await tap('#over [data-action=play]');
  const again = await page.evaluate(() => ({ state: app.state, score: game.G.score, level: game.G.level, alive: __P().alive, tier: __P().tier, owned: game.G.owned.length }));
  check(`${name}: Play again starts fresh`, again.state === 'playing' && again.score === 0 && again.level === 1 && again.alive && again.tier === 1 && again.owned === 0, JSON.stringify(again));
  await page.evaluate(() => game.G.oysters.forEach(o => { o.has = false; o.regrow = 1e9; })); // no pearls: they'd add bonus skill points to the tree checks
  const t0 = await page.evaluate(() => game.G.t);
  const cleared = await page.evaluate(() => __bot(`game.G.phase === 'cleared'`, 300));
  check(`${name}: a bot that eats everything it can clears level 1`, cleared, `${Math.round((await page.evaluate(() => game.G.t)) - t0)} s of game time`);
  await page.evaluate(() => __step(1));
  check(`${name}: the clear card shows`, (await page.evaluate(() => document.getElementById('bannerTitle').textContent)) === 'LEVEL CLEAR!');
  const len0 = await page.evaluate(() => __P().len);
  const widest = await page.evaluate(() => { let most = 0; for (let i = 0; i < 400 && app.state === 'playing'; i++) { __step(1); most = Math.max(most, game.cam.dist); } return { most: Math.round(most), limit: Math.round(VIEW_H[3] * CAMERA.widen / 2 / Math.tan(22.5 * Math.PI / 180) * 1.02) }; });
  check(`${name}: between levels the camera only pulls back a little`, widest.most <= widest.limit, JSON.stringify(widest));
  const widened = await page.evaluate(() => ({ state: app.state, len: __P().len, screen: __onScreen() }));
  check(`${name}: you keep your size while the view widens, then the skill tree opens`, widened.state === 'tree' && Math.abs(widened.len - len0) < 1 && (await visible(page, 'tree')), JSON.stringify({ ...widened, len0 }));
  await shot('06-tree');
  const tree = await page.evaluate(() => ({ points: game.G.points, open: document.querySelectorAll('.hex.open').length, owned: document.querySelectorAll('.hex.owned').length, text: document.getElementById('treePoints').textContent }));
  if (options.hasTouch) await tap('[data-tab=fins]'); // a phone shows one branch at a time
  check(`${name}: the tree offers the top node of each branch for 1 point`, tree.points === 1 && tree.open === 3 && tree.owned === 0 && tree.text.startsWith('1 skill point'), JSON.stringify(tree));
  await tap('[data-node=quickCharge]');
  check(`${name}: a later node says what it needs first`, await page.evaluate(() => document.getElementById('treeDetail').textContent.includes('Learn Fast Fins first') && document.getElementById('learnBtn').disabled));
  const fit = await page.evaluate(() => {
    const hexes = [...document.querySelectorAll('#treeGrid .hex')].filter(h => h.getClientRects().length);
    const mid = r => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const centred = hexes.length > 0 && hexes.every(h => { const [ax, ay] = mid(h.getBoundingClientRect()), [bx, by] = mid(h.querySelector('svg').getBoundingClientRect()); return Math.abs(ax - bx) < 2 && Math.abs(ay - by) < 2; });
    return { centred, height: document.getElementById('tree').scrollHeight };
  });
  check(`${name}: skill icons sit in the middle of their hexagons`, fit.centred, JSON.stringify(fit));
  if (options.hasTouch) check(`${name}: on a phone the whole tree and a tapped skill's description fit without scrolling`, fit.height <= 760, JSON.stringify(fit));
  await tap('[data-node=fastFins]');
  await tap('#learnBtn');
  const learned = await page.evaluate(() => ({ owned: game.G.owned, points: game.G.points, speed: game.G.stats.speed, cls: document.querySelector('[data-node=fastFins]').className }));
  check(`${name}: learning Fast Fins spends the point and speeds you up`, learned.owned.includes('fastFins') && learned.points === 0 && Math.abs(learned.speed - 1.12) < 1e-9 && learned.cls.includes('owned'), JSON.stringify(learned));
  await tap('[data-node=quickCharge]');
  check(`${name}: with no points left, the next node can't be learned`, await page.evaluate(() => document.getElementById('learnBtn').disabled && document.getElementById('treeDetail').textContent.includes('Needs 1 point')));
  await shot('06b-tree-learned');
  await tap('#treeNext');
  const after = await page.evaluate(() => { for (let i = 0; i < 60 && game.G.phase !== 'fadein'; i++) __step(1); return { phase: game.G.phase, level: game.G.level, tier: __P().tier, len: __P().len, meter: game.G.meter, screen: __onScreen(), spot: game.G.spot.name, landmark: game.G.spot.landmark, sub: document.getElementById('bannerSub').textContent }; });
  check(`${name}: Next level fades into level 2 at tier 1 with an empty meter`, after.phase === 'fadein' && after.level === 2 && after.tier === 1 && after.meter === 0, JSON.stringify(after));
  check(`${name}: on screen you're the same size across the cut`, Math.abs(after.screen / widened.screen - 1) < 0.08, `${widened.screen.toFixed(4)} -> ${after.screen.toFixed(4)}`);
  check(`${name}: level 2 is a different spot (Sandy Shallows, its own landmark)`, after.spot === 'Sandy Shallows' && after.landmark === 'grass' && after.sub.includes('2/5'), JSON.stringify(after));
  await page.evaluate(() => __step(90));
  check(`${name}: and the new level's fish are bigger than you`, await page.evaluate(() => __chipsOk() && __P().tier === 1 && game.G.levelFish.filter(f => f.tier > 1).length >= 4));
  const ladder = await page.evaluate(() => {
    const on = key => game.G.levelFish.find(f => f.key === key);
    const P = __P(), parrot = on('parrot'), trigger = on('trigger'), angel = on('angel');
    return { parrot: parrot?.tier, trigger: trigger?.tier, angel: angel?.tier, minnow: !!on('minnow'), eatParrot: !!parrot && canEat(P, parrot), eatAngel: !!angel && canEat(P, angel) };
  });
  check(`${name}: you keep your size: the parrotfish and triggerfish you ate at the end of level 1 are still food`, ladder.parrot === 0 && ladder.trigger === 0 && ladder.eatParrot, JSON.stringify(ladder));
  check(`${name}: new bigger fish (angelfish) join that you can't eat yet, and the tiniest (minnows) are gone`, ladder.angel === 2 && !ladder.eatAngel && !ladder.minnow, JSON.stringify(ladder));
  await shot('07-level2');

  // ---------- Every reef level looks different; after level 5 the reef starts over, harder ----------
  for (const lv of [3, 4, 5]) {
    const st = await page.evaluate(() => __clearLevel());
    if (st !== 'tree') { check(`${name}: clearing level ${lv - 1} opens the tree`, false, st); break; }
    await tap('#treeNext');
    const info = await page.evaluate(() => { for (let i = 0; i < 60 && game.G.phase !== 'fadein'; i++) __step(1); __step(60); return { level: game.G.level, spot: game.G.spot.name }; });
    check(`${name}: level ${lv} is ${info.spot}`, info.level === lv, JSON.stringify(info));
    await page.evaluate(() => __step(30));
    await shot(`08-level${lv}`);
  }
  // ---------- The apex: the Giant Moray, in level 5's wreck ----------
  const arrive = await page.evaluate(() => {
    for (let i = 0; i < 120 && game.G.phase !== 'swim'; i++) game.update(1 / 60);
    __P().safe = 1e6;
    game.G.meter = METER_NEED - 0.2;
    __put(__food(), 5, 0);
    __step(1);
    __P().safe = 1e6; // the apex's arrival gives you 1.5 s; the test player stays safe while it fights
    const A = game.G.apex;
    return { phase: game.G.phase, mode: A?.mode, bar: !document.getElementById('boss').hidden, name: document.getElementById('bossName').textContent, hp: A?.hp, title: document.getElementById('bannerTitle').textContent, arrow: !document.getElementById('shardArrow').hidden };
  });
  check(`${name}: filling level 5's meter wakes the Giant Moray in its rock: a health bar, and an arrow to its lair`, arrive.phase === 'apex' && arrive.mode === 'lurk' && arrive.bar && arrive.name === 'The Giant Moray' && arrive.hp === 6 && arrive.title === 'THE GIANT MORAY' && arrive.arrow, JSON.stringify(arrive));
  const lair = await page.evaluate(() => {
    const g = game.G, P = __P();
    Object.assign(P, { x: g.lair.x + 250, y: g.lair.y + 750, vx: 0, vy: 0 });
    __step(120);
    return { mode: g.apex.mode, taunt: !!document.querySelector('.pop.taunt'), apart: Math.round(Math.abs(g.lair.x - g.wreck.x)), segs: g.apex.obj.segs?.length };
  });
  check(`${name}: swimming to its rock brings it out, with a taunt`, lair.mode !== 'lurk' && lair.taunt, JSON.stringify(lair));
  check(`${name}: the Moray lives in its own holed rock, far from the wreck (the shard stays easy to reach)`, lair.apart > 2500, JSON.stringify(lair));
  check(`${name}: the Moray is a long serpent made of segments`, lair.segs >= 16, JSON.stringify(lair));
  await shot('10-apex');
  // Let it fight for a while (you can't be eaten here): a hole shakes with a "!", it strikes out, stays out, pulls back in.
  const cycle = await page.evaluate(() => {
    const A = game.G.apex, seen = new Set();
    let warned = false;
    for (let i = 0; i < 60 * 12; i++) {
      game.update(1 / 60);
      seen.add(A.mode);
      if (A.mode === 'tell') warned ||= A.warn.visible;
      if (A.mode === 'tell' && A.t < 0.3) break; // stop mid-shake for the screenshot
    }
    game.render();
    return { seen: [...seen], warned, mode: A.mode, hidden: !A.obj.root.visible };
  });
  check(`${name}: it hides, then a hole shakes with a red "!" before it strikes`, cycle.mode === 'tell' && cycle.warned && cycle.hidden, JSON.stringify(cycle));
  await shot('11-apex-tell');
  const lunge = await page.evaluate(() => {
    const A = game.G.apex, seen = new Set();
    let fast = 0;
    for (let i = 0; i < 60 * 12 && !seen.has('exposed'); i++) { game.update(1 / 60); seen.add(A.mode); if (A.mode === 'lunge') fast = Math.max(fast, Math.hypot(A.vx, A.vy)); }
    game.render();
    return { seen: [...seen], fast: +(fast / PLAYER.speed).toFixed(2), shown: A.obj.root.visible };
  });
  check(`${name}: it strikes out at more than twice your speed and stays stretched out`, lunge.seen.includes('lunge') && lunge.seen.includes('exposed') && lunge.fast > 2 && lunge.shown, JSON.stringify(lunge));
  await shot('11b-apex-out');
  const back = await page.evaluate(() => {
    const A = game.G.apex, seen = new Set();
    for (let i = 0; i < 60 * 6 && !seen.has('hide'); i++) { game.update(1 / 60); seen.add(A.mode); }
    return { seen: [...seen], hidden: !A.obj.root.visible };
  });
  check(`${name}: then it pulls back into the wreck`, back.seen.includes('retract') && back.seen.includes('hide') && back.hidden, JSON.stringify(back));
  await page.evaluate(() => { game.G.circles = []; });
  // Hold it stretched out at the middle, facing right: its tail end is on the left, its jaws on the right.
  const hold = () => page.evaluate(() => { const A = game.G.apex; Object.assign(A, { mode: 'exposed', t: 9, x: 0, y: 0, hx: 1, hy: 0, face: 1, inv: 0, left: 0 }); Object.assign(__P(), { vx: 0, vy: 0, boost: 0 }); });
  await hold();
  const bite1 = await page.evaluate(() => { const A = game.G.apex, P = __P(); Object.assign(A, { hp: A.maxHp, stage: 0 }); /* it may have been nipped while it struck around you */ P.x = -A.len / 2 - 10; P.y = 0; game.update(1 / 60); return A.hp; });
  check(`${name}: biting its tail takes off 1`, bite1 === 5, String(bite1));
  await hold();
  await page.evaluate(() => { const A = game.G.apex, P = __P(); Object.assign(P, { x: -A.len / 2 - 10, y: 0, face: 1, charge: 1 }); });
  await tap('#boostBtn'); // the real button: it used to do nothing during the apex fight
  const bite2 = await page.evaluate(() => { const A = game.G.apex, boosting = __P().boost > 0; game.update(1 / 60); return { boosting, hp: A.hp, phase: A.stage, taunt: !!document.querySelector('.pop.taunt') }; });
  check(`${name}: the boost button works in the fight: a boosting bite takes off 2, and at half health it gets angry (phase 2, with a taunt)`, bite2.boosting && bite2.hp === 3 && bite2.phase === 1 && bite2.taunt, JSON.stringify(bite2));
  await hold();
  const jaws = await page.evaluate(() => { const A = game.G.apex, P = __P(); Object.assign(P, { x: A.len / 2 - 30, y: 0, safe: 0, shields: 1 }); game.update(1 / 60); const r = { alive: P.alive, shields: P.shields, hp: A.hp }; P.safe = 1e6; return r; });
  check(`${name}: its jaws would eat you (Spines spits you out)`, jaws.alive && jaws.shields === 0 && jaws.hp === 3, JSON.stringify(jaws));
  check(`${name}: phase 2 adds a double strike`, await page.evaluate(() => game.G.apex.a.phases[game.G.apex.stage].includes('double')));
  const pts0 = await page.evaluate(() => game.G.points);
  await hold();
  const down = await page.evaluate(() => {
    const A = game.G.apex, P = __P(), s0 = game.G.score;
    A.hp = 1;
    P.x = -A.len / 2 - 10; P.y = 0;
    game.update(1 / 60);
    const r = { phase: game.G.phase, title: document.getElementById('bannerTitle').textContent, bonus: game.G.score - s0, bar: document.getElementById('boss').hidden };
    for (let i = 0; i < 600 && app.state === 'playing'; i++) game.update(1 / 60);
    game.render();
    return { ...r, state: app.state, apexGone: !game.G.apex };
  });
  check(`${name}: the last bite defeats it: a big bonus, then the tree`, down.phase === 'apexdown' && down.title === 'MORAY DEFEATED!' && down.bonus >= APEX_BONUS_L5 && down.bar && down.state === 'tree' && down.apexGone, JSON.stringify(down));
  check(`${name}: beating the apex gives 2 skill points (bonus + level)`, (await page.evaluate(() => game.G.points)) === pts0 + 2);
  await tap('#treeNext');
  const loop = await page.evaluate(() => { for (let i = 0; i < 60 && game.G.phase !== 'fadein'; i++) __step(1); return { level: game.G.level, index: game.G.index, spot: game.G.spot.name, faster: speedAt(game.G.level) > speedAt(1), apex: !!game.G.apex }; });
  check(`${name}: after the Moray the reef starts over, deeper and faster`, loop.level === 6 && loop.index === 0 && loop.faster && !loop.apex, JSON.stringify(loop));
  check(`${name}: without all 5 shards the portal stays dark: same world, and the shards you found are kept`, await page.evaluate(() => game.G.world === 0 && !game.G.portal && document.getElementById('bannerSub').textContent !== ''));

  // ---------- Skills at work: Spines spits out a bite ----------
  const spines = await page.evaluate(() => {
    const g = game.G;
    g.points = 10;
    ['camouflage', 'toughSkin', 'spines'].forEach(id => game.buy(id));
    __clearLevel();
    return { owned: g.owned.filter(n => ['camouflage', 'toughSkin', 'spines'].includes(n)).length };
  });
  await tap('#treeNext');
  const spit = await page.evaluate(() => {
    for (let i = 0; i < 120; i++) __step(1);
    const P = __P();
    __clear();
    const shields = P.shields;
    P.safe = 0;
    __put(__big(), 15, 0); // the level's biggest fish: it can eat you
    __step(1);
    return { shields, alive: P.alive, left: P.shields, perks: document.getElementById('perks').textContent };
  });
  check(`${name}: Spines spits out a bite once per level`, spines.owned === 3 && spit.shields === 1 && spit.alive && spit.left === 0, JSON.stringify({ ...spines, ...spit }));

  // ---------- All five shards: the orb, the portal, and the next world ----------
  await page.evaluate(() => { game.G.shards = new Set([0, 1, 2, 3, 4]); game.G.worldPearls = 10; });
  for (let i = 0; i < 6 && (await page.evaluate(() => game.G.index)) < 4; i++) {
    const st = await page.evaluate(() => __clearLevel());
    if (st !== 'tree') { check(`${name}: clearing to the apex`, false, st); break; }
    await tap('#treeNext');
    await page.evaluate(() => { for (let i = 0; i < 60 && game.G.phase !== 'fadein'; i++) __step(1); __step(40); });
  }
  const portal = await page.evaluate(() => {
    for (let i = 0; i < 120 && game.G.phase !== 'swim'; i++) game.update(1 / 60);
    const P = __P();
    P.safe = 1e6;
    game.G.meter = METER_NEED - 0.2;
    __put(__food(), 5, 0);
    __step(1);
    const A = game.G.apex;
    if (!A) return { apex: false, index: game.G.index };
    Object.assign(A, { mode: 'exposed', t: 9, x: P.x + 400, y: P.y, hx: 1, hy: 0, face: 1, inv: 0, hp: 1 });
    Object.assign(P, { x: A.x - A.len / 2 - 10, y: A.y, vx: 0, vy: 0 });
    game.update(1 / 60);
    for (let i = 0; i < 200 && game.G.phase !== 'portal'; i++) game.update(1 / 60);
    __step(60);
    const pt = game.G.portal;
    return { apex: true, phase: game.G.phase, portal: !!pt, title: document.getElementById('bannerTitle').textContent };
  });
  check(`${name}: with all 5 shards, beating the apex opens a portal`, portal.phase === 'portal' && portal.portal && portal.title === 'THE ORB IS WHOLE!', JSON.stringify(portal));
  await shot('12-portal');
  const keep = await page.evaluate(() => {
    const pt = game.G.portal, P = __P();
    if (!pt) return {};
    Object.assign(P, { x: pt.x, y: pt.y, vx: 0, vy: 0 });
    game.update(1 / 60);
    return { state: app.state, n: document.querySelectorAll('.keepSkill').length, info: document.getElementById('keepInfo').textContent };
  });
  check(`${name}: swimming into the portal asks which skills to keep (2 of your 4, for 10 pearls)`, keep.state === 'keep' && keep.n === 4 && keep.info.includes('Keep 2 skills'), JSON.stringify(keep));
  await shot('13-keep');
  await tap('[data-keep=spines]');
  await tap('[data-keep=camouflage]');
  await tap('[data-keep=toughSkin]'); // a third doesn't fit
  await tap('#keep [data-action=dive]');
  const world2 = await page.evaluate(() => {
    for (let i = 0; i < 60 && game.G.phase !== 'fadein'; i++) __step(1);
    const g = game.G, P = __P();
    return { state: app.state, world: g.world, owned: g.owned, shards: g.shards.size, tier: P.tier, len: Math.round(P.len), want: Math.round(fishLen(1)), title: document.getElementById('bannerTitle').textContent, where: document.getElementById('whereName').textContent };
  });
  check(`${name}: the next world starts you small, with only the skills you kept and no shards`, world2.state === 'playing' && world2.world === 1 && world2.owned.join() === 'spines,camouflage' && world2.shards === 0 && world2.tier === 1 && world2.len === world2.want && world2.title === 'WORLD 2', JSON.stringify(world2));
  await page.evaluate(() => __step(90));
  await shot('14-world2');
  check(`${name}: opening a portal is remembered (it unlocks things)`, await page.evaluate(() => progress.portals >= 1 && progress.apexBeaten));

  // ---------- World 2: the Kelp Forest ----------
  const kelp = await page.evaluate(() => {
    const g = game.G;
    return { zone: g.zone.name, spot: g.spot.name, sub: document.getElementById('bannerSub').textContent, jellyChip: !!document.querySelector('#chain .chip.sting'), chips: __chipsOk(),
      kelp: g.scenery.group.children.some(m => m.material?.customProgramCacheKey?.() === 'kelp'), where: document.getElementById('whereName').textContent };
  });
  check(`${name}: world 2 is the Kelp Forest, with swaying kelp and a jellyfish chip on the bar`, kelp.zone === 'Kelp Forest' && kelp.spot === 'Kelp Edge' && kelp.sub.includes('Kelp Forest') && kelp.kelp && kelp.jellyChip && kelp.chips && kelp.where.startsWith('World 2'), JSON.stringify(kelp));
  const jelly = await page.evaluate(() => {
    const P = __P();
    __clear();
    Object.assign(P, { safe: 0, stun: 0, stingT: 0, shields: 0 });
    const j = __put('moonjelly', 15, 0);
    game.update(1 / 60);
    const small = { alive: P.alive, stun: P.stun > 0, there: game.G.fish.includes(j) };
    for (let i = 0; i < 90; i++) game.update(1 / 60); // the sting wears off
    P.tier = 3;
    Object.assign(P, { x: j.x - 10, y: j.y, vx: 0, vy: 0 });
    game.update(1 / 60);
    const big = { alive: P.alive, stun: P.stun > 0, there: game.G.fish.includes(j) };
    Object.assign(P, { tier: 1, safe: 1e6, stun: 0 });
    return { small, big };
  });
  check(`${name}: a jellyfish stings (a stun, not death) and can't be eaten, even when you're bigger`, jelly.small.alive && jelly.small.stun && jelly.small.there && jelly.big.alive && jelly.big.stun && jelly.big.there, JSON.stringify(jelly));
  await page.evaluate(() => { __clear(); __put('moonjelly', 220, 120, -1); __put('moonjelly', -260, -60, 1); __put('garibaldi', 160, -160, -1); __put('senorita', -200, 180, 1); __step(60); });
  await shot('15-kelp');
  for (const lv of [2, 3, 4, 5]) {
    const st = await page.evaluate(() => __clearLevel());
    if (st !== 'tree') { check(`${name}: clearing kelp level ${lv - 1} opens the tree`, false, st); break; }
    await tap('#treeNext');
    const info = await page.evaluate(() => { for (let i = 0; i < 60 && game.G.phase !== 'fadein'; i++) __step(1); __step(80); return { index: game.G.index, zone: game.G.zone.name, spot: game.G.spot.name, landmark: game.G.spot.landmark }; });
    check(`${name}: kelp level ${lv} is ${info.spot}`, info.zone === 'Kelp Forest' && info.index === lv - 1, JSON.stringify(info));
    await shot(`16-kelp${lv}`);
  }
  const leopard = await page.evaluate(() => {
    for (let i = 0; i < 120 && game.G.phase !== 'swim'; i++) game.update(1 / 60);
    const P = __P();
    P.safe = 1e6;
    game.G.meter = METER_NEED - 0.2;
    __put(__food(), 5, 0);
    __step(1);
    P.safe = 1e6;
    game.G.circles = []; // open water for the attack check
    const A = game.G.apex;
    if (!A) return { apex: false };
    const name = document.getElementById('bossName').textContent;
    A.a = { ...A.a, phases: [['charge'], ['charge']] }; // make it pick its charge
    Object.assign(A, { mode: 'circle', t: 0 });
    const seen = new Set();
    let fast = 0, edge = false;
    for (let i = 0; i < 60 * 10 && !(seen.has('lunge') && A.mode === 'recover'); i++) {
      game.update(1 / 60);
      seen.add(A.mode);
      if (A.mode === 'tell' && A.warn.visible) edge = true;
      if (A.mode === 'lunge') fast = Math.max(fast, Math.abs(A.vx));
    }
    return { apex: true, name, seen: [...seen], fast: +(fast / PLAYER.speed).toFixed(2), edge };
  });
  check(`${name}: the Kelp Forest's apex is the Leopard Shark`, leopard.apex && leopard.name === 'The Leopard Shark', JSON.stringify(leopard));
  check(`${name}: its charge: it swims off screen, a "!" warns at the edge, then it charges straight across`, leopard.seen.includes('away') && leopard.seen.includes('tell') && leopard.edge && leopard.seen.includes('lunge') && leopard.fast > 2, JSON.stringify(leopard));
  await page.evaluate(() => { const A = game.G.apex; A.a = { ...A.a, phases: [['charge'], ['charge']] }; Object.assign(A, { mode: 'circle', t: 0 }); for (let i = 0; i < 200 && A.mode !== 'tell'; i++) game.update(1 / 60); __step(20); });
  await shot('17-leopard');

  // ---------- Classes ----------
  await tap('#pauseBtn');
  await tap('#pause [data-action=menu]');
  await page.evaluate(() => { Object.assign(progress, { bestLevel: 99, bestScore: 1e6, apexBeaten: true, portals: 1 }); store.set('gulp-progress', progress); updateMain(); });
  check(`${name}: reaching the goals unlocks every fish`, await page.evaluate(() => document.querySelectorAll('#classes .locked').length === 0));
  await tap('[data-cls=barracuda]');
  await tap('#main [data-action=play]');
  const cuda = await page.evaluate(() => ({ owned: game.G.owned, speed: game.G.stats.speed, cls: game.G.cls.key }));
  check(`${name}: a Barracuda run starts with Fast Fins and +20% speed`, cuda.cls === 'barracuda' && cuda.owned.includes('fastFins') && Math.abs(cuda.speed - 1.2 * 1.12) < 1e-9, JSON.stringify(cuda));
  await page.evaluate(() => __step(30));
  await shot('09-barracuda');
  await tap('#pauseBtn');
  await tap('#pause [data-action=menu]');
  await tap('[data-cls=orca]');
  await tap('#main [data-action=play]');
  check(`${name}: an Orca run starts with a shield`, await page.evaluate(() => game.G.cls.key === 'orca' && __P().shields === 1));
  await page.evaluate(() => __step(30));
  await shot('09-orca');
  await tap('#pauseBtn');
  await tap('#pause [data-action=menu]');
  await tap('[data-cls=swordfish]');
  await tap('#main [data-action=play]');
  const spear = await page.evaluate(() => {
    const P = __P();
    input.mouse = null; // menu clicks left the mouse somewhere: boost straight ahead
    __step(120);
    __clear();
    P.safe = 1e6;
    P.face = 1;
    const f = __put('butterfly', 60, 0); // your own size
    P.charge = 1;
    game.boost();
    for (let i = 0; i < 20 && game.G.fish.includes(f); i++) game.update(1 / 60);
    return { cls: game.G.cls.key, eaten: !game.G.fish.includes(f) };
  });
  check(`${name}: the Swordfish spears a fish its own size while boosting`, spear.cls === 'swordfish' && spear.eaten, JSON.stringify(spear));
  await shot('09-swordfish');

  // ---------- Back to the menu ----------
  await tap('#pauseBtn');
  await tap('#pause [data-action=menu]');
  const menu = await page.evaluate(() => ({ state: app.state, hud: document.getElementById('hud').hidden, best: document.getElementById('mainBest').textContent }));
  check(`${name}: Main menu from pause, with the best score`, menu.state === 'menu' && menu.hud && menu.best.startsWith('Best:'), JSON.stringify(menu));
  check(`${name}: no page errors`, !errors.length, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// Sign-in and the leaderboard (js/arcade.js). As a guest it reads the real, shared leaderboard; a real Google sign-in
// can't run headless, so the signed-in checks stand in a fake account and check what the menus do with it.
async function accountChecks(browser) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.game, null, { timeout: 20000 });
  await page.evaluate(installHarness);
  const shown = sel => page.evaluate(q => [...document.querySelectorAll(q)].filter(e => !e.hidden && e.offsetParent).length, sel);
  check('account: a guest sees Sign in with Google on the main menu', (await shown('#main button.signin')) === 1 && (await shown('#main .acct')) === 0);
  await page.tap('#main [data-action=board]');
  await page.waitForFunction(() => document.getElementById('boardYou').textContent !== 'Loading...', null, { timeout: 15000 });
  const guestBoard = await page.evaluate(() => ({ you: document.getElementById('boardYou').textContent, rows: document.querySelectorAll('#boardList li').length, join: !document.querySelector('#board .signin').hidden }));
  check('account: the leaderboard loads from the shared backend for a guest, with a sign-in button', !guestBoard.you.startsWith("Couldn't") && guestBoard.join, JSON.stringify(guestBoard));
  await page.screenshot({ path: path.join(out, 'account-01-board-guest.png'), timeout: 45000 }).catch(() => {});
  await page.tap('#board [data-action=back]');
  check('account: Back from the leaderboard returns to the main menu', await visible(page, 'main'));
  await page.evaluate(() => runOver({ score: 1234, level: 2, eatenBy: 'Grouper' }));
  check("account: a guest's game over offers sign-in to post the best", (await shown('#over button.signin')) === 1);
  await page.evaluate(() => toMenu());

  // A fake signed-in player.
  await page.evaluate(() => {
    window.__posted = [];
    Object.assign(account, {
      user: { id: 'me' }, name: 'Reef Boss',
      post: async (score, mode) => { __posted.push(score); return true; },
      standing: async () => ({ rank: 3, of: 12, score: 4200 }),
      top: async () => [{ name: '<img src=x onerror=alert(1)>', score: 9000, me: false }, { name: 'Reef Boss', score: 4200, me: true }],
      sync: async data => data,
    });
    updateAccount();
  });
  const signedIn = await page.evaluate(() => ({ name: document.querySelector('#main .acctName').textContent, signin: [...document.querySelectorAll('#main .signin')].every(e => e.hidden) }));
  check('account: signed in, the main menu says who you are and hides Sign in', signedIn.name === 'Reef Boss' && signedIn.signin, JSON.stringify(signedIn));
  await page.screenshot({ path: path.join(out, 'account-02-menu-signed-in.png'), timeout: 45000 }).catch(() => {});
  await page.tap('#main [data-action=board]');
  await page.waitForFunction(() => document.querySelectorAll('#boardList li').length === 2, null, { timeout: 5000 });
  const board = await page.evaluate(() => ({ me: document.querySelector('#boardList li.me .n')?.textContent, injected: !!document.querySelector('#boardList img'), first: document.querySelector('#boardList li .n').textContent }));
  check('account: the board highlights you, and names show as plain text (no HTML gets in)', board.me === 'Reef Boss' && !board.injected && board.first.startsWith('<img'), JSON.stringify(board));
  await page.screenshot({ path: path.join(out, 'account-03-board.png'), timeout: 45000 }).catch(() => {});
  await page.tap('#board [data-action=back]');
  await page.tap('#main [data-action=rename]');
  check('account: Change name opens with your name filled in', await page.evaluate(() => !document.getElementById('nameScreen').hidden && document.getElementById('nameInput').value === 'Reef Boss'));
  await page.fill('#nameInput', 'ab');
  await page.tap('#nameScreen [data-action=saveName]');
  check('account: a name that breaks the rules gets a message, not a save', (await page.evaluate(() => document.getElementById('nameErr').textContent)).includes('3-20'));
  await page.tap('#nameScreen [data-action=back]');
  check('account: Cancel goes back to the main menu', await visible(page, 'main'));
  await page.evaluate(() => { store.set('gulp-posted', 0); runOver({ score: 4200, level: 3, eatenBy: 'Grouper' }); });
  await page.waitForFunction(() => document.getElementById('overRank').textContent.startsWith('Leaderboard'), null, { timeout: 5000 }).catch(() => {});
  const over = await page.evaluate(() => ({ rank: document.getElementById('overRank').textContent, posted: __posted, signin: document.querySelector('#over .signin').hidden }));
  check('account: game over posts the score once and shows your rank', over.rank === 'Leaderboard: #3 of 12 players' && over.posted.filter(s => s === 4200).length === 1 && over.signin, JSON.stringify(over));
  await page.screenshot({ path: path.join(out, 'account-04-over.png'), timeout: 45000 }).catch(() => {});
  await page.evaluate(() => toMenu());
  await page.tap('#main [data-action=signout]');
  await page.waitForFunction(() => !document.querySelector('#main button.signin').hidden, null, { timeout: 5000 }).catch(() => {});
  check('account: Sign out shows Sign in again', (await shown('#main button.signin')) === 1 && (await shown('#main .acct')) === 0);
  check('account: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// A phone held sideways: the sea fills the screen, and the HUD leaves room to play.
async function landscape(browser) {
  const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.game, null, { timeout: 20000 });
  await page.evaluate(installHarness);
  await page.evaluate(() => __step(60));
  const menuFits = await page.evaluate(() => { const r = document.getElementById('main').getBoundingClientRect(); return r.height <= innerHeight; });
  check('landscape: the main menu fits (it scrolls if it has to)', menuFits);
  await page.tap('#main [data-action=play]');
  await page.evaluate(() => __step(150));
  const lay = await page.evaluate(() => {
    const c = document.getElementById('view').getBoundingClientRect(), hud = document.getElementById('meterRow').getBoundingClientRect(), b = document.getElementById('boostBtn').getBoundingClientRect();
    return { canvas: Math.round(c.width), width: innerWidth, hudBottom: Math.round(hud.bottom), height: innerHeight, boost: b.right <= innerWidth && b.bottom <= innerHeight };
  });
  check('landscape: the sea fills the whole screen', lay.canvas === lay.width, JSON.stringify(lay));
  check('landscape: the HUD takes less than a third of the height, and BOOST is on screen', lay.hudBottom < lay.height / 3 && lay.boost, JSON.stringify(lay));
  await page.screenshot({ path: path.join(out, 'landscape-01-play.png'), timeout: 45000 }).catch(() => {});
  check('landscape: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
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
    await landscape(browser);
    await accountChecks(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
