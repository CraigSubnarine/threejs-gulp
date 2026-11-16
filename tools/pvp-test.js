// Headless test of Gulp!'s online matches: several players as pages in one browser, talking over the local stand-in
// for the network (?net=local: a BroadcastChannel instead of Supabase + WebRTC). Each page's game is stepped by hand
// (game.manual), so a minute of play takes seconds; messages between pages are delivered between steps.
// Run from this game's folder: node tools/pvp-test.js   -> exits 1 on any failure or page error.
// With --real, two pages play over the real Supabase Realtime + WebRTC instead (a handful of Realtime messages).
const path = require('path');
const fs = require('fs');
const { chromium } = (() => { try { return require('playwright'); } catch { return require('playwright-core'); } })();
const { serve } = require('./server');

const REAL = process.argv.includes('--real');
const out = path.resolve(__dirname, '..', 'playtest-output');
fs.mkdirSync(out, { recursive: true });
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

function harness() {
  game.manual = true;
  window.__step = n => { for (let i = 0; i < n; i++) game.update(1 / 60); game.render(); };
  window.__P = () => game.G.player;
  window.__m = () => game.pvp.match;
}

(async () => {
  const server = await serve(path.resolve(__dirname, '..'));
  const url = `${server.url}/index.html${REAL ? '' : '?net=local'}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 812, height: 375 } });
    if (process.argv.includes('--tourney')) { // the starter balance check: bots of every kind, many matches
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction(() => !!window.game, null, { timeout: 30000 });
      await page.evaluate(harness);
      const rounds = Number(process.argv[process.argv.indexOf('--tourney') + 1]) || 20, wins = {}, place = {}, pts = {};
      await page.evaluate(() => game.pvp.create('Judge', 'shark'));
      for (let r = 0; r < rounds; r++) {
        const res = await page.evaluate(async r => {
          if (game.pvp.match) game.pvp.rematch();
          while (game.pvp.state.players.some(p => p.bot)) game.pvp.removeBot();
          for (let i = 0; i < 4; i++) game.pvp.addBot();
          // each kind of fish once, in a different order each round
          const bots = game.pvp.state.players.filter(p => p.bot), kinds = ['shark', 'barracuda', 'orca', 'swordfish'];
          bots.forEach((b, i) => { b.cls = kinds[(i + r) % 4]; });
          game.pvp.setSettings({ mode: 'points', time: 180, rain: false });
          game.pvp.start();
          const P = __P();
          for (let i = 0; i < 60 * 186 && !game.pvp.match.over; i++) { P.safe = 1e6; P.x = 0; P.y = 1300; P.alive = true; game.update(1 / 60); } // the judge floats at the top, out of the way
          const list = [...game.pvp.match.players.values()].filter(e => e.bot).sort((a, b) => b.score - a.score);
          return list.map(e => ({ cls: e.cls, score: e.score }));
        }, r);
        res.forEach((e, i) => { place[e.cls] = (place[e.cls] ?? 0) + i + 1; pts[e.cls] = (pts[e.cls] ?? 0) + e.score; });
        wins[res[0].cls] = (wins[res[0].cls] ?? 0) + 1;
      }
      for (const k of ['shark', 'barracuda', 'orca', 'swordfish']) console.log(`${k.padEnd(10)} wins ${String(wins[k] ?? 0).padStart(2)}/${rounds}  average place ${(place[k] / rounds).toFixed(2)}  average points ${Math.round(pts[k] / rounds)}`);
      const top = Math.max(...Object.values(wins));
      check('no starter wins more than half the bot matches', top <= rounds / 2, JSON.stringify(wins));
      check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
      return;
    }
    const open = async name => {
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
      await page.goto(url);
      await page.waitForFunction(() => !!window.game, null, { timeout: 30000 });
      await page.evaluate(harness);
      return page;
    };
    const pages = { host: await open('host'), a: await open('a') };
    if (!REAL) pages.b = await open('b');
    const all = () => Object.values(pages);
    // Step every page a little at a time, so their messages flow between them.
    const run = async (frames, chunk = 6) => { for (let f = 0; f < frames; f += chunk) { for (const p of all()) await p.evaluate(n => __step(n), chunk); await wait(REAL ? 20 : 2); } };
    const shot = (page, file) => page.screenshot({ path: path.join(out, `pvp-${file}.png`), timeout: 45000 }).catch(e => check(`screenshot ${file}`, false, e.message.split('\n')[0]));

    // ---------- The lobby ----------
    const code = await pages.host.evaluate(async () => (await game.pvp.create('Hosty', 'shark')).code);
    check('the host makes a room with a 5-letter code (no I, O, 0 or 1)', /^[A-HJ-NP-Z2-9]{5}$/.test(code), code);
    await pages.a.evaluate(c => game.pvp.join(c, 'Alpha', 'barracuda'), code);
    if (pages.b) await pages.b.evaluate(c => game.pvp.join(c, 'Bravo', 'orca'), code);
    await wait(REAL ? 2500 : 300);
    const roster = await Promise.all(all().map(p => p.evaluate(() => game.pvp.state.players.map(q => `${q.name}:${q.cls}`).join())));
    check('everyone in the room sees the same player list', roster.every(r => r === roster[0]) && roster[0].split(',').length === all().length, roster[0]);
    await pages.host.evaluate(() => { game.pvp.setSettings({ mode: 'points', time: 180, rain: true }); game.pvp.addBot(); });
    await wait(REAL ? 1500 : 200);
    const seen = await pages.a.evaluate(() => ({ s: game.pvp.state.settings, n: game.pvp.state.players.length, bot: game.pvp.state.players.some(p => p.bot) }));
    check("guests see the host's settings and the bot", seen.s.time === 180 && seen.s.rain && seen.bot && seen.n === all().length + 1, JSON.stringify(seen));
    const full = await pages.host.evaluate(() => { for (let i = 0; i < 9; i++) game.pvp.addBot(); return game.pvp.state.players.length; });
    check('a room holds at most 8 fish', full === 8, String(full));
    await pages.host.evaluate(() => { while (game.pvp.state.players.length > 0 && game.pvp.state.players.filter(p => p.bot).length > 1) game.pvp.removeBot(); });
    await wait(REAL ? 1500 : 200);

    // ---------- The match starts ----------
    await pages.host.evaluate(() => game.pvp.start());
    await wait(REAL ? 1500 : 200);
    await run(30);
    const started = await Promise.all(all().map(p => p.evaluate(() => ({ m: !!__m(), phase: game.G.phase, title: document.getElementById('bannerTitle').textContent, rivals: [...__m().players.values()].filter(e => e.obj).length }))));
    check('everyone starts the match with a countdown, and sees the other fish', started.every(s => s.m && s.phase === 'countdown' && s.rivals === all().length), JSON.stringify(started));
    await run(60 * (PVP_COUNT = 3) + 30);
    check('then GO', (await pages.a.evaluate(() => game.G.phase)) === 'swim');
    // Positions sync: Alpha swims right for a second; the host and Bravo see it move.
    const ids = await Promise.all(all().map(p => p.evaluate(() => game.pvp.me.id)));
    const aId = ids[1];
    const before = await pages.host.evaluate(id => __m().players.get(id).x, aId);
    await pages.a.evaluate(() => { input.keys.add('arrowright'); });
    await run(60);
    await pages.a.evaluate(() => { input.keys.delete('arrowright'); });
    await run(12);
    const after = await pages.host.evaluate(id => __m().players.get(id).x, aId);
    const aReal = await pages.a.evaluate(() => __P().x);
    check("the host sees a guest's fish move", after > before + 200 && Math.abs(after - aReal) < 120, `${Math.round(before)} -> ${Math.round(after)} (really ${Math.round(aReal)})`);
    // The sea: guests get the host's fish; a fish one player eats is gone for everyone.
    const sea = await Promise.all(all().map(p => p.evaluate(() => game.G.fish.length)));
    check('guests get the sea fish from the host', sea.every(n => n > 3), sea.join());
    const fishId = await pages.a.evaluate(() => {
      const P = __P(), f = game.G.fish.find(k => k.tier < P.tier && k.s.behavior !== 'jelly' && k.s.behavior !== 'puff');
      if (!f) return null;
      Object.assign(P, { x: f.x, y: f.y });
      __step(1);
      return game.G.fish.some(k => k.id === f.id) ? -1 : f.id;
    });
    await run(24);
    const goneEverywhere = fishId > 0 && (await Promise.all(all().map(p => p.evaluate(id => !game.G.fish.some(k => k.id === id), fishId)))).every(Boolean);
    check('a sea fish eaten by one player is gone for everyone', goneEverywhere, String(fishId));
    // Power-ups: Power-up rain drops several; one taken by a guest is taken only once, and its shield shows to others.
    await pages.host.evaluate(() => { game.G.pickT = 0; __step(1); game.G.pickT = 0; __step(1); });
    await run(18);
    const rain = await pages.a.evaluate(() => game.G.pickups.length);
    check('Power-up rain drops more than one bubble at a time, and guests see them', rain >= 2, String(rain));
    await pages.host.evaluate(() => { const p = game.G.pickups[0]; if (p) { p.kind = 'shield'; } });
    const pid = await pages.a.evaluate(() => { const p = game.G.pickups[0]; if (!p) return null; p.kind = 'shield'; const P = __P(); Object.assign(P, { x: p.x, y: p.y }); __step(1); return p.id; });
    await run(24);
    const picked = await Promise.all(all().map(p => p.evaluate(id => !game.G.pickups.some(k => k.id === id), pid)));
    const shieldA = await pages.a.evaluate(() => __P().shields);
    const shieldSeen = await pages.host.evaluate(id => { const e = __m().players.get(id); return { shields: e.shields, bubble: !!e.aura?.shield.visible }; }, aId);
    check('a bubble goes to one player, and is gone for everyone', picked.every(Boolean) && shieldA >= 1, `${picked} shields ${shieldA}`);
    check("other players see a player's shield (a bubble round the fish)", shieldSeen.shields >= 1 && shieldSeen.bubble, JSON.stringify(shieldSeen));
    const arrows = await pages.a.evaluate(() => { game.G.pickT = 0; return [...document.querySelectorAll('.parrow')].filter(a => !a.hidden).length; });
    await run(12);
    const arrows2 = await pages.a.evaluate(() => [...document.querySelectorAll('.parrow')].filter(a => !a.hidden).length);
    check('edge arrows point to bubbles and pearls off screen', Math.max(arrows, arrows2) >= 1, `${arrows}/${arrows2}`);
    await shot(pages.a, '01-match');

    // ---------- Players eating players ----------
    // The host grows big and swims onto Alpha (which first loses its shield): Alpha is eaten, the host scores.
    await pages.a.evaluate(() => { __P().shields = 0; });
    await run(12);
    const s0 = await pages.host.evaluate(() => game.G.score);
    await pages.host.evaluate(id => { const P = __P(), e = __m().players.get(id); game.G.meter = 60; P.tier = 4; P.len = 338; P.safe = 0; P.x = e.x; P.y = e.y; }, aId);
    await pages.a.evaluate(() => { __P().safe = 0; });
    await run(30, 2);
    const eaten = await pages.a.evaluate(() => ({ alive: __P().alive, title: document.getElementById('bannerTitle').textContent }));
    const ate = await pages.host.evaluate(() => ({ score: game.G.score, feed: document.getElementById('pvpFeed').textContent }));
    check('a bigger player eats a smaller one: points for the eater, and the kill feed says so', !eaten.alive && ate.score > s0 && ate.feed.includes('Alpha'), JSON.stringify({ eaten, ate, s0 }));
    // Most Points: back in 3 s, same size, somewhere else, points kept.
    const keep = await pages.a.evaluate(() => ({ tier: __P().tier, score: game.G.score, x: __P().x }));
    await run(60 * 3 + 30);
    const back = await pages.a.evaluate(() => ({ alive: __P().alive, tier: __P().tier, score: game.G.score, x: __P().x }));
    check('in Most Points you come back at the same size somewhere else, with your points', back.alive && back.tier === keep.tier && back.score === keep.score && Math.abs(back.x - keep.x) > 300, JSON.stringify({ keep, back }));
    // The crown: on the leader, and worth double.
    await run(12);
    const crown = await Promise.all(all().map(p => p.evaluate(() => ({ crown: document.getElementById('pvpBoard').textContent.includes('\u{1F451}') }))));
    check('the leader wears the crown (on the scoreboard)', crown.every(c => c.crown), JSON.stringify(crown));
    // The timer ends the match: results for everyone, the same winner.
    await pages.host.evaluate(() => { __m().timeLeft = 0.2; });
    await run(60 * 3);
    const res = await Promise.all(all().map(p => p.evaluate(() => ({ state: app.state, first: document.querySelector('#resultsList li')?.textContent ?? '' }))));
    check('when time runs out everyone gets the results, with the same winner', res.every(r => r.state === 'results' && r.first && r.first === res[0].first), JSON.stringify(res));
    await shot(pages.host, '02-results');

    // ---------- Rematch, Last Fish Standing ----------
    await pages.host.evaluate(() => { game.pvp.rematch(); game.pvp.setSettings({ mode: 'lfs', time: 0, rain: false }); game.pvp.removeBot(); });
    await wait(REAL ? 1500 : 200);
    const lobbyAgain = await Promise.all(all().map(p => p.evaluate(() => app.state)));
    check('Rematch takes everyone back to the lobby', lobbyAgain.every(s => s === 'lobby'), lobbyAgain.join());
    await shot(pages.a, '03-lobby');
    await pages.host.evaluate(() => game.pvp.start());
    await wait(REAL ? 1500 : 200);
    await run(60 * 3 + 40);
    // Each guest is eaten by a sea fish in turn: out (watching), then the last fish wins.
    for (const p of all().slice(1)) {
      await p.evaluate(() => { const P = __P(); P.safe = 0; P.shields = 0; const sp = game.G.levelFish.filter(f => f.behavior === 'hunter').pop(); const f = game.spawnFish(sp, P.x + 5, P.y, -1); __step(1); return f.id; });
      await run(12);
    }
    const outs = await Promise.all(all().slice(1).map(p => p.evaluate(() => ({ out: __m()?.out, alive: __P().alive, watching: !!game.pvp.match?.watching() }))));
    check('in Last Fish Standing an eaten fish is out, and watches the others', outs.every(o => o.out && !o.alive && o.watching), JSON.stringify(outs));
    await run(60 * 3);
    const lfs = await Promise.all(all().map(p => p.evaluate(() => ({ state: app.state, title: document.getElementById('resultsTitle').textContent }))));
    check('the last fish swimming wins', lfs[0].title === 'YOU WIN!' && lfs.every(r => r.state === 'results'), JSON.stringify(lfs));

    // ---------- The host leaves ----------
    await pages.host.evaluate(() => { game.pvp.leave(); toMenu(); });
    await wait(REAL ? 6000 : 500);
    await run(6);
    const left = await pages.a.evaluate(() => ({ state: app.state, msg: document.getElementById('onlineMsg').textContent }));
    check('when the host leaves, the others are told and go back to the online screen', left.state === 'online' && /host/i.test(left.msg), JSON.stringify(left));
    check('no page errors', !errors.length, errors.slice(0, 4).join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
