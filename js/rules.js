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

// Points for one fish: its tier's points times the combo (capped).
const scoreFor = (tier, combo) => SCORE[tier] * Math.min(Math.max(combo, 1), COMBO_MAX);

// The fish speed multiplier at a level (later levels are faster).
const speedAt = level => 1 + TUNING.harder * (level - 1);

// Which zone and spot a run level is: 5 levels per zone; after the last zone the zones loop (harder each time).
function levelInfo(level) {
  const i = level - 1, z = Math.floor(i / LEVELS_PER_ZONE);
  const zone = ZONES[z % ZONES.length];
  return { zone, index: i % LEVELS_PER_ZONE, spot: zone.levels[i % LEVELS_PER_ZONE], loop: Math.floor(z / ZONES.length) };
}

// The spawner: which fish comes next, from where, and whether it's a rare variant. Its own seeded generator, so
// a seed always gives the same sea; how fish then behave is left to Math.random. spot.mix weights this level's fish.
function makeSpawner(seed, zone, spot = {}) {
  const rand = mulberry32(seed), w = f => f.weight * (spot.mix?.[f.key] ?? 1);
  const pick = list => {
    const total = list.reduce((a, f) => a + w(f), 0);
    let r = rand() * total;
    for (const f of list) if ((r -= w(f)) < 0) return f;
    return list[list.length - 1];
  };
  return {
    rand,
    // playerTier decides what's food: about TUNING.edibleShare of spawns are fish you can eat right now.
    // variantMul: Treasure Nose makes rare fish more common.
    next(playerTier, variantMul = 1) {
      const food = zone.fish.filter(f => f.tier < playerTier && f.behavior !== 'puff');
      const rest = zone.fish.filter(f => !food.includes(f));
      const species = food.length && rand() < TUNING.edibleShare ? pick(food) : pick(rest);
      const fromLeft = rand() < 0.5;
      const count = species.group ? species.group[0] + Math.floor(rand() * (species.group[1] - species.group[0] + 1)) : 1;
      let variant = null;
      if (species.behavior !== 'puff' && rand() < VARIANT_CHANCE * variantMul) {
        const kinds = species.tier < 3 ? ['golden', 'spiny', 'speedy', 'giant'] : ['golden', 'giant'];
        variant = kinds[Math.floor(rand() * kinds.length)];
      }
      return { species, fromLeft, y: rand() * 2 - 1, count: variant ? 1 : count, variant }; // y: -1 bottom of the view .. 1 top
    },
  };
}

// ---------- Skill tree ----------
const nodeId = (branch, i) => `${branch}${i + 1}`;           // fins1 .. scales5
const nodeCost = i => i + 1;                                  // node n costs n points
const findNode = id => { const b = SKILLS.find(s => id.startsWith(s.key)); return b && { branch: b, i: Number(id.slice(b.key.length)) - 1 }; };
// You can buy a node if you don't own it, own the one before it in its branch, and have the points.
const canBuy = (owned, branch, i, points) => !owned.includes(nodeId(branch, i)) && (i === 0 || owned.includes(nodeId(branch, i - 1))) && points >= nodeCost(i);
const combosFor = owned => COMBOS.filter(c => c.needs.every(n => owned.includes(n)));

// Your stats, rebuilt from scratch from your class and the nodes you own (so stacking can't drift).
const ADD_STATS = ['shields', 'gulps', 'secondWind', 'refund', 'comboGap', 'comboMax'];
function computeStats(classKey, owned) {
  const s = { speed: 1, reach: 1, growth: 1, boostRecharge: 1, boostTime: 1, variants: 1, notice: 1, chase: 1, stun: 1,
    shields: 0, gulps: 0, secondWind: 0, refund: 0, comboGap: COMBO_GAP, comboMax: COMBO_MAX, torpedo: false, combos: {} };
  const apply = mods => {
    for (const [k, v] of Object.entries(mods)) {
      if (typeof v === 'boolean') s[k] = v;
      else if (ADD_STATS.includes(k)) s[k] += v;
      else s[k] *= v;
    }
  };
  apply(CLASSES.find(c => c.key === classKey)?.mods ?? {});
  for (const id of owned) { const n = findNode(id); if (n) apply(n.branch.nodes[n.i].mods); }
  for (const c of combosFor(owned)) s.combos[c.key] = true;
  return s;
}

// A class is open once its unlock is met (best level reached / best score in one run, kept between runs).
const classUnlocked = (cls, progress) => !cls.unlock || (cls.unlock.level ? progress.bestLevel >= cls.unlock.level : progress.bestScore >= cls.unlock.score);
