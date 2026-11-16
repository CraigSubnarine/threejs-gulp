// Gulp! data: the sea, the fish, the levels, the skill tree, the classes and the tuning numbers. Plain script
// (globals), so tools/check.js can load it in Node.

// The world is a flat plane at z = 0 (side view): x runs left-right, y up (surface) and down (sea floor).
//
// The size ladder: every species in a zone has a fixed size rank (0 = tiniest). Each level shows a window of the
// ladder, two ranks higher than the level before, so when a level ends you keep your size: the fish you could eat
// are still there (and still food), and new bigger ones join on top. A fish's tier is its size compared with the
// level: tier = rank - 2 × (level in zone - 1). You start every level at tier 1 and grow to tier 3.
//
// All sizes are "level units": every level is built at the same scale (tier 1 is 70 long). Between levels the game
// zooms out and rescales by LEVEL_SCALE (one level = two ranks), so numbers never blow up.
const WORLD = { x: 2200, y: 1400 };   // half-width and half-height
const VIEW_H = [0, 1280, 1650, 2100]; // how much of the plane the camera shows (height) at your tier 1, 2, 3
// tilt: degrees the camera looks down on the sea; sway: degrees it swings round as you swim sideways;
// lead: seconds of your movement it looks ahead.
const CAMERA = { tilt: 22, sway: 8, lead: 0.25 };
const LEVEL_SCALE = 200 / 70;                                // a full-grown you (200) is a tier-1 fish (70) one level on
const fishLen = tier => 70 * LEVEL_SCALE ** ((tier - 1) / 2); // tier -1: 24, 0: 41, 1: 70, 2: 118, 3: 200, 4: 338
const RANKS_PER_LEVEL = 2;
// Meter gained for eating a fish of tier -1 (leftover snacks from the level before) to 3. Tiny fish are filling
// enough that the first size-up takes about 12 bites.
const GROW = { '-1': 0.5, 0: 1.75, 1: 3, 2: 6, 3: 10 };
const METER_NEED = 60;                // a full meter clears the level; you grow a tier at 1/3 and 2/3
const COMBO_GAP = 1.5;                // seconds between eats that keeps a combo going
const COMBO_MAX = 8;
const CLEAR_BONUS = 400;              // × the level number, when a level's meter fills
const LEVELS_PER_ZONE = 5;
const SHAPE_R = { oval: 0.3, disc: 0.36, fat: 0.33, long: 0.2, round: 0.38, torpedo: 0.24, eel: 0.15 }; // touch radius, as a share of length

const PLAYER = {
  speed: 380,       // units per second at full stick
  turn: 7,          // how quickly velocity catches up with the stick (per second)
  safe: 2,          // seconds nothing can eat you at the start of a level
};

// The boost button: a burst of speed, then it has to recharge.
const BOOST = { speed: 2.3, time: 0.55, recharge: 4 }; // × your speed, seconds it lasts, seconds to recharge

const TUNING = {
  population: 26,   // fish alive around you at once
  spawnEvery: 0.35, // seconds between spawns while below the population
  edibleShare: 0.6, // share of spawns you can eat
  edibleSmall: 0.7, // ... while you're still at your smallest (tier 1), so the start of a level isn't a slog
  fleeRange: 260,   // prey this close to a bigger you swim away
  chaseRange: 340,  // hunters bigger than you this close give chase
  chaseTime: 4,     // seconds a hunter chases before giving up
  chaseRest: 3,     // seconds before it can chase again
  chaseSpeed: 0.78, // a hunter's top chase speed, as a share of your base speed
  harder: 0.025,    // each level: fish +2.5% faster
};

// Apex predators: the boss at the end of each zone's last level. You bite its tail (the back part of its body);
// its jaws (the front headShare of its body) eat you. Attacks come from APEX_ATTACKS; each apex lists them per phase.
const APEX = {
  headShare: 0.6,   // the front 40% of the body is jaws
  inv: 0.6,         // seconds it can't be bitten again after a bite
  bitePoints: 150,  // per point of damage
  boostDamage: 2,   // a bite while boosting
  bonus: 3000,      // × the level number, for beating it
  view: 1.3,        // the camera shows this much more than at tier 3 during the fight
  toughness: 0.5,   // each time round the zones, apexes get 50% more health
};
const APEX_ATTACKS = ['lunge', 'flurry']; // lunge: shake, then dash at you; flurry: three quick short lunges

