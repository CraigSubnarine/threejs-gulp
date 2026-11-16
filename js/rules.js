// Gulp! rules: who eats whom, growth, score and the seeded spawner. Plain script, no three.js, tested in Node by
// tools/check.js. The game scene only moves things around and asks these functions what happens.

// A small seeded random generator: the same seed gives the same numbers, so the same run for everyone.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Turns any text (a typed seed, today's date) into a number seed.
function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// A bigger tier eats a smaller one; the same tier just bumps.
const canEat = (eater, food) => eater.tier > food.tier;

// Your tier from the meter: 1 to start, 2 at a third, 3 at two thirds.
const tierFor = meter => meter >= METER_NEED * 2 / 3 ? 3 : meter >= METER_NEED / 3 ? 2 : 1;

// Points for one fish come from its size rank (bigger is worth more, all the way up the ladder), times the combo.
const pointsFor = rank => Math.round(10 * 1.6 ** rank);
const scoreFor = (rank, combo, comboMax = COMBO_MAX) => pointsFor(rank) * Math.min(Math.max(combo, 1), comboMax);

// The size ladder: the zone's fish that show up on a level (index 0-4 in its zone), each with its tier there
// (rank minus two per level). The window keeps the ranks just below you as food and adds bigger ones on top.
const ladderCache = new Map();
function levelFish(zone, index) {
  const key = `${zone.key}/${index}`, base = RANKS_PER_LEVEL * index;
  if (!ladderCache.has(key)) ladderCache.set(key, zone.fish.filter(f => f.rank >= base - 1 && f.rank <= base + 3).map(f => atLevel(f, index)));
  return ladderCache.get(key);
}
// One species as it is on a level: its tier there, and how big a puffer gets when it puffs up.
const atLevel = (f, index) => ({ ...f, tier: f.rank - RANKS_PER_LEVEL * index, puffTo: f.puffBy && f.rank - RANKS_PER_LEVEL * index + f.puffBy });

// Obstacles are circles on the play plane. pushOut moves something round (e: x, y, vx, vy; radius r) out of any
// circle it overlaps and takes away the part of its velocity heading into it, so it slides along the rock instead.
// Returns the last circle it touched (or null).
function pushOut(e, r, circles) {
  let hit = null;
  for (let pass = 0, moved = true; moved && pass < 12; pass++) { // a few passes: in the notch between two rocks, leaving one can push you into the other
    moved = false;
    for (const c of circles) {
      const dx = e.x - c.x, dy = e.y - c.y, min = r + c.r;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      const nx = d ? dx / d : 0, ny = d ? dy / d : 1;
      e.x = c.x + nx * min;
      e.y = c.y + ny * min;
      const into = e.vx * nx + e.vy * ny;
      if (into < 0) { e.vx -= into * nx; e.vy -= into * ny; }
      hit = c;
      moved = true;
    }
  }
  return hit;
}

// Puffers and jellyfish are special: never counted as plain food (a puffer puffs up; a jellyfish can't be eaten at all).
const special = f => f.behavior === 'puff' || f.behavior === 'jelly';

// The fish speed multiplier at a level (later levels are faster).
const speedAt = level => 1 + TUNING.harder * (level - 1);

// Which zone and spot a run level is. Every 5 levels make a lap of a world; the world (how many portals you've been
// through) picks the zone, so a lap without all 5 shards replays the same zone. loop: laps so far (apexes get tougher).
function levelInfo(level, world = 0) {
  const i = level - 1, zone = ZONES[world % ZONES.length];
  return { zone, index: i % LEVELS_PER_ZONE, spot: zone.levels[i % LEVELS_PER_ZONE], loop: Math.floor(i / LEVELS_PER_ZONE) };
}
// How many skills you keep through a portal: more for the pearls you found in that world.
const keepCount = pearls => Math.min(SHARDS.keep.max, SHARDS.keep.base + Math.floor(pearls / SHARDS.keep.pearls));

