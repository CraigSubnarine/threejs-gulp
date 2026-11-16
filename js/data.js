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
const WORLD = { x: 6600, y: 1400 };   // half-width and half-height (a wide sea to explore, about 7 screens across)
// Rock pillars and arches on the play plane: you and the fish can't swim through them, so prey can be cornered
// against them (and you can hide behind them). count per level; clear: no obstacles this close to where you start.
const OBSTACLES = { count: 13, clear: 1400, crackedEvery: 3 }; // every 3rd pillar is cracked: boost into it to smash it
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
const SHAPE_R = { oval: 0.3, disc: 0.36, fat: 0.33, long: 0.2, round: 0.38, torpedo: 0.24, eel: 0.15, orca: 0.3, jelly: 0.34 }; // touch radius, as a share of length

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
// lunge: shake, then dash at you; flurry: three quick short lunges; ambush (lair apexes): a hole glows and shakes, it
// strikes out and stays stretched out (bite its tail!), then pulls back in; double: two holes in a row; charge: it swims
// off the side of the screen, a "!" shows at the edge, then it charges straight across.
const APEX_ATTACKS = ['lunge', 'flurry', 'ambush', 'double', 'charge'];

// Oysters on the sea floor (perLevel each level): closed, then open with a pearl showing, then a shiver (the tell),
// then they snap shut (seconds for each). A pearl is worth white/black × the level in points and counts 1 or
// blackPearls towards your next bonus skill point. The snap catches a fish of catchTier or smaller (that's the end
// of the run, unless something saves you); a bigger you just gets pinched. size: the shell's width.
const OYSTER = { perLevel: 2, closed: 3, open: 2.5, tell: 0.6, snap: 0.4, regrow: 15, white: 500, black: 2500, blackChance: 0.2, blackPearls: 3, catchTier: 1, pinch: 0.6, size: 170 };
// Jellyfish stings: seconds stunned (× Tough Skin), seconds before another can sting, and how hard it shoves you.
const JELLY = { stun: 1, again: 1.2, push: 450 };
const PEARLS_PER_POINT = 5; // every 5 pearls: +1 skill point

// Power-ups: a bubble drifts down from the top of the view about every `every` seconds (at most one at a time) and
// pops after `life` seconds. w: how often each kind comes up; time: seconds it lasts.
const PICKUPS = {
  every: 20, life: 12, fall: 70,
  kinds: {
    shock: { name: 'Shock', w: 1, time: 3, range: 900, symbol: '⚡', color: '#ffb000', desc: 'fish near you go limp' },
    shrink: { name: 'Shrink', w: 1, time: 6, symbol: '▼', color: '#b36bff', desc: 'fish one size bigger than you shrink into food' },
    rush: { name: 'Rush', w: 1, time: 6, speed: 1.5, symbol: '»', color: '#1fb5ff', desc: 'swim 50% faster' },
    shield: { name: 'Bubble Shield', w: 0.8, symbol: '◎', color: '#2ec98a', desc: 'survive the next bite' },
  },
};