// Rare variants of ordinary fish. chance: share of spawns (before Treasure Nose).
const VARIANT_CHANCE = 0.08;
const VARIANTS = {
  golden: { name: 'Golden', points: 5, desc: 'worth ×5 points' },
  spiny: { name: 'Spiny', growth: 2, stun: 0.7, desc: 'stings when you bite it, but gives ×2 growth' },
  speedy: { name: 'Speedy', points: 2, speed: 1.8, desc: 'fast and jumpy, worth ×2 points' },
  giant: { name: 'Giant', tier: 1, desc: 'one size bigger than usual' },
};

// shape: oval | disc (tall, flat) | fat (big head) | long (thin) | round (puffer) | torpedo (sharks) | eel
// behavior: cruise (swims across) | school (comes in a group) | skittish (flees a bigger you) | hunter (chases a smaller you) | puff
// rank: place on the zone's size ladder (see the top of this file); every rank 0-11 needs at least one species.
// Each zone has LEVELS_PER_ZONE levels: its own spot with a look (water, floor, props, landmark) and a fish mix
// (weights multiplied for that level).
const ZONES = [
  {
    key: 'reef', name: 'Sunny Reef', sub: 'Warm, shallow and full of snacks',
    water: { top: 0x8be3f2, bottom: 0x1d86b0 }, sun: 1.9, sky: 0xd8f8ff, ground: 0x3a8fa8, floor: 0xf2d9a0,
    // size: × a full-grown you; speed: circling speed × your base speed; lunge: dash speed × your base speed;
    // tell: seconds of shaking before a lunge. Taunts are original lines.
    apex: { key: 'barracuda', name: 'The Barracuda', short: 'Barracuda', size: 2.6, hp: 6, speed: 0.75, lunge: 2.5, tell: 0.7,
      phases: [['lunge'], ['lunge', 'flurry']],
      intro: 'This reef has one rule: I eat first.', rage: 'Bitten? ME? Now you\'re dinner.', defeat: 'Fine... keep your little reef.',
      spec: { shape: 'torpedo', body: 0x8fa3b4, belly: 0xeef4f8, fin: 0x4f6a7c, stripe: 0x34495a, stripes: [-0.34, -0.22, -0.1, 0.02, 0.14], eye: 0.7, teeth: true } },
    // The reef's size ladder, smallest first. Level 1 shows ranks 0-3, level 2 ranks 1-5 (1 = leftover snacks),
    // level 3 ranks 3-7, level 4 ranks 5-9, level 5 ranks 7-11. puffBy: how many sizes a puffer grows when it puffs up.
    fish: [
      { key: 'minnow', name: 'Minnow', rank: 0, shape: 'oval', body: 0x9fd8ff, belly: 0xf4fbff, fin: 0x7fc0ef, speed: 130, behavior: 'school', group: [4, 7], weight: 3 },
      { key: 'goby', name: 'Goby', rank: 0, shape: 'oval', body: 0xd9b27a, belly: 0xfff0d6, fin: 0xb08850, stripe: 0x8a6a40, stripes: [-0.15, 0.1], speed: 100, behavior: 'skittish', weight: 1.5 },
      { key: 'butterfly', name: 'Butterflyfish', rank: 1, shape: 'disc', body: 0xffd23b, belly: 0xfff2b0, fin: 0xffb000, stripe: 0x2b2b38, stripes: [0.05], speed: 110, behavior: 'skittish', weight: 2.2 },
      { key: 'damsel', name: 'Damselfish', rank: 1, shape: 'oval', body: 0x2f6bff, belly: 0x9fc0ff, fin: 0x1fd1ff, speed: 140, behavior: 'school', group: [2, 4], weight: 1.6 },
      { key: 'puffer', name: 'Pufferfish', rank: 1, shape: 'round', body: 0xe8c34a, belly: 0xfff4c8, fin: 0xd09a20, stripe: 0x8a6a20, stripes: [0], speed: 70, behavior: 'puff', weight: 0.8, puffBy: 2 },
      { key: 'parrot', name: 'Parrotfish', rank: 2, shape: 'oval', body: 0x2ec9b5, belly: 0xa6f2e0, fin: 0xff6fb0, stripe: 0xff6fb0, stripes: [-0.2, 0.25], speed: 140, behavior: 'skittish', weight: 1.6 },
      { key: 'trigger', name: 'Triggerfish', rank: 2, shape: 'disc', body: 0x3a3f5c, belly: 0xffd27a, fin: 0xff8a3d, stripe: 0x9be7ff, stripes: [-0.12, 0.12], speed: 120, behavior: 'hunter', weight: 0.9 },
      { key: 'grouper', name: 'Grouper', rank: 3, shape: 'fat', body: 0x8a6a3a, belly: 0xd9c08a, fin: 0x6b4f28, stripe: 0x5a4220, stripes: [-0.3, 0, 0.3], speed: 90, behavior: 'hunter', weight: 1.2 },
      { key: 'snapper', name: 'Snapper', rank: 3, shape: 'oval', body: 0xe8504a, belly: 0xffc2a8, fin: 0xff7a5c, speed: 120, behavior: 'cruise', group: [1, 3], weight: 1 },
      { key: 'angel', name: 'Angelfish', rank: 4, shape: 'disc', body: 0x2e5bd8, belly: 0xffd23b, fin: 0xffd23b, stripe: 0xffe680, stripes: [-0.12, 0.1], speed: 110, behavior: 'skittish', weight: 1.8 },
      { key: 'moray', name: 'Moray Eel', rank: 4, shape: 'eel', body: 0x4f7a2e, belly: 0xb8d070, fin: 0x35561d, stripe: 0x2e4a18, stripes: [-0.3, -0.1, 0.1, 0.3], speed: 120, behavior: 'hunter', weight: 1 },
      { key: 'wrasse', name: 'Wrasse', rank: 5, shape: 'fat', body: 0x3fb8a8, belly: 0xbff0e0, fin: 0x2a8f86, stripe: 0x1f6b66, stripes: [-0.1, 0.15], speed: 100, behavior: 'cruise', weight: 1.5 },
      { key: 'jack', name: 'Jack', rank: 5, shape: 'oval', body: 0xb8c4cc, belly: 0xf2f6f8, fin: 0xe8c040, speed: 170, behavior: 'school', group: [2, 4], weight: 1.6 },
      { key: 'reefshark', name: 'Reef Shark', rank: 6, shape: 'torpedo', body: 0x8a96a0, belly: 0xeef2f4, fin: 0x5a6670, speed: 140, behavior: 'hunter', weight: 1 },
      { key: 'tarpon', name: 'Tarpon', rank: 6, shape: 'oval', body: 0xc9d6de, belly: 0xffffff, fin: 0x8a9cab, stripe: 0xa8b8c4, stripes: [-0.25, 0, 0.25], speed: 150, behavior: 'skittish', weight: 1.6 },
      { key: 'goliath', name: 'Goliath Grouper', rank: 7, shape: 'fat', body: 0x6b5a3a, belly: 0xb8a578, fin: 0x4f4228, stripe: 0x3e3220, stripes: [-0.25, 0.05, 0.3], speed: 80, behavior: 'hunter', weight: 1 },
      { key: 'bumphead', name: 'Bumphead', rank: 7, shape: 'fat', body: 0x5f8f6a, belly: 0xc9e0c0, fin: 0x3f6f4a, speed: 90, behavior: 'cruise', group: [2, 3], weight: 1.4 },
      { key: 'trevally', name: 'Giant Trevally', rank: 8, shape: 'oval', body: 0x4a5a66, belly: 0xc8d2d8, fin: 0x2e3a44, speed: 160, behavior: 'hunter', weight: 1 },
      { key: 'humphead', name: 'Humphead Wrasse', rank: 8, shape: 'fat', body: 0x2f8fa8, belly: 0x9fe0e8, fin: 0x1f6f88, stripe: 0x56c0d8, stripes: [-0.2, 0, 0.2], speed: 95, behavior: 'skittish', weight: 1.6 },
      { key: 'tiger', name: 'Tiger Shark', rank: 9, shape: 'torpedo', body: 0x7d8a6a, belly: 0xe8eadc, fin: 0x5d6a4a, stripe: 0x4a5538, stripes: [-0.3, -0.15, 0, 0.15], speed: 130, behavior: 'hunter', weight: 1 },
      { key: 'sunfish', name: 'Sunfish', rank: 9, shape: 'disc', body: 0x9aa4ae, belly: 0xdfe4e8, fin: 0x7f8a94, speed: 60, behavior: 'cruise', weight: 1.4 },
      { key: 'whaleshark', name: 'Whale Shark', rank: 10, shape: 'torpedo', body: 0x34567a, belly: 0xe6eef4, fin: 0x2a4562, stripe: 0xd8e6f0, stripes: [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3], speed: 70, behavior: 'cruise', weight: 1.3 },
      { key: 'sawfish', name: 'Sawfish', rank: 10, shape: 'eel', body: 0x9a8f78, belly: 0xe8e0cc, fin: 0x7a705c, speed: 120, behavior: 'hunter', weight: 1 },
      { key: 'bullshark', name: 'Bull Shark', rank: 11, shape: 'torpedo', body: 0x6f7a80, belly: 0xdfe4e6, fin: 0x56626a, speed: 135, behavior: 'hunter', weight: 1.1 },
      { key: 'oarfish', name: 'Oarfish', rank: 11, shape: 'eel', body: 0xd8dde4, belly: 0xf4f6f8, fin: 0xff4d4d, speed: 80, behavior: 'cruise', weight: 0.8 },
    ],
    levels: [
      { name: 'Coral Garden', sub: 'Coral as far as you can see', landmark: 'garden', coral: 220, rocks: 0.6, weed: 0.6, spires: 10, rays: 9,
        water: { top: 0x8be3f2, bottom: 0x1d86b0 }, floor: 0xf2d9a0, mix: { butterfly: 1.5 } },
      { name: 'Sandy Shallows', sub: 'Open sand and seagrass, nowhere to hide', landmark: 'grass', coral: 50, rocks: 0.4, weed: 3, spires: 4, rays: 14,
        water: { top: 0xb5f3f0, bottom: 0x3aa7c2 }, floor: 0xfbe9bd, mix: { jack: 2, trigger: 1.5 } },
      { name: 'Shipwreck Cove', sub: 'Something big sank here long ago', landmark: 'wreck', coral: 110, rocks: 1, weed: 1, spires: 8, rays: 7,
        water: { top: 0x6fd0d8, bottom: 0x13627e }, floor: 0xd8c497, mix: { goliath: 2, moray: 1.5, snapper: 1.5 } },
      { name: 'Arch Rocks', sub: 'Stone arches and tall spires', landmark: 'arches', coral: 120, rocks: 1.6, weed: 0.8, spires: 16, rays: 8,
        water: { top: 0x9ad9f0, bottom: 0x2a6fa8 }, floor: 0xe6d3b0, mix: { trevally: 1.5, humphead: 1.4 } },
      { name: 'The Drop-off', sub: 'The reef ends in a wall over deep blue', landmark: 'wall', coral: 140, rocks: 1, weed: 0.6, spires: 6, rays: 6,
        water: { top: 0x5fc4e6, bottom: 0x0b4a80 }, floor: 0xcfc0a0, mix: { whaleshark: 1.5, bullshark: 1.2 } },
    ],
  },
];