// The spawner: which fish comes next, from where, and whether it's a rare variant. Its own seeded generator, so
// a seed always gives the same sea; how fish then behave is left to Math.random. It picks from the level's window
// of the size ladder (index: the level within its zone), and spot.mix weights this level's fish.
function makeSpawner(seed, zone, spot = {}, index = 0) {
  const rand = mulberry32(seed), fish = levelFish(zone, index), w = f => f.weight * (spot.mix?.[f.key] ?? 1);
  const pick = list => {
    const total = list.reduce((a, f) => a + w(f), 0);
    let r = rand() * total;
    for (const f of list) if ((r -= w(f)) < 0) return f;
    return list[list.length - 1];
  };
  return {
    rand,
    // playerTier decides what's food: about TUNING.edibleShare of spawns are fish you can eat right now (a bit
    // more while you're at your smallest). variantMul: Treasure Nose makes rare fish more common.
    next(playerTier, variantMul = 1) {
      const food = fish.filter(f => f.tier < playerTier && !special(f));
      const rest = fish.filter(f => !food.includes(f));
      const share = playerTier <= 1 ? TUNING.edibleSmall : TUNING.edibleShare;
      const species = food.length && rand() < share ? pick(food) : pick(rest);
      const fromLeft = rand() < 0.5;
      const count = species.group ? species.group[0] + Math.floor(rand() * (species.group[1] - species.group[0] + 1)) : 1;
      let variant = null;
      if (!special(species) && rand() < VARIANT_CHANCE * variantMul) {
        const kinds = species.tier < 3 ? ['golden', 'spiny', 'speedy', 'giant'] : ['golden', 'giant'];
        variant = kinds[Math.floor(rand() * kinds.length)];
      }
      return { species, fromLeft, y: rand() * 2 - 1, count: variant ? 1 : count, variant }; // y: -1 bottom of the view .. 1 top
    },
  };
}

// ---------- Oysters, pearls and power-ups ----------
// Where an oyster is in its cycle, t seconds in: 'closed' | 'open' (pearl showing) | 'tell' (shivering) | 'snap'.
// openMul stretches the open part (Pearl Diver).
function oysterPhase(t, openMul = 1) {
  const o = OYSTER, open = o.open * openMul, cycle = o.closed + open + o.tell + o.snap;
  t = ((t % cycle) + cycle) % cycle;
  return t < o.closed ? 'closed' : t < o.closed + open ? 'open' : t < o.closed + open + o.tell ? 'tell' : 'snap';
}
const pearlPoints = (black, level) => (black ? OYSTER.black : OYSTER.white) * level;
const pearlCount = black => (black ? OYSTER.blackPearls : 1);
// Which power-up comes next (weighted by w), from its own seeded generator.
function rollPickup(rand) {
  const kinds = Object.entries(PICKUPS.kinds), total = kinds.reduce((a, [, k]) => a + k.w, 0);
  let r = rand() * total;
  for (const [key, k] of kinds) if ((r -= k.w) < 0) return key;
  return kinds[kinds.length - 1][0];
}

// ---------- Apex predators ----------
// Where something round (you: px, py, radius pr) touches a long fish whose body runs along its heading (hx, hy, a
// unit vector) from tail to head, centred on (ax, ay). Returns null (not touching), 'tail' (the back part: you
// bite it) or 'head' (its jaws: it bites you).
function apexContact(ax, ay, hx, hy, len, r, px, py, pr) {
  const tx = ax - hx * len / 2, ty = ay - hy * len / 2;                                   // the tail end
  const s = Math.max(0, Math.min(1, ((px - tx) * hx + (py - ty) * hy) / len));             // 0 tail .. 1 head
  if (Math.hypot(px - (tx + hx * len * s), py - (ty + hy * len * s)) > r + pr) return null;
  return s > APEX.headShare ? 'head' : 'tail';
}
// Which phase an apex is in from its health: phases split the health bar evenly (2 phases: the second at half).
const apexPhase = (hp, maxHp, phases) => Math.min(phases - 1, Math.floor((1 - hp / maxHp) * phases + 1e-9));
// Its health: tougher each time round the zones.
const apexHp = (apex, loop) => Math.round(apex.hp * (1 + APEX.toughness * loop));

// ---------- Skill tree ----------
const ALL_NODES = SKILLS.flatMap(b => b.nodes.map(n => ({ ...n, branch: b })));
const findNode = id => ALL_NODES.find(n => n.id === id);
const nodeCost = node => ROW_COST[node.row];
const skillName = id => findNode(id)?.name ?? id;
// A node opens once you own any one of the nodes it needs (the top of each branch needs nothing).
const nodeOpen = (owned, node) => !node.needs.length || node.needs.some(id => owned.includes(id));
const canBuy = (owned, id, points) => { const n = findNode(id); return !!n && !owned.includes(id) && nodeOpen(owned, n) && points >= nodeCost(n); };
const combosFor = owned => COMBOS.filter(c => c.needs.every(n => owned.includes(n)));