// Each level hides a shard in a wreck, somewhere out in the wide sea (at least wreckFrom × the half-width from where
// you start). Five shards (one per level of a world) make an orb, which opens a portal after the apex. Missing
// ones: the portal stays dark and the world replays, faster; the shards you have are kept. At the portal you keep
// some skills for the next world: keep.base, plus one per keep.pearls pearls found in this world, up to keep.max.
// worldHue: each new world's water is tinted a little further round the colour wheel.
const SHARDS = { wreckFrom: 0.4, points: 1000, keep: { base: 1, pearls: 10, max: 3 }, worldHue: 0.12 };

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
// | jelly (a jellyfish: drifts, can't be eaten at any size, and stings you on touch: JELLY)
// rank: place on the zone's size ladder (see the top of this file); every rank 0-11 needs at least one species.
// Each zone has LEVELS_PER_ZONE levels: its own spot with a look (water, floor, props, landmark) and a fish mix
// (weights multiplied for that level).
const ZONES = [
  {
    key: 'reef', name: 'Sunny Reef', sub: 'Warm, shallow and full of snacks',
    water: { top: 0x8be3f2, bottom: 0x1d86b0 }, sun: 1.9, sky: 0xd8f8ff, ground: 0x3a8fa8, floor: 0xf2d9a0,
    // size: × a full-grown you; speed: circling speed × your base speed (apexes that chase); lunge: dash speed × your base speed;
    // tell: seconds of shaking before a lunge. Taunts are original lines.
    // lair: it lives in the level's wreck and strikes out of its holes (attacks: ambush, double) instead of chasing.
    // touch: its body's radius for bites, × its length (a slim serpent).
    apex: { key: 'moray', name: 'The Giant Moray', short: 'Moray', size: 4.2, hp: 6, lunge: 2.6, tell: 0.9, lair: true, touch: 0.07,
      phases: [['ambush'], ['ambush', 'double']],
      intro: 'You swam into MY wreck? Bold little snack.', rage: 'OW! Right, no more hiding.', defeat: 'Fine... the wreck is yours.',
      spec: { shape: 'eel', serpent: true, thick: 0.05, body: 0x5f7f2c, belly: 0xd0dc80, fin: 0x445f1f, stripe: 0x3a5418 } }, // a long rippling serpent (makeSerpent in art.js)
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
  {
    // World 2, through the portal. Its hazard is jellyfish: they can't be eaten, at any size, and touching one
    // stings you (a stun and a shove). Kelp sways behind the play area; palette: the anemones and sponges.
    key: 'kelp', name: 'Kelp Forest', sub: 'Tall, swaying and full of hiding places',
    water: { top: 0x86dcc0, bottom: 0x0f4a52 }, sun: 1.5, sky: 0xd0ffe8, ground: 0x2a6a5a, floor: 0xc0b088,
    palette: [0xc0504a, 0xe08a3a, 0x9a5ab8, 0xd8b04a, 0x5aa88a, 0xb83a5a], kelpColors: [0x7a8a2a, 0x9a8a32, 0x6a7a24],
    // charge: it swims off the side of the screen, a "!" shows at the edge, then it charges straight across.
    apex: { key: 'leopard', name: 'The Leopard Shark', short: 'Leopard Shark', size: 2.8, hp: 8, speed: 0.8, lunge: 2.6, tell: 0.7,
      phases: [['lunge', 'charge'], ['lunge', 'flurry', 'charge']],
      intro: 'Spots, teeth, and a forest full of snacks. All mine.', rage: 'Enough circling. Now I hunt.', defeat: 'The kelp... is yours...',
      spec: { shape: 'torpedo', body: 0x9a9080, belly: 0xf2ede4, fin: 0x7a7060, stripe: 0x2a241c, stripes: [-0.32, -0.22, -0.12, -0.02, 0.08, 0.18], eye: 0.8, teeth: true, dorsal: 1.6 } },
    // The kelp's size ladder, smallest first (two fish per rank, plus a jellyfish at ranks 1, 5 and 9).
    fish: [
      { key: 'anchovy', name: 'Anchovy', rank: 0, shape: 'long', body: 0x9fb8c8, belly: 0xf2f8fb, fin: 0x7f98a8, speed: 150, behavior: 'school', group: [5, 8], weight: 3 },
      { key: 'blenny', name: 'Kelp Blenny', rank: 0, shape: 'long', body: 0x8a9a3a, belly: 0xd8e0a0, fin: 0x6a7a2a, speed: 90, behavior: 'skittish', weight: 1.5 },
      { key: 'senorita', name: 'Señorita', rank: 1, shape: 'long', body: 0xf2c84a, belly: 0xfff0c0, fin: 0xd8a830, stripe: 0x5a3a20, stripes: [0.3], speed: 120, behavior: 'skittish', weight: 2 },
      { key: 'surfperch', name: 'Surfperch', rank: 1, shape: 'disc', body: 0x8fa0b8, belly: 0xe0e8f0, fin: 0x6a7a90, stripe: 0x4a6a9a, stripes: [-0.15, 0, 0.15], speed: 110, behavior: 'school', group: [2, 4], weight: 1.8 },
      { key: 'moonjelly', name: 'Moon Jelly', rank: 1, shape: 'jelly', body: 0xd8c8ff, belly: 0xffffff, fin: 0xb8a0ff, glow: 0x5a3a90, speed: 35, behavior: 'jelly', weight: 0.9 },
      { key: 'garibaldi', name: 'Garibaldi', rank: 2, shape: 'oval', body: 0xff7a1a, belly: 0xffb060, fin: 0xff6a00, speed: 120, behavior: 'cruise', weight: 1.6 },
      { key: 'kelpbass', name: 'Kelp Bass', rank: 2, shape: 'oval', body: 0x6a6a4a, belly: 0xd0c8a0, fin: 0x4a4a30, stripe: 0xc8c090, stripes: [-0.2, 0, 0.2], speed: 120, behavior: 'hunter', weight: 0.9 },
      { key: 'rockfish', name: 'Blue Rockfish', rank: 3, shape: 'fat', body: 0x4a5a7a, belly: 0xa8b4c8, fin: 0x3a4a6a, speed: 90, behavior: 'cruise', group: [1, 3], weight: 1.3 },
      { key: 'opaleye', name: 'Opaleye', rank: 3, shape: 'oval', body: 0x3a6a5a, belly: 0xa8c8b8, fin: 0x2a5a4a, speed: 130, behavior: 'school', group: [2, 4], weight: 1.3 },
      { key: 'sheephead', name: 'Sheephead', rank: 4, shape: 'fat', body: 0x2a2a30, belly: 0xff8a8a, fin: 0x1a1a20, stripe: 0xe85a5a, stripes: [-0.1, 0.05], speed: 100, behavior: 'cruise', weight: 1.5 },
      { key: 'cabezon', name: 'Cabezon', rank: 4, shape: 'fat', body: 0x7a5a3a, belly: 0xc8b088, fin: 0x5a4028, stripe: 0x4a3420, stripes: [-0.25, 0, 0.25], speed: 85, behavior: 'hunter', weight: 1 },
      { key: 'halfmoon', name: 'Halfmoon', rank: 5, shape: 'disc', body: 0x4a6a9a, belly: 0xb8c8e0, fin: 0x3a5a8a, speed: 120, behavior: 'skittish', weight: 1.6 },
      { key: 'lingcod', name: 'Lingcod', rank: 5, shape: 'long', body: 0x6a7a5a, belly: 0xc8d0b0, fin: 0x4a5a3a, stripe: 0x4a5432, stripes: [-0.3, -0.1, 0.1, 0.3], speed: 130, behavior: 'hunter', weight: 1, teeth: true },
      { key: 'nettle', name: 'Sea Nettle', rank: 5, shape: 'jelly', body: 0xffb04a, belly: 0xffe0b0, fin: 0xd86a20, glow: 0x6a3010, speed: 30, behavior: 'jelly', weight: 0.9 },
      { key: 'hornshark', name: 'Horn Shark', rank: 6, shape: 'torpedo', body: 0x8a7a5a, belly: 0xe0d8c0, fin: 0x6a5a40, stripe: 0x5a4a30, stripes: [-0.2, 0.1], speed: 100, behavior: 'hunter', weight: 1 },
      { key: 'batray', name: 'Bat Ray', rank: 6, shape: 'disc', body: 0x3a3a3a, belly: 0xe8e8e8, fin: 0x2a2a2a, speed: 90, behavior: 'cruise', weight: 1.4 },
      { key: 'seabass', name: 'Giant Sea Bass', rank: 7, shape: 'fat', body: 0x4a4a52, belly: 0xb8b8c0, fin: 0x34343a, stripe: 0x2a2a30, stripes: [-0.25, 0.05, 0.3], speed: 80, behavior: 'hunter', weight: 1 },
      { key: 'yellowtail', name: 'Yellowtail', rank: 7, shape: 'oval', body: 0x7a9ab0, belly: 0xf0f4f8, fin: 0xffd23b, stripe: 0xffd23b, stripes: [0], speed: 170, behavior: 'school', group: [2, 4], weight: 1.5 },
      { key: 'wolfeel', name: 'Wolf Eel', rank: 8, shape: 'eel', body: 0x7a8088, belly: 0xb8bcc0, fin: 0x5a6068, stripe: 0x3a4048, stripes: [-0.3, -0.15, 0, 0.15, 0.3], speed: 110, behavior: 'hunter', weight: 1, teeth: true },
      { key: 'bonito', name: 'Bonito', rank: 8, shape: 'torpedo', body: 0x3a5a8a, belly: 0xe0e8f0, fin: 0x2a4a7a, stripe: 0x2a3a5a, stripes: [-0.2, -0.05, 0.1], speed: 180, behavior: 'skittish', weight: 1.6 },
      { key: 'soupfin', name: 'Soupfin Shark', rank: 9, shape: 'torpedo', body: 0x7a8a96, belly: 0xeef0f2, fin: 0x5a6a76, speed: 140, behavior: 'hunter', weight: 1 },
      { key: 'bluefin', name: 'Bluefin Tuna', rank: 9, shape: 'torpedo', body: 0x24406a, belly: 0xd8e4ee, fin: 0xffd23b, speed: 170, behavior: 'cruise', group: [1, 3], weight: 1.4 },
      { key: 'lionsmane', name: 'Lion\'s Mane Jelly', rank: 9, shape: 'jelly', body: 0xe86a3a, belly: 0xffc0a0, fin: 0xb8401a, glow: 0x5a2010, speed: 25, behavior: 'jelly', weight: 0.7 },
      { key: 'sevengill', name: 'Sevengill Shark', rank: 10, shape: 'torpedo', body: 0x6a6e5a, belly: 0xd8dac8, fin: 0x4e5240, stripe: 0x3a3e2e, stripes: [-0.25, 0, 0.2], speed: 125, behavior: 'hunter', weight: 1 },
      { key: 'opah', name: 'Opah', rank: 10, shape: 'disc', body: 0xb84a5a, belly: 0xe8c0c8, fin: 0xff3b3b, speed: 90, behavior: 'cruise', weight: 1.3 },
      { key: 'thresher', name: 'Thresher Shark', rank: 11, shape: 'torpedo', body: 0x5a6a8a, belly: 0xe8eef4, fin: 0x4a5a7a, speed: 140, behavior: 'hunter', weight: 1.1 },
      { key: 'basking', name: 'Basking Shark', rank: 11, shape: 'torpedo', body: 0x5a5e66, belly: 0xc8ccd2, fin: 0x44484e, speed: 70, behavior: 'cruise', weight: 1 },
    ],
    // kelp: how many strands sway behind the play area.
    levels: [
      { name: 'Kelp Edge', sub: 'Where the forest meets the open sand', landmark: 'kelpEdge', kelp: 70, coral: 60, rocks: 1.2, weed: 1.5, spires: 6, rays: 9,
        water: { top: 0x9ae4c8, bottom: 0x1a6a6a }, floor: 0xd8c8a0, mix: { anchovy: 1.5 } },
      { name: 'Garibaldi Rocks', sub: 'Boulders, bright orange fish and sea stars', landmark: 'boulders', kelp: 110, coral: 70, rocks: 2, weed: 1, spires: 10, rays: 8,
        water: { top: 0x86dcc0, bottom: 0x0f5a5a }, floor: 0xc8b890, mix: { garibaldi: 2, cabezon: 1.5 } },
      { name: 'The Canopy', sub: 'Kelp all the way to the surface', landmark: 'canopy', kelp: 190, coral: 40, rocks: 1, weed: 2, spires: 5, rays: 12,
        water: { top: 0x7ad4a8, bottom: 0x0c4a44 }, floor: 0xb8a878, mix: { seabass: 1.5, yellowtail: 1.5 } },
      { name: 'Urchin Barren', sub: 'Purple urchins ate the forest here', landmark: 'barren', kelp: 30, coral: 30, rocks: 1.6, weed: 0.3, spires: 8, rays: 9,
        water: { top: 0x8ac8d0, bottom: 0x14485a }, floor: 0xa8a090, mix: { wolfeel: 1.5, bonito: 1.4 } },
      { name: 'The Deep Stand', sub: 'Ancient kelp in the cold and dark', landmark: 'stand', kelp: 150, coral: 50, rocks: 1, weed: 0.8, spires: 6, rays: 5,
        water: { top: 0x5ab0a0, bottom: 0x082e3a }, floor: 0x9a9070, mix: { thresher: 1.3, sevengill: 1.3 } },
    ],
  },
];

// ---------- The skill tree ----------
// Three branches, each a web of 10 nodes on a 3-column grid (col -1, 0, 1; row 0 at the top): a spine down the
// middle with side nodes branching off it. A node opens once you own ANY one of the nodes in its `needs`, so paths
// split and join again. Its cost goes by its row (ROW_COST). Points come from levels (1 each), pearls (1 per 5) and
// apexes (1 each): about 10 a world, against about 23 to fill a single branch, so each world you pick a direction.
// The portal resets the tree (you keep a skill or two), so the next world can try another.
// mods: numbers multiply speed, reach, growth, boostRecharge (time), boostTime, boostSpeed, variants, notice, chase,
// stun, oysterOpen, pearlMul; and add to shields, gulps, secondWind, refund, comboGap, comboMax, apexDamage,
// boostCharges, regrow (seconds). true switches a power on. icon: a glyph from ui.js.
const ROW_COST = [1, 1, 2, 3, 4];
const SKILLS = [
  { key: 'scales', name: 'Scales', color: '#4fe07a', emblem: 'target', blurb: 'Survive', nodes: [
    { id: 'camouflage', name: 'Camouflage', row: 0, col: 0, needs: [], icon: 'eye', desc: 'Hunters notice you 35% later', mods: { notice: 0.65 } },
    { id: 'toughSkin', name: 'Tough Skin', row: 1, col: -1, needs: ['camouflage'], icon: 'shield', desc: 'Stings and pinches stun you half as long', mods: { stun: 0.5 } },
    { id: 'inkCloud', name: 'Ink Cloud', row: 1, col: 1, needs: ['camouflage'], icon: 'cloud', desc: 'When a hunter starts to chase you, a puff of ink makes it lose you (every 10 s)', mods: { ink: true } },
    { id: 'oysterProof', name: 'Oyster Proof', row: 2, col: -1, needs: ['toughSkin'], icon: 'shell', desc: 'Oysters can\'t catch you, whatever your size', mods: { oysterProof: true } },
    { id: 'spines', name: 'Spines', row: 2, col: 0, needs: ['toughSkin', 'inkCloud'], icon: 'spikes', desc: 'Once per level, a bite on you gets spat out', mods: { shields: 1 } },
    { id: 'mimic', name: 'Mimic', row: 2, col: 1, needs: ['inkCloud'], icon: 'rock', desc: 'Hunters ignore you while you hold still', mods: { mimic: true } },
    { id: 'slippery', name: 'Slippery', row: 3, col: -1, needs: ['oysterProof', 'spines'], icon: 'drop', desc: 'Hunters give up 40% sooner', mods: { chase: 0.6 } },
    { id: 'shellUp', name: 'Shell Up', row: 3, col: 1, needs: ['spines', 'mimic'], icon: 'bubble', desc: 'Start every level with one more shield', mods: { shields: 1 } },
    { id: 'regrow', name: 'Regrow', row: 4, col: -1, needs: ['slippery'], icon: 'regrow', desc: 'A used shield grows back after 45 s', mods: { regrow: 45 } },
    { id: 'secondWind', name: 'Second Wind', row: 4, col: 0, needs: ['slippery', 'shellUp'], icon: 'heart', desc: 'Once per world, survive being eaten', mods: { secondWind: 1 } },
  ] },
  { key: 'jaws', name: 'Jaws', color: '#ff5a4a', emblem: 'skull', blurb: 'Hunt', nodes: [
    { id: 'bigMouth', name: 'Big Mouth', row: 0, col: 0, needs: [], icon: 'mouth', desc: 'Bite from 20% further away', mods: { reach: 1.2 } },
    { id: 'glutton', name: 'Glutton', row: 1, col: -1, needs: ['bigMouth'], icon: 'bowl', desc: '+25% growth from every bite', mods: { growth: 1.25 } },
    { id: 'pearlDiver', name: 'Pearl Diver', row: 1, col: 1, needs: ['bigMouth'], icon: 'pearl', desc: 'Oysters stay open 60% longer, and pearls count double', mods: { oysterOpen: 1.6, pearlMul: 2 } },
    { id: 'frenzy', name: 'Frenzy', row: 2, col: -1, needs: ['glutton'], icon: 'star', desc: 'Combos last 1 s longer and go up to ×12', mods: { comboGap: 1, comboMax: 4 } },
    { id: 'sharpTeeth', name: 'Sharp Teeth', row: 2, col: 0, needs: ['glutton', 'pearlDiver'], icon: 'tooth', desc: '+1 damage on every bite on an apex', mods: { apexDamage: 1 } },
    { id: 'magnet', name: 'Magnet', row: 2, col: 1, needs: ['pearlDiver'], icon: 'magnet', desc: 'Pearls, power-ups and shards are pulled towards you', mods: { magnet: true } },
    { id: 'ironJaw', name: 'Iron Jaw', row: 3, col: -1, needs: ['frenzy', 'sharpTeeth'], icon: 'jaw', desc: 'Spiny fish don\'t sting, and puffed-up puffers are still food', mods: { ironJaw: true } },
    { id: 'shardSense', name: 'Shard Sense', row: 3, col: 1, needs: ['sharpTeeth', 'magnet'], icon: 'compass', desc: 'An arrow at the edge of the screen points to the level\'s shard', mods: { shardSense: true } },
    { id: 'treasureNose', name: 'Treasure Nose', row: 4, col: 1, needs: ['shardSense'], icon: 'gem', desc: 'Rare fish show up 2.5× as often', mods: { variants: 2.5 } },
    { id: 'gulp', name: 'Gulp', row: 4, col: 0, needs: ['ironJaw', 'shardSense'], icon: 'gulp', desc: 'Once per level, swallow a fish one size bigger than you', mods: { gulps: 1 } },
  ] },
  { key: 'fins', name: 'Fins', color: '#ffd23b', emblem: 'bolt', blurb: 'Speed', nodes: [
    { id: 'fastFins', name: 'Fast Fins', row: 0, col: 0, needs: [], icon: 'fin', desc: '+12% swim speed', mods: { speed: 1.12 } },
    { id: 'quickCharge', name: 'Quick Charge', row: 1, col: -1, needs: ['fastFins'], icon: 'gauge', desc: 'Boost recharges 30% faster', mods: { boostRecharge: 0.7 } },
    { id: 'slipstream', name: 'Slipstream', row: 1, col: 1, needs: ['fastFins'], icon: 'wind', desc: 'Boosts are 25% faster', mods: { boostSpeed: 1.25 } },
    { id: 'doubleDash', name: 'Double Dash', row: 2, col: -1, needs: ['quickCharge'], icon: 'double', desc: 'Hold two boost charges', mods: { boostCharges: 1 } },
    { id: 'longBoost', name: 'Long Boost', row: 2, col: 0, needs: ['quickCharge', 'slipstream'], icon: 'arrow', desc: 'Boosts last 60% longer', mods: { boostTime: 1.6 } },
    { id: 'wake', name: 'Wake', row: 2, col: 1, needs: ['slipstream'], icon: 'wave', desc: 'Boosting past a fish knocks it out for a moment', mods: { wake: true } },
    { id: 'afterburn', name: 'Afterburn', row: 3, col: -1, needs: ['doubleDash', 'longBoost'], icon: 'flame', desc: 'Each bite during a boost gives back a third of the charge', mods: { refund: 0.35 } },
    { id: 'ghostFin', name: 'Ghost Fin', row: 3, col: 1, needs: ['longBoost', 'wake'], icon: 'ghost', desc: 'For 2 s after a boost, hunters can\'t see you', mods: { ghostFin: true } },
    { id: 'jetStream', name: 'Jet Stream', row: 4, col: -1, needs: ['afterburn'], icon: 'jet', desc: '+15% swim speed', mods: { speed: 1.15 } },
    { id: 'torpedo', name: 'Torpedo', row: 4, col: 0, needs: ['afterburn', 'ghostFin'], icon: 'torpedo', desc: 'While boosting you can eat fish your own size', mods: { torpedo: true } },
  ] },
];
// Owning both nodes unlocks a bonus.
const COMBOS = [
  { key: 'frenzyFuel', name: 'Feeding Frenzy', needs: ['quickCharge', 'frenzy'], desc: 'Every ×5 combo refills your boost' },
  { key: 'ghost', name: 'Ghost', needs: ['fastFins', 'camouflage'], desc: 'While boosting, hunters lose track of you' },
  { key: 'sharkSkin', name: 'Shark Skin', needs: ['glutton', 'toughSkin'], desc: 'Spiny fish never sting you and give ×3 growth' },
  { key: 'hoarder', name: 'Hoarder', needs: ['treasureNose', 'spines'], desc: 'Eating a golden fish regrows a used shield' },
];

// ---------- Classes: the kind of fish you start as ----------
// You start as a young one (tier 1) whatever you are. mods work like skill mods; free: a skill you start with (and
// keep through portals); unlock: what opens it up (best level reached, beating an apex, opening a portal).
// spec: how it looks.
const CLASSES = [
  { key: 'shark', name: 'Shark', desc: 'An all-rounder with a bigger bite', mods: { reach: 1.12 }, free: null, unlock: null,
    spec: { shape: 'torpedo', body: 0x6f8494, belly: 0xf1f5f8, fin: 0x52687a, eye: 1.2, dorsal: 1.7 } },
  { key: 'barracuda', name: 'Barracuda', desc: '+20% speed and a quicker boost, but a smaller bite', mods: { speed: 1.2, boostRecharge: 0.8, reach: 0.85 }, free: 'fastFins',
    unlock: { level: 3, text: 'Reach level 3' },
    spec: { shape: 'torpedo', body: 0x8fa3b4, belly: 0xeef4f8, fin: 0x4f6a7c, stripe: 0x34495a, stripes: [-0.3, -0.15, 0, 0.15], eye: 1.3, teeth: true } },
  { key: 'orca', name: 'Orca', desc: 'Tough: survives one bite per level, but 13% slower', mods: { speed: 0.87, shields: 1 }, free: 'camouflage',
    unlock: { apex: true, text: 'Beat the reef\'s apex' },
    spec: { shape: 'orca', body: 0x16181d, belly: 0xf4f6f8, fin: 0x16181d, eye: 0.9, dorsal: 2.2, patch: true } },
  { key: 'swordfish', name: 'Swordfish', desc: 'Spear: eats fish its own size while boosting. The fastest boost, but a slow recharge', mods: { boostSpeed: 1.3, boostRecharge: 1.35, torpedo: true }, free: null,
    unlock: { portal: true, text: 'Open a portal' },
    spec: { shape: 'torpedo', body: 0x3b5f8f, belly: 0xdde8f2, fin: 0x2a4670, eye: 1.3, bill: true, dorsal: 1.4 } },
];