// ---------- The skill tree ----------
// 3 branches of 5 nodes. You get 1 point per level cleared. Node n of a branch costs n points and needs node n-1,
// so a full branch costs 15 and everything costs 45: a full run (25 levels) can't buy it all.
// mods: numbers multiply these stats: speed, reach, growth, boostRecharge (time), boostTime, variants, notice, chase,
// stun; and add to these: shields, gulps, secondWind, refund, comboGap, comboMax. true switches a power on.
const SKILLS = [
  { key: 'fins', name: 'Fins', color: '#4fc3ff', nodes: [
    { name: 'Fast Fins', desc: '+12% swim speed', mods: { speed: 1.12 } },
    { name: 'Quick Charge', desc: 'Boost recharges 30% faster', mods: { boostRecharge: 0.7 } },
    { name: 'Long Boost', desc: 'Boosts last 60% longer', mods: { boostTime: 1.6 } },
    { name: 'Afterburn', desc: 'Each bite during a boost gives back a third of the charge', mods: { refund: 0.35 } },
    { name: 'Torpedo', desc: 'While boosting you can eat fish your own size', mods: { torpedo: true } },
  ] },
  { key: 'jaws', name: 'Jaws', color: '#ff7a2f', nodes: [
    { name: 'Big Mouth', desc: 'Bite from 20% further away', mods: { reach: 1.2 } },
    { name: 'Glutton', desc: '+25% growth from every bite', mods: { growth: 1.25 } },
    { name: 'Frenzy', desc: 'Combos last 1 s longer and go up to ×12', mods: { comboGap: 1, comboMax: 4 } },
    { name: 'Treasure Nose', desc: 'Rare fish show up 2.5× as often', mods: { variants: 2.5 } },
    { name: 'Gulp', desc: 'Once per level, swallow a fish one size bigger than you', mods: { gulps: 1 } },
  ] },
  { key: 'scales', name: 'Scales', color: '#2ec98a', nodes: [
    { name: 'Camouflage', desc: 'Hunters notice you 35% later', mods: { notice: 0.65 } },
    { name: 'Tough Skin', desc: 'Stings stun you half as long', mods: { stun: 0.5 } },
    { name: 'Spines', desc: 'Once per level, a bite on you gets spat out', mods: { shields: 1 } },
    { name: 'Slippery', desc: 'Hunters give up 40% sooner', mods: { chase: 0.6 } },
    { name: 'Second Wind', desc: 'Once per run, survive being eaten', mods: { secondWind: 1 } },
  ] },
];
// Owning both nodes unlocks a bonus. Node ids are branch key + number, e.g. fins2.
const COMBOS = [
  { key: 'frenzyFuel', name: 'Feeding Frenzy', needs: ['fins2', 'jaws3'], desc: 'Every ×5 combo refills your boost' },
  { key: 'ghost', name: 'Ghost', needs: ['fins1', 'scales1'], desc: 'While boosting, hunters lose track of you' },
  { key: 'sharkSkin', name: 'Shark Skin', needs: ['jaws2', 'scales2'], desc: 'Spiny fish never sting you and give ×3 growth' },
  { key: 'hoarder', name: 'Hoarder', needs: ['jaws4', 'scales3'], desc: 'Eating a golden fish regrows your Spines' },
];