// Your stats, rebuilt from scratch from your class and the nodes you own (so stacking can't drift).
const ADD_STATS = ['shields', 'gulps', 'secondWind', 'refund', 'comboGap', 'comboMax', 'apexDamage', 'boostCharges', 'regrow'];
function computeStats(classKey, owned, pvp = false) {
  const s = { speed: 1, reach: 1, growth: 1, boostRecharge: 1, boostTime: 1, boostSpeed: 1, variants: 1, notice: 1, chase: 1, stun: 1, oysterOpen: 1, pearlMul: 1,
    shields: 0, gulps: 0, secondWind: 0, refund: 0, comboGap: COMBO_GAP, comboMax: COMBO_MAX, apexDamage: 0, boostCharges: 1, regrow: 0,
    torpedo: false, wake: false, ghostFin: false, magnet: false, ironJaw: false, shardSense: false, ink: false, mimic: false, oysterProof: false, combos: {} };
  const apply = mods => {
    for (const [k, v] of Object.entries(mods)) {
      if (typeof v === 'boolean') s[k] = v;
      else if (ADD_STATS.includes(k)) s[k] += v;
      else s[k] *= v;
    }
  };
  const cls = CLASSES.find(c => c.key === classKey);
  apply((pvp ? cls?.pvp?.mods : null) ?? cls?.mods ?? {}); // online matches use the starter's PvP tuning
  for (const id of owned) { const n = findNode(id); if (n) apply(n.mods); }
  for (const c of combosFor(owned)) s.combos[c.key] = true;
  return s;
}

// A class is open once its unlock is met (kept between runs): a level reached, an apex beaten, a portal opened.
function classUnlocked(cls, progress) {
  const u = cls.unlock;
  if (!u) return true;
  if (u.level) return progress.bestLevel >= u.level;
  if (u.apex) return !!progress.apexBeaten;
  if (u.portal) return (progress.portals ?? 0) > 0;
  return progress.bestScore >= u.score;
}

// ---------- PvP ----------
// Your size from the meter: 1 to start, one more every PVP.perTier, up to PVP.tiers.
const pvpTier = meter => Math.min(PVP.tiers, 1 + Math.floor(Math.max(0, meter) / PVP.perTier));
// Points for eating another player: bigger fish are worth much more; the crowned leader is worth double.
const eatPlayerPoints = (victimTier, leader = false) => PVP.eatPoints * victimTier * victimTier * (leader ? PVP.crown : 1);
// Who's ahead. players: [{ id, out, tier, score, outAt }]. Most Points: the most points. Last Fish Standing: those
// still in first, biggest first, then points; those out by how long they lasted.
function ranking(players, mode) {
  const by = mode === 'lfs'
    ? (a, b) => (!!a.out - !!b.out) || (a.out ? (b.outAt ?? 0) - (a.outAt ?? 0) : (b.tier - a.tier) || (b.score - a.score))
    : (a, b) => (b.score - a.score) || (b.tier - a.tier);
  return [...players].sort(by);
}
// The crowned leader's id (null until someone's ahead: nobody wears it at 0 points).
function leaderOf(players, mode) {
  const top = ranking(players, mode)[0];
  return top && !top.out && (top.score > 0 || mode === 'lfs' && players.length > 1) ? top.id : null;
}
// Is the match over? Returns the final ranking, or null to play on.
// Last Fish Standing: one fish left (or time's up). Most Points: time's up, or someone reached the target.
function pvpWinner(mode, players, { timeUp = false, target = 0 } = {}) {
  if (players.length < 2) return null;
  const over = timeUp || (mode === 'lfs' ? players.filter(p => !p.out).length <= 1 : target > 0 && players.some(p => p.score >= target));
  return over ? ranking(players, mode) : null;
}
// Where to come back after being eaten: of a dozen random spots, the one furthest from any fish your size or bigger.
function respawnSpot(players, me, rand = Math.random) {
  const threats = players.filter(p => p.id !== me.id && !p.out && p.tier >= me.tier);
  let best = null, far = -1;
  for (let i = 0; i < 12; i++) {
    const s = { x: (rand() * 2 - 1) * (WORLD.x - 600), y: (rand() * 2 - 1) * (WORLD.y - 350) };
    const d = threats.length ? Math.min(...threats.map(p => Math.hypot(p.x - s.x, p.y - s.y))) : 1e9;
    if (d > far) { far = d; best = s; }
  }
  return best;
}
