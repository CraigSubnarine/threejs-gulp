// Gulp! online matches: up to 8 fish in one sea, Last Fish Standing or Most Points. The rules (who wins, points for
// eating a player, sizes, the crown, respawn spots) are pure functions in rules.js; this file runs the lobby and the
// match over a room from net.js.
//
// Who decides what: each player's own browser moves its own fish (so controls feel instant) and sends where it is
// about 20 times a second. The host's browser runs everything else: the sea fish, power-up bubbles, bites between
// players, the timer, the crown and the end of the match, and sends each guest the sea around it about 12 times a
// second. Eating a sea fish, grabbing a bubble or a pearl is claimed by whoever did it; the host settles ties.
// Bots (added by the host) are run by the host like extra players.
import { openRoom, newCode, cleanCode, newId } from './net.js';
import { makeCrown, makeTag } from './art.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v);
const BOT_PREFIX = 'bot-';
// ui.js shows the screens; this calls into it.
const ui = () => window.pvpUi;

export function createPvp(api) {
  const { THREE, G, P, scene, camera } = api;
  const me = { id: newId(), name: 'Player', cls: 'shark' };
  let room = null, lobby = null, M = null;

  // ---------- The lobby ----------
  const defaults = () => ({ mode: 'points', time: 300, target: 25000, sea: 'reef', rain: false });
  function lobbyChanged() {
    if (!room?.isHost) return;
    room.send({ $: 'lobby', lobby });
    ui()?.lobby(state());
  }
  const state = () => ({ code: room?.code, me: me.id, host: room?.isHost, players: lobby?.players ?? [], settings: lobby?.settings ?? defaults() });
  function hookRoom() {
    room.on('join', id => { if (room.isHost && M) room.sendTo(id, { $: 'busy' }); });
    room.on('leave', id => {
      if (!room?.isHost || !lobby) return;
      const p = lobby.players.find(q => q.id === id);
      lobby.players = lobby.players.filter(q => q.id !== id);
      if (M) M.gone(id, p?.name);
      lobbyChanged();
    });
    room.on('closed', reason => { const was = !!M; leaveAll(); ui()?.closed(reason, was); });
    room.on('msg', (from, m) => {
      if (room.isHost) {
        if (m.$ === 'hello' && lobby && !M) {
          if (lobby.players.length >= PVP.max) return;
          if (!lobby.players.some(p => p.id === from)) lobby.players.push({ id: from, name: cleanName(m.name), cls: m.cls, bot: false, host: false });
          lobbyChanged();
        } else if (m.$ === 'cls' && lobby) {
          const p = lobby.players.find(q => q.id === from);
          if (p && !M) { p.cls = m.cls; lobbyChanged(); }
        } else M?.fromGuest(from, m);
      } else {
        if (m.$ === 'lobby') { lobby = m.lobby; ui()?.lobby(state()); }
        else if (m.$ === 'start') begin(m);
        else if (m.$ === 'back') { endMatch(); ui()?.lobby(state(), true); }
        else M?.fromHost(m);
      }
    });
  }
  const cleanName = n => (typeof NAME_RULE !== 'undefined' && NAME_RULE.test(String(n ?? '').trim()) ? String(n).trim() : `Player-${Math.floor(1000 + Math.random() * 9000)}`);

  async function create(name, cls) {
    Object.assign(me, { name: cleanName(name), cls });
    for (let i = 0; i < 4 && !room; i++) { // a fresh code (a clash with a live room is very unlikely; try again if so)
      try { room = await openRoom(newCode(), true, me.id); } catch (e) { if (i === 3) throw e; }
    }
    lobby = { players: [{ id: me.id, name: me.name, cls, bot: false, host: true }], settings: defaults() };
    hookRoom();
    lobbyChanged();
    return state();
  }
  async function join(code, name, cls) {
    Object.assign(me, { name: cleanName(name), cls });
    room = await openRoom(cleanCode(code), false, me.id);
    hookRoom();
    room.send({ $: 'hello', name: me.name, cls });
    return state();
  }
  function setCls(cls) {
    me.cls = cls;
    if (!room || M) return;
    if (room.isHost) { lobby.players.find(p => p.id === me.id).cls = cls; lobbyChanged(); } else room.send({ $: 'cls', cls });
  }
  function setSettings(s) {
    if (!room?.isHost || M) return;
    Object.assign(lobby.settings, s);
    lobbyChanged();
  }
  function addBot() {
    if (!room?.isHost || M || lobby.players.length >= PVP.max) return;
    const used = new Set(lobby.players.map(p => p.name)), n = lobby.players.filter(p => p.bot).length;
    lobby.players.push({ id: BOT_PREFIX + newId(), name: PVP.botNames.find(b => !used.has(b)) ?? `Bot ${n + 1}`, cls: CLASSES[n % CLASSES.length].key, bot: true, host: false });
    lobbyChanged();
  }
  function removeBot() {
    if (!room?.isHost || M) return;
    const i = lobby.players.map(p => p.bot).lastIndexOf(true);
    if (i >= 0) { lobby.players.splice(i, 1); lobbyChanged(); }
  }
  // The host starts: everyone gets the seed, the settings, the players and where each starts.
  function start() {
    if (!room?.isHost || M || lobby.players.length < 2) return false;
    const n = lobby.players.length, seed = Math.floor(Math.random() * 1e9), rand = mulberry32(seed);
    const players = lobby.players.map((p, i) => ({ ...p, x: Math.round(-WORLD.x * 0.75 + (n > 1 ? i * WORLD.x * 1.5 / (n - 1) : 0)), y: Math.round(-300 + rand() * 900) }));
    const msg = { $: 'start', seed, settings: { ...lobby.settings }, players };
    room.locked = true;
    room.send(msg);
    begin(msg);
    return true;
  }
  function leaveAll() {
    endMatch();
    room?.leave();
    room = null;
    lobby = null;
  }
  // The host's Rematch: back to the lobby with everyone still in the room.
  function rematch() {
    if (!room?.isHost) return;
    endMatch();
    room.locked = false;
    room.send({ $: 'back' });
    lobbyChanged();
    ui()?.lobby(state(), true);
  }
  function endMatch() {
    if (!M) return;
    M.cleanup();
    M = null;
    G.pvp = null;
    api.toMenu();
  }

  // ---------- The match ----------
  function begin(msg) {
    endMatch();
    const s = msg.settings, mine = msg.players.find(p => p.id === me.id) ?? msg.players[0];
    M = createMatch(msg, s);
    api.startPvpLevel({ cls: mine.cls, seed: msg.seed, world: Math.max(0, PVP.seas.indexOf(s.sea)), x: mine.x, y: mine.y, pvp: M });
    M.ready();
    ui()?.started();
  }

  function createMatch(msg, s) {
    const host = room.isHost, players = new Map(), feed = [], arrows = [], recent = new Map(); // recent: fish ids I just ate (ignore them in snapshots)
    let sendT = 0, snapT = 0, boardT = 0, seaT = 0, crownId = null, countdown = PVP.countdown, respawnT = 0, watchId = null, tick = 0;
    const crown = makeCrown();
    crown.visible = false;
    scene.add(crown);
    const v3 = new THREE.Vector3();
    for (const p of msg.players) {
      const e = { id: p.id, name: p.name, cls: p.cls, bot: !!p.bot, x: p.x, y: p.y, tx: p.x, ty: p.y, vx: 0, vy: 0, tier: 1, len: fishLen(1), face: 1, phase: 0, alive: true, out: false, outAt: 0,
        score: 0, eats: 0, shields: 0, power: null, safe: PVP.countdown + 1, boost: 0, ghost: 0, obj: null, tag: null, aura: null, sx: p.x, sy: p.y };
      if (e.bot) Object.assign(e, { stats: computeStats(e.cls, [], true), meter: 0, charge: 1, aiT: 0, goal: null, respawnT: 0, regrowT: 0 });
      if (e.bot) e.shields = e.stats.shields;
      players.set(p.id, e);
    }
    const mine = () => players.get(me.id);
    const list = () => [...players.values()];
    const live = e => e.alive && !e.out;

    // Other players' fish: a model, a name tag, power-up indicators.
    function show(e) {
      if (e.id === me.id) return;
      if (!e.obj) {
        e.obj = api.makeFish(api.classSpec(CLASSES.find(c => c.key === e.cls) ?? CLASSES[0]));
        e.tag = makeTag();
        scene.add(e.obj.root, e.tag);
      }
      e.obj.root.visible = live(e) && (e.safe <= 0 || G.t * 8 % 2 < 1.5);
      e.tag.visible = live(e);
    }

    const M = {
      isHost: host, rain: !!s.rain, settings: s, out: false, over: false,
      get players() { return players; },
      ready() {
        G.phase = 'countdown';
        api.banner(String(countdown), `${PVP.modes[s.mode]}${s.time ? ` · ${s.time / 60} min` : s.mode === 'points' ? ` · first to ${s.target.toLocaleString()}` : ''}`, 1000);
        for (const e of players.values()) show(e);
      },
      // The player a sea fish should react to: the nearest one still swimming.
      nearest(f) {
        let best = null, bd = Infinity;
        for (const e of players.values()) {
          if (!live(e)) continue;
          const d = Math.abs(e.x - f.x) + Math.abs(e.y - f.y);
          if (d < bd) { bd = d; best = e; }
        }
        return best === mine() ? P : best;
      },
      randomPlayer() { const l = list().filter(live), e = l[Math.floor(Math.random() * l.length)]; return !e || e.id === me.id ? P : e; },
      watching() {
        if (!M.out) return null;
        if (!watchId || !live(players.get(watchId) ?? {})) watchId = list().find(live)?.id ?? null;
        return players.get(watchId) ?? null;
      },
      nextWatch() {
        const l = list().filter(live);
        if (!l.length) return;
        const i = l.findIndex(e => e.id === watchId);
        watchId = l[(i + 1) % l.length].id;
        api.banner('WATCHING', players.get(watchId).name, 1200);
      },
      whereText() {
        const t = s.time ? (() => { const left = Math.max(0, Math.ceil(M.timeLeft)); return ` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; })() : '';
        return s.mode === 'lfs' ? `Last fish · ${list().filter(e => !e.out).length} left${t}` : `Most points${t || ` · to ${(s.target / 1000).toFixed(0)}k`}`;
      },
      timeLeft: s.time || 0,

      // ---------- Each frame ----------
      update(dt) {
        tick++;
        if (M.results && G.t >= M.results.at) { const r = M.results.rank; M.results = null; ui()?.results(r, host, s); }
        const m = mine();
        if (G.phase === 'countdown') {
          countdown -= dt;
          Object.assign(P, { vx: 0, vy: 0, x: m.sx, y: m.sy }); // held at the start until GO
          const n = Math.ceil(countdown);
          if (n > 0 && n !== M.lastCount) { M.lastCount = n; api.banner(String(n), '', 900); beep(660, 120, 0.05); }
          if (countdown <= 0) { G.phase = 'swim'; P.safe = PVP.safe; api.banner('GO!', 'Eat smaller fish. Avoid bigger ones.', 1100); jingle([523, 784, 1047], 90); }
        }
        // My fish, as everyone else sees it.
        Object.assign(m, { x: P.x, y: P.y, vx: P.vx, vy: P.vy, tier: P.tier, len: P.len, face: P.face, alive: P.alive, score: G.score, shields: P.shields, power: P.power?.kind ?? null, safe: P.safe, boost: P.boost, out: M.out });
        // Coming back after being eaten (Most Points).
        if (respawnT > 0 && (respawnT -= dt) <= 0) respawn();
        // Other players' fish glide to where they were last reported (bots are moved here on the host).
        for (const e of players.values()) {
          if (e.id === me.id) continue;
          if (e.bot && host) bot(e, dt);
          else {
            e.tx += e.vx * dt; e.ty += e.vy * dt; // carry on between updates
            e.x += (e.tx - e.x) * Math.min(1, dt * 10);
            e.y += (e.ty - e.y) * Math.min(1, dt * 10);
            e.safe -= dt;
          }
          e.len += (fishLen(e.tier) - e.len) * Math.min(1, dt * 4);
          show(e);
          if (e.obj.root.visible) {
            api.pose(e, dt);
            e.obj.root.scale.setScalar(e.len);
            api.indicate(e, { shield: e.shields > 0, rush: e.power === 'rush' });
          }
          e.tag.position.set(e.x, e.y + e.len * 0.45 + 70, 30);
          e.tag.scale.set(340, 85, 1);
          e.tag.userData.set(e.name, e.tier, e.id === crownId ? '#ffd23b' : '#ffffff');
        }
        // The crown floats over the leader.
        const lead = players.get(crownId);
        crown.visible = !!lead && live(lead) && G.phase === 'swim';
        if (crown.visible) {
          crown.position.set(lead.x, lead.y + lead.len * 0.42 + 35, 20);
          crown.scale.setScalar(clamp(lead.len * 0.4, 50, 140));
          crown.rotation.y += dt * 2;
        }
        if (!host) M.mirror(dt);
        // Network: my fish out, and (the host) the sea to each guest.
        if ((sendT -= dt) <= 0 && !host) {
          sendT = 1 / PVP.stateHz;
          room.sendFast({ $: 's', x: r1(P.x), y: r1(P.y), vx: r1(P.vx), vy: r1(P.vy), t: P.tier, a: P.alive ? 1 : 0, o: M.out ? 1 : 0, sc: G.score, e: m.eats, sh: P.shields, pw: P.power?.kind ?? 0, sf: P.safe > 0 ? 1 : 0, f: P.face });
        }
        if (host) {
          M.timeLeft = s.time ? M.timeLeft - (G.phase === 'swim' ? dt : 0) : 0;
          if (G.phase === 'swim') bites();
          crownId = leaderOf(list(), s.mode);
          if ((snapT -= dt) <= 0) { snapT = 1 / PVP.snapHz; snapshots(); }
          if (G.phase === 'swim' && !M.over) {
            const rank = pvpWinner(s.mode, list(), { timeUp: s.time > 0 && M.timeLeft <= 0, target: s.time ? 0 : s.target });
            if (rank) finish(rank.map(e => e.id));
          }
        }
        for (const [id, t] of recent) if (t < G.t) recent.delete(id);
      },

      // ---------- The sea (host): fish around every player, gone when far from all of them ----------
      tendSea(dt) {
        if (!host) return;
        const rects = list().filter(live).map(e => ({ e: e.id === me.id ? P : e, r: api.rectAround(e.id === me.id ? P : e) }));
        for (const f of [...G.fish]) if (!rects.some(({ r }) => f.x > r.x0 - 1100 && f.x < r.x1 + 1100 && f.y > r.y0 - 1100 && f.y < r.y1 + 1100)) api.removeFish(f);
        if ((seaT -= dt) > 0 || !['swim', 'countdown'].includes(G.phase)) return;
        seaT = TUNING.spawnEvery;
        // Fill whichever player's patch of sea is emptiest.
        let low = null, lowN = Infinity;
        for (const { e, r } of rects) {
          const n = G.fish.filter(f => f.x > r.x0 - 300 && f.x < r.x1 + 300 && f.y > r.y0 - 300 && f.y < r.y1 + 300).length;
          if (n < lowN) { lowN = n; low = e; }
        }
        if (low && lowN < 16 && G.fish.length < 16 * Math.max(1, rects.length)) api.spawn(false, low === P ? null : low);
      },
      // The host's snapshot for each guest: the other players, and the sea fish, bubbles and pearls near it.
      mirror(dt) { // a guest: glide the sea fish to where the host says they are
        for (const f of G.fish) {
          f.tx += f.vx * dt; f.ty += f.vy * dt;
          f.x += (f.tx - f.x) * Math.min(1, dt * 10);
          f.y += (f.ty - f.y) * Math.min(1, dt * 10);
          api.pose(f, dt);
          f.puff += ((f.flags & 4 ? 1 : 0) - f.puff) * Math.min(1, dt * 8);
          if (f.obj.spikes) f.obj.spikes.scale.setScalar(Math.max(f.puff, f.variant === 'spiny' ? 0.85 : 0.001));
          f.sk += ((f.flags & 2 ? 0.55 : 1) - f.sk) * Math.min(1, dt * 6);
          f.obj.root.scale.setScalar(f.len * (1 + 0.7 * f.puff) * f.sk);
          api.indicate(f, { shrink: !!(f.flags & 2), stun: !!(f.flags & 1) });
        }
      },

      // ---------- Things I did (claims to the host) ----------
      ateFish(f) {
        if (host) return;
        recent.set(f.id, G.t + 3);
        room.send({ $: 'fish', id: f.id });
      },
      grown() {
        const t = pvpTier(G.meter);
        if (t > P.tier) {
          P.tier = t;
          api.banner('BIGGER!', `Size ${t} of ${PVP.tiers}${t < PVP.tiers ? '' : ': the biggest there is'}`, 1300);
          api.burst(P.x, P.y, 24, 260);
          jingle([523, 659, 784, 1047]);
        }
      },
      claimPearl(o) {
        if (host) { room.send({ $: 'pearled', i: G.oysters.indexOf(o), by: me.id }); return true; }
        if (o.claimed > G.t) return false;
        o.claimed = G.t + 1;
        room.send({ $: 'pearl', i: G.oysters.indexOf(o) });
        return false; // the host says if it's mine
      },
      claimPickup(p) {
        if (host) return grantPickup(p, me.id);
        if (p.claimed > G.t) return;
        p.claimed = G.t + 1;
        room.send({ $: 'pick', id: p.id });
      },
      pickupGone() {},
      smashed(id) { room.send({ $: 'smash', id }); },
      // Something ate me: a sea fish (name), or another player (byId).
      died(name, f, byId = null) {
        if (!P.alive) return;
        P.alive = false;
        P.gulp = 0;
        api.burst(P.x, P.y, 30, 220);
        boom(400, 0.12);
        buzz(250);
        if (f) { f.vx = (P.x - f.x) * 3; f.vy = (P.y - f.y) * 3; }
        const who = byId ? players.get(byId)?.name : `a ${name}`;
        if (host) gotEaten(me.id, byId, name); else room.send({ $: 'died', by: byId, name });
        if (s.mode === 'lfs') {
          M.out = true;
          mine().out = true;
          mine().outAt = G.t;
          api.banner("YOU'RE OUT!", `Eaten by ${who}. Watching the others (tap to switch).`, 3000);
        } else {
          respawnT = PVP.respawn;
          api.banner('GULPED!', `Eaten by ${who}. Back in ${PVP.respawn} s, same size.`, 2400);
        }
      },

      // ---------- Messages ----------
      fromGuest(from, m) { // the host hears from a guest
        const e = players.get(from);
        if (!e) return;
        if (m.$ === 's') {
          Object.assign(e, { tx: m.x, ty: m.y, vx: m.vx, vy: m.vy, tier: m.t, alive: !!m.a, out: !!m.o, score: m.sc, eats: m.e, shields: m.sh, power: m.pw || null, safe: m.sf ? 1 : 0, face: m.f });
          if (!e.seen) { e.seen = true; e.x = m.x; e.y = m.y; }
          if (e.out && !e.outAt) e.outAt = G.t;
        } else if (m.$ === 'fish') {
          const f = G.fish.find(k => k.id === m.id);
          if (f) api.removeFish(f);
        } else if (m.$ === 'pick') {
          const p = G.pickups.find(k => k.id === m.id);
          if (p) grantPickup(p, from);
        } else if (m.$ === 'pearl') {
          const o = G.oysters[m.i];
          if (o?.has) { room.send({ $: 'pearled', i: m.i, by: from }); takeOyster(o, from); }
        } else if (m.$ === 'smash') { api.smash(m.id, true); room.send({ $: 'smash', id: m.id }); }
        else if (m.$ === 'died') gotEaten(from, m.by, m.name);
        else if (m.$ === 'spat') addFeed(`${e.name} spat out ${players.get(m.by)?.name ?? 'a bite'}!`, true);
      },
      fromHost(m) { // a guest hears from the host
        if (m.$ === 'w') return snapshot(m);
        if (m.$ === 'bite') return bitten(m.by);
        if (m.$ === 'ate') {
          addFeed(m.text);
          if (m.by === me.id) awarded(m);
          return;
        }
        if (m.$ === 'feed') return addFeed(m.text);
        if (m.$ === 'picked') {
          const p = G.pickups.find(k => k.id === m.id);
          if (m.by === me.id) api.takePickup(p ?? { id: m.id, kind: m.kind, obj: new THREE.Group() });
          else if (p) api.removePickup(p);
          if (m.kind === 'shock' || m.kind === 'shrink') api.ring(m.x, m.y, m.kind === 'shock' ? PICKUPS.kinds.shock.range : 700, m.kind === 'shock' ? 0xffd23b : 0xb36bff);
          return;
        }
        if (m.$ === 'pearled') {
          const o = G.oysters[m.i];
          if (!o) return;
          if (m.by === me.id) { o.claimed = 0; takeOysterMine(o); } else takeOyster(o, m.by);
          return;
        }
        if (m.$ === 'zap' && P.alive) { P.stun = Math.max(P.stun, 1.5 * G.stats.stun); api.popup('ZAPPED!', P.x, P.y + P.len, 'ouch'); return; }
        if (m.$ === 'smash') return api.smash(m.id, true);
        if (m.$ === 'end') return finish(m.rank);
      },
      hud() { hud(); },
      gone(id, name) {
        const e = players.get(id);
        if (!e) return;
        if (e.obj) scene.remove(e.obj.root, e.tag);
        players.delete(id);
        addFeed(`${name ?? e.name} left the match`);
        room.send({ $: 'feed', text: `${name ?? e.name} left the match` });
      },
      end() {}, // called by game.toMenu(); cleanup happens in cleanup()
      cleanup() {
        for (const e of players.values()) if (e.obj) scene.remove(e.obj.root, e.tag);
        scene.remove(crown);
        for (const a of arrows) a.remove();
        document.getElementById('pvpFeed').replaceChildren();
        document.getElementById('pvpBoard').replaceChildren();
        document.getElementById('pvpHud').hidden = true;
      },
    };

    // ---------- Host: bites between players ----------
    const pending = new Map(); // victim id -> time a bite on it was sent (waiting for its answer)
    function bites() {
      const l = list().filter(e => (e.id === me.id ? P.alive && !M.out : live(e)));
      for (const a of l) for (const b of l) {
        if (a === b || a.tier <= b.tier || b.safe > 0 || (pending.get(b.id) ?? 0) > G.t) continue;
        if (b.id === me.id ? P.safe > 0 || !P.alive : !live(b)) continue;
        const A = a.id === me.id ? P : a, B = b.id === me.id ? P : b;
        const reach = (a.id === me.id ? G.stats.reach : (a.stats ?? computeStats(a.cls, [], true)).reach);
        const d = Math.hypot(A.x - B.x, A.y - B.y);
        if (d > A.len * SHAPE_R.oval * reach * 1.15 + B.len * 0.25) continue;
        pending.set(b.id, G.t + 0.8);
        if (b.id === me.id) bitten(a.id);
        else if (b.bot) botBitten(b, a);
        else room.sendTo(b.id, { $: 'bite', by: a.id });
      }
    }
    // A bigger player caught me: a shield spits me out, otherwise I'm eaten.
    function bitten(byId) {
      if (!P.alive || P.safe > 0) return;
      const by = players.get(byId);
      if (P.shields > 0) {
        P.shields--;
        P.safe = 2;
        const nx = (P.x - (by?.x ?? P.x - 1)) || 1, ny = P.y - (by?.y ?? P.y), m = Math.hypot(nx, ny) || 1;
        P.vx = nx / m * 700; P.vy = ny / m * 700;
        api.popup('SPAT OUT!', P.x, P.y + P.len, 'combo');
        if (host) addFeed(`${me.name} spat out ${by?.name}!`, true); else room.send({ $: 'spat', by: byId });
        return;
      }
      M.died(by?.name ?? 'a fish', null, byId);
    }
    function botBitten(b, a) {
      if (b.shields > 0) { b.shields--; b.safe = 2; addFeed(`${b.name} spat out ${a.name}!`, true); return; }
      botDies(b, a.id, null);
    }
    // Someone was eaten (victim id), by a player (byId) or a sea fish (name). The host keeps score and tells everyone.
    function gotEaten(victimId, byId, name) {
      const v = players.get(victimId), by = byId ? players.get(byId) : null;
      if (!v) return;
      v.alive = false;
      if (s.mode === 'lfs') { v.out = true; v.outAt = G.t; }
      if (by) {
        const pts = eatPlayerPoints(v.tier, crownId === v.id);
        const text = `${by.name} ate ${v.name}${crownId === v.id ? ' \u{1F451}' : ''} +${pts.toLocaleString()}`;
        if (by.bot) { by.eats++; by.score += pts; by.meter += PVP.eatGrow; by.tier = pvpTier(by.meter); }
        const msgOut = { $: 'ate', victim: v.id, by: by.id, pts, tier: v.tier, text };
        room.send(msgOut);
        addFeed(text);
        if (by.id === me.id) awarded(msgOut);
      } else {
        const text = `${v.name} was eaten by a ${name}`;
        room.send({ $: 'feed', text });
        addFeed(text);
      }
    }
    // I ate another player: points by their size (double for the crowned leader) and a big meal.
    function awarded(m) {
      G.score += m.pts;
      G.meter += PVP.eatGrow;
      mine().eats++;
      api.popup(`+${m.pts.toLocaleString()}`, P.x, P.y + P.len, 'gold');
      api.burst(P.x, P.y, 30, 260);
      jingle([523, 784, 1047, 1319], 70);
      buzz(80);
      M.grown();
    }
    function respawn() {
      const spot = respawnSpot(list(), mine());
      Object.assign(P, { x: spot.x, y: spot.y, vx: 0, vy: 0, alive: true, gulp: 0, safe: PVP.safe, stun: 0 });
      pushOut(P, P.len * 0.3, G.circles);
      P.obj.root.visible = true;
      api.banner('BACK IN!', `Size ${P.tier} · safe for ${PVP.safe} s`, 1200);
    }

    // ---------- Host: power-ups and pearls ----------
    function grantPickup(p, byId) {
      if (!G.pickups.includes(p)) return;
      const who = byId === me.id ? P : players.get(byId);
      room.send({ $: 'picked', id: p.id, by: byId, kind: p.kind, x: r1(p.x), y: r1(p.y) });
      if (byId === me.id) api.takePickup(p); else api.removePickup(p);
      api.pickupWorld(p.kind, who);
      if (p.kind === 'shock') { // Shock also jolts the other players near you
        for (const e of players.values()) {
          if (e.id === byId || !live(e)) continue;
          const E = e.id === me.id ? P : e;
          if (Math.hypot(E.x - who.x, E.y - who.y) > PICKUPS.kinds.shock.range) continue;
          if (e.id === me.id) { P.stun = Math.max(P.stun, 1.5 * G.stats.stun); api.popup('ZAPPED!', P.x, P.y + P.len, 'ouch'); }
          else if (e.bot) e.stun = 1.5;
          else room.sendTo(e.id, { $: 'zap' });
        }
      }
    }
    function takeOyster(o, byId) { // someone else got this pearl
      o.has = false;
      o.regrow = OYSTER.regrow;
      api.burst(o.x, o.y + OYSTER.size * 0.3, 10, 120);
    }
    function takeOysterMine(o) { o.has = true; o.claimed = 0; api.takePearl(o, true); } // the host says this pearl is mine

    // ---------- Host: what each guest sees ----------
    function snapshots() {
      const others = list().filter(e => !e.bot && e.id !== me.id);
      if (!others.length) return;
      const pl = list().map(e => {
        const E = e.id === me.id ? P : e;
        return [e.id, r1(E.x), r1(E.y), r1(E.vx), r1(E.vy), e.tier, e.alive ? 1 : 0, e.out ? 1 : 0, e.score, e.eats, e.shields, e.power ?? 0, e.safe > 0 ? 1 : 0, e.face];
      });
      const pk = G.pickups.map(p => [p.id, p.kind, r1(p.x), r1(p.y), +p.t.toFixed(1)]);
      const oy = G.oysters.map(o => (o.has ? 1 : 0)).join('');
      for (const g of others) {
        const r = api.rectAround(g), fish = [];
        for (const f of G.fish) {
          if (f.x < r.x0 - 900 || f.x > r.x1 + 900 || f.y < r.y0 - 900 || f.y > r.y1 + 900) continue;
          fish.push([f.id, f.s.key, f.variant ?? 0, r1(f.x), r1(f.y), r1(f.vx), r1(f.vy), f.tier, (f.stun > 0 ? 1 : 0) | (f.shrink > 0 ? 2 : 0) | (f.puff > 0.5 ? 4 : 0)]);
        }
        room.sendTo(g.id, { $: 'w', tm: +M.timeLeft.toFixed(1), cr: crownId, p: pl.filter(q => q[0] !== g.id), f: fish, k: pk, o: oy }, true);
      }
    }
    // A guest applies the host's snapshot.
    function snapshot(m) {
      M.timeLeft = m.tm;
      crownId = m.cr;
      for (const q of m.p) {
        const e = players.get(q[0]);
        if (!e) continue;
        Object.assign(e, { tx: q[1], ty: q[2], vx: q[3], vy: q[4], tier: q[5], alive: !!q[6], out: !!q[7], score: q[8], eats: q[9], shields: q[10], power: q[11] || null, safe: q[12] ? 1 : 0, face: q[13] });
        if (!e.seen) { e.seen = true; e.x = q[1]; e.y = q[2]; }
      }
      const seen = new Set();
      for (const q of m.f) {
        const [id, key, variant, x, y, vx, vy, tier, flags] = q;
        if (recent.has(id)) continue;
        seen.add(id);
        let f = G.fish.find(k => k.id === id);
        if (!f) {
          const sp = api.speciesAt(key);
          if (!sp) continue;
          f = api.spawnFish(sp, x, y, Math.sign(vx) || 1, variant || null, id);
        }
        Object.assign(f, { tx: x, ty: y, vx, vy, tier, flags });
        if (f.s.behavior !== 'puff') f.len = fishLen(f.baseTier);
      }
      for (const f of [...G.fish]) if (!seen.has(f.id)) api.removeFish(f);
      const ids = new Set(m.k.map(k => k[0]));
      for (const p of [...G.pickups]) if (!ids.has(p.id)) api.removePickup(p);
      for (const [id, kind, x, y, t] of m.k) {
        const p = G.pickups.find(k => k.id === id) ?? api.spawnPickup(kind, x, y, id);
        Object.assign(p, { tx: x, ty: y, t });
      }
      [...m.o].forEach((c, i) => { const o = G.oysters[i]; if (o && !(o.claimed > G.t)) o.has = c === '1'; });
    }

    // ---------- The end ----------
    function finish(rankIds) {
      if (M.over) return;
      M.over = true;
      if (host) room.send({ $: 'end', rank: rankIds });
      G.phase = 'over';
      const rank = rankIds.map(id => players.get(id)).filter(Boolean).map((e, i) => ({ place: i + 1, id: e.id, name: e.name, cls: e.cls, score: e.id === me.id ? G.score : e.score, eats: e.eats, bot: e.bot, me: e.id === me.id }));
      const mineRank = rank.find(r => r.me);
      api.banner(mineRank?.place === 1 ? 'YOU WIN!' : 'MATCH OVER', `${rank[0]?.name} wins!`, 2500);
      jingle(mineRank?.place === 1 ? [523, 659, 784, 1047, 1319, 1568] : [392, 330, 262], 110);
      M.results = { at: G.t + 1.6, rank }; // the results screen, after a moment to see who won
    }

    // ---------- Bots (run by the host) ----------
    function bot(e, dt) {
      e.safe -= dt;
      if (e.stun > 0) e.stun -= dt;
      if (!e.alive) {
        if (s.mode === 'points' && (e.respawnT -= dt) <= 0) {
          const spot = respawnSpot(list(), e);
          Object.assign(e, { x: spot.x, y: spot.y, vx: 0, vy: 0, alive: true, safe: PVP.safe });
        }
        return;
      }
      if (e.out || G.phase !== 'swim') return;
      if (e.stats.regrow && e.shields < e.stats.shields && (e.regrowT += dt) >= e.stats.regrow) { e.shields++; e.regrowT = 0; }
      // Every few tenths of a second: run from anything bigger nearby, else go for the nearest thing it can eat.
      if ((e.aiT -= dt) <= 0) {
        e.aiT = 0.25 + Math.random() * 0.2;
        let threat = null, td = 520, prey = null, pd = 1700;
        const consider = (o, tier) => {
          const d = Math.hypot(o.x - e.x, o.y - e.y);
          if (tier > e.tier && d < td) { td = d; threat = o; }
          if (tier < e.tier && d < pd) { pd = d; prey = o; }
        };
        for (const f of G.fish) if (f.s.behavior !== 'jelly') consider(f, f.tier);
        for (const o of players.values()) if (o !== e && live(o)) consider(o.id === me.id ? P : o, o.tier);
        if (threat) e.goal = { x: e.x - (threat.x - e.x), y: e.y - (threat.y - e.y), flee: true };
        else if (prey) e.goal = { x: prey.x, y: prey.y, d: pd };
        else if (!e.goal || Math.hypot(e.goal.x - e.x, e.goal.y - e.y) < 200) e.goal = { x: (Math.random() * 2 - 1) * (WORLD.x - 800), y: (Math.random() * 2 - 1) * (WORLD.y - 400) };
      }
      const g = e.goal, dx = g.x - e.x, dy = g.y - e.y, dd = Math.hypot(dx, dy) || 1;
      let speed = PLAYER.speed * e.stats.speed;
      if (e.boost > 0) { e.boost -= dt; speed *= BOOST.speed * e.stats.boostSpeed; }
      else e.charge = Math.min(1, e.charge + dt / (BOOST.recharge * e.stats.boostRecharge));
      if (e.charge >= 1 && (g.flee || (g.d ?? 1e9) < 320)) { e.charge = 0; e.boost = BOOST.time * e.stats.boostTime; }
      if (e.stun > 0) speed *= 0.3;
      e.vx += (dx / dd * speed - e.vx) * Math.min(1, dt * PLAYER.turn);
      e.vy += (dy / dd * speed - e.vy) * Math.min(1, dt * PLAYER.turn);
      e.x = clamp(e.x + e.vx * dt, -WORLD.x + 40, WORLD.x - 40);
      e.y = clamp(e.y + e.vy * dt, -WORLD.y + e.len * 0.25, WORLD.y - e.len * 0.25);
      pushOut(e, e.len * SHAPE_R[api.classSpec(CLASSES.find(c => c.key === e.cls)).shape], G.circles);
      // Sea fish: eat the smaller ones (a Swordfish's spear: its own size too, while boosting); bigger ones eat it.
      const biteR = e.len * SHAPE_R.oval * e.stats.reach, myR = e.len * 0.25;
      for (const f of [...G.fish]) {
        if (f.s.behavior === 'jelly') continue;
        const d = Math.hypot(f.x - e.x, f.y - e.y), fr = f.len * SHAPE_R[f.s.shape] * (1 + 0.7 * f.puff) * f.sk;
        if ((canEat(e, f) || (e.stats.torpedo && e.boost > 0 && f.tier === e.tier)) && d < biteR * 1.15 + fr * 0.8) {
          api.removeFish(f);
          e.meter += GROW[clamp(f.tier, -1, 3)] * e.stats.growth;
          e.score += pointsFor(f.s.rank);
          e.tier = pvpTier(e.meter);
        } else if (canEat(f, e) && e.safe <= 0 && d < (myR + fr) * 0.72) {
          if (e.shields > 0) { e.shields--; e.safe = 2; } else { botDies(e, null, f.s.name); return; }
        }
      }
    }
    function botDies(e, byId, name) {
      gotEaten(e.id, byId, name);
      e.alive = false;
      e.respawnT = PVP.respawn;
      api.burst(e.x, e.y, 24, 200);
    }

    // ---------- HUD: scoreboard, kill feed, arrows ----------
    function addFeed(text, soft = false) {
      const el = document.createElement('div');
      el.textContent = text; // names are player input: text only
      if (soft) el.className = 'soft';
      const box = document.getElementById('pvpFeed');
      box.prepend(el);
      while (box.children.length > 4) box.lastChild.remove();
      setTimeout(() => el.remove(), 5000);
    }
    function hud() {
      document.getElementById('pvpHud').hidden = false;
      if ((boardT -= 1 / 60) <= 0) {
        boardT = 0.25;
        const rank = ranking(list().map(e => (e.id === me.id ? { ...e, score: G.score } : e)), s.mode);
        const rows = rank.slice(0, 3);
        if (!rows.some(e => e.id === me.id)) rows.push(rank.find(e => e.id === me.id));
        document.getElementById('pvpBoard').replaceChildren(...rows.filter(Boolean).map(e => {
          const li = document.createElement('li');
          li.value = rank.indexOf(e) + 1;
          if (e.id === me.id) li.className = 'me';
          if (e.out) li.classList.add('out');
          li.textContent = `${e.id === crownId ? '\u{1F451} ' : ''}${e.name}  ${(e.id === me.id ? G.score : e.score).toLocaleString()}`; // text only
          return li;
        }));
      }
      // Arrows to the bubbles and to the nearest pearls, while they're off screen.
      const targets = G.pickups.map(p => ({ x: p.x, y: p.y, color: PICKUPS.kinds[p.kind].color, sym: PICKUPS.kinds[p.kind].symbol }));
      const pearls = G.oysters.filter(o => o.has).sort((a, b) => Math.abs(a.x - P.x) - Math.abs(b.x - P.x)).slice(0, 2);
      for (const o of pearls) targets.push({ x: o.x, y: o.y + 40, color: '#ffd23b', sym: '◉' });
      const sc = api.screen(), box = document.getElementById('pvpArrows');
      let n = 0;
      for (const t of targets) {
        v3.set(t.x, t.y, 0).project(camera);
        if (Math.abs(v3.x) < 0.92 && Math.abs(v3.y) < 0.92) continue;
        const el = arrows[n] ?? box.appendChild(Object.assign(document.createElement('div'), { className: 'parrow', innerHTML: '<i></i><b></b>' }));
        arrows[n++] = el;
        const a = Math.atan2(v3.y * sc.h, v3.x * sc.w), k = 0.84 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
        el.hidden = false;
        el.style.transform = `translate(${sc.left + (1 + Math.cos(a) * k) / 2 * sc.w}px, ${(1 - Math.sin(a) * k) / 2 * sc.h}px) translate(-50%, -50%)`;
        el.style.setProperty('--c', t.color);
        el.firstChild.style.transform = `rotate(${-a}rad)`;
        el.lastChild.textContent = t.sym;
      }
      for (let i = n; i < arrows.length; i++) arrows[i].hidden = true;
    }
    return M;
  }

  return {
    get me() { return me; }, get room() { return room; }, get state() { return state(); }, get match() { return M; },
    create, join, setCls, setSettings, addBot, removeBot, start, rematch,
    leave() { leaveAll(); },
    nextWatch() { M?.nextWatch(); },
  };
}
