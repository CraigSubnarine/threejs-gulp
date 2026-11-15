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

// The fish speed multiplier at a depth (each time round the zone it gets faster).
const speedAt = depth => 1 + TUNING.harder * (depth - 1);

// The spawner: which fish comes next and from where. Its own seeded generator, so a seed always gives the same
// sea; how fish then behave is left to Math.random.
function makeSpawner(seed, zone) {
  const rand = mulberry32(seed);
  const pick = list => {
    const total = list.reduce((a, f) => a + f.weight, 0);
    let r = rand() * total;
    for (const f of list) if ((r -= f.weight) < 0) return f;
    return list[list.length - 1];
  };
  return {
    rand,
    // playerTier decides what's food: about TUNING.edibleShare of spawns are fish you can eat right now.
    next(playerTier) {
      const food = zone.fish.filter(f => f.tier < playerTier && f.behavior !== 'puff');
      const rest = zone.fish.filter(f => !food.includes(f));
      const species = food.length && rand() < TUNING.edibleShare ? pick(food) : pick(rest);
      const fromLeft = rand() < 0.5;
      const count = species.group ? species.group[0] + Math.floor(rand() * (species.group[1] - species.group[0] + 1)) : 1;
      return { species, fromLeft, y: rand() * 2 - 1, count }; // y: -1 bottom of the view .. 1 top
    },
  };
}