// ---------- Classes: the kind of fish you start as ----------
// mods work like skill mods; free: a node you start with; unlock: what opens it up (best level reached, or best
// score in one run). spec: how it looks.
const CLASSES = [
  { key: 'scamp', name: 'Scamp', desc: 'An all-rounder', mods: {}, free: null, unlock: null,
    spec: { shape: 'oval', body: 0xff7a2f, belly: 0xffe0b0, fin: 0xff4d4d, stripe: 0xffffff, stripes: [0.18], eye: 1.35 } },
  { key: 'dart', name: 'Dart', desc: '+20% speed and a quicker boost, but a smaller bite', mods: { speed: 1.2, boostRecharge: 0.85, reach: 0.85 }, free: 'fins1',
    unlock: { level: 3, text: 'Reach level 3' },
    spec: { shape: 'long', body: 0x7fb2d6, belly: 0xeaf6ff, fin: 0x3d7fb8, stripe: 0x2a5d8a, stripes: [-0.3, 0.3], eye: 1.6 } },
  { key: 'puffy', name: 'Puffy', desc: 'Survives one bite per level, but 15% slower', mods: { speed: 0.85, shields: 1 }, free: 'scales1',
    unlock: { level: 6, text: 'Clear all 5 reef levels' },
    spec: { shape: 'round', body: 0x9be36b, belly: 0xf2ffd8, fin: 0x5aa83a, stripe: 0x4f8a2f, stripes: [0], eye: 1.3 } },
  { key: 'gobbler', name: 'Gobbler', desc: 'A huge bite and +20% growth, but a slow boost', mods: { reach: 1.25, growth: 1.2, boostRecharge: 1.25 }, free: 'jaws1',
    unlock: { score: 20000, text: 'Score 20,000 in one run' },
    spec: { shape: 'fat', body: 0x8f6bd8, belly: 0xe9dcff, fin: 0xc05ad6, stripe: 0x5d3fa8, stripes: [-0.25, 0.1], eye: 1.25 } },
];
