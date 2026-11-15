# threejs-gulp

**Gulp!**: a fish-eat-fish game in three.js. You're a small fish: eat smaller fish to grow, and stay away from bigger ones. It has a 3D look with 2D gameplay: low-poly fish built in code, real lighting and underwater fog, and you swim on a flat side-view plane.

No build step and no asset files: three.js loads from a CDN through an import map, every fish and coral is built from simple 3D shapes in code, and the sounds are synthesized.

- **Play:** https://craigsubnarine.github.io/threejs-gulp/
- **Repo:** https://github.com/CraigSubnarine/threejs-gulp
- **Run locally:** the `gamedev` preview server at http://localhost:8765/threejs-gulp/ (or `node tools/server.js` from a script)
- **Controls:**
  - **Phone:** touch anywhere and drag, like a joystick. The further you drag, the faster you swim. Tap **BOOST** (bottom right) for a burst of speed.
  - **Computer:** the fish follows the mouse, or use the arrow keys or WASD. Click or press Space to boost.
  - **Boost:** about half a second at 2.3× speed, the way you're steering. The button's ring then refills like a clock over 4 s, and it glows when it's ready (`BOOST` in `data.js`).
  - **Pause:** the top-right button, or Esc / P.
- **Status:** Step 3 is live: the Sunny Reef's 5 levels end with its apex predator, the Barracuda. Step 2 brought keeping your size between levels, more fish and rare variants, the skill tree and unlockable classes. Next is the Kelp Forest. The full plan is in `GameDev/gulp-plan.md`.

## How it plays

- **The food chain:** every fish has a tier, from 0 (tiny fry) to 3. You start each level at tier 1. You can eat fish below your tier, fish above it eat you, and fish at your tier just bump into you.
  - The bar at the top shows each of the zone's fish: green means food, red means danger.
- **Growing:** eating fills your meter. You grow a tier at each third, and the camera pulls back so you can see more. A full meter clears the level.
- **Keeping your size:** when a level clears, the camera pulls back while you stay the same size, so the view widens. Then the next level fades in. You're a tier-1 fish there, and its fish are bigger than the last level's, so you're back in the middle of the food chain.
  - Under the hood, every level is built at the same scale. The game rescales everything by 200/70 behind the fade, so the numbers never blow up.
- **One life:** if a bigger fish catches you, the run is over, unless a skill saves you.
- **Combos:** eats less than 1.5 s apart multiply the points (up to ×8).
- **The Sunny Reef** has 5 levels, each its own spot with its own colours, prop mix, fish mix and a landmark built in code:
  1. Coral Garden
  2. Sandy Shallows
  3. Shipwreck Cove
  4. Arch Rocks
  5. The Drop-off

  After level 5 comes the apex, then the reef starts over with faster fish, until the Kelp Forest is built.
- **The apex predator (the Barracuda):** filling level 5's meter brings it in with a taunt and a health bar, while the other fish clear off.
  - **Its tail is where you bite it.** Each bite takes 1 health, and boosting into it takes 2.
  - **Its jaws** (the front 40% of its body) eat you, unless Spines or Second Wind saves you.
  - **How it fights:** it circles you, then shakes with a red "!" and lunges at more than twice your speed. Right after a lunge it slows down: that's your chance.
  - **Phase 2:** at half health it gets angry (a new taunt), moves faster and adds a flurry of three quick lunges.
  - **Beating it** pays 3,000 × the level, plus a bonus skill point.
  - It's data plus an attack library (`apex` in `data.js`, `APEX_ATTACKS`): each later zone's apex is a model, some numbers and a list of attacks per phase.
- **The reef's fish:**
  - **Food:** minnows (schools that dart away) and gobies.
  - **Your size at first:** butterflyfish and damselfish.
  - **Puffers:** they swell into a danger when you're close.
  - **Bigger:** parrotfish, and triggerfish, which hunt you.
  - **Biggest:** groupers (hunters) and snappers.

  A red "!" means a hunter is chasing you; it gives up after a few seconds.
- **Rare variants (8%):**

  | Variant | Effect |
  |---|---|
  | Golden | ×5 points |
  | Spiny | stings you for a moment, but gives ×2 growth |
  | Speedy | fast and jumpy, ×2 points |
  | Giant | one size bigger |
- **Skill tree:** after each level you get 1 point.
  - **Branches:** Fins (speed and boost), Jaws (reach, growth, combos, rare fish) and Scales (survival). Each has 5 nodes.
  - **Cost:** node *n* costs *n* points and needs the node before it, so a full run can't buy everything (45 points vs about 25).
  - **Capstones:** Torpedo (eat your own size while boosting), Gulp (swallow one size bigger once per level) and Second Wind (survive being eaten once).
  - **Combos:** owning nodes in two branches unlocks a bonus, such as Feeding Frenzy, Ghost, Shark Skin or Hoarder.
- **Classes**, picked on the main menu:

  | Class | What it's like | Unlock |
  |---|---|---|
  | Scamp | all-rounder | open from the start |
  | Dart | fast, with a small bite | reach level 3 |
  | Puffy | survives a bite each level, but slower | clear the reef |
  | Gobbler | big bite and growth, but a slow boost | 20,000 points in one run |

## Replay and competition hooks

- A score, always: points per fish × combo, plus a clear bonus per level. Your best score and level are saved.
- Seeded spawns: each run has a seed, and the same seed gives the same sea and rare fish (ready for a Daily Dive and leaderboards).
- Build variety: 4 classes × a skill tree you can only partly fill.
- Next: apex predator bosses, then the Kelp Forest and deeper zones, endless mode and the Daily Dive. Later: Supabase leaderboards.

## Code layout

- `index.html`: the page, the import map, the menus and the HUD (all HTML/CSS).
- `js/data.js`: the world size, tiers, growth, score and the zones with their fish.
- `js/rules.js`: who eats whom, growth, score and the seeded spawner. Plain JS, tested in Node.
- `js/art.js`: fish, coral, rocks, light rays and bubbles, all built from three.js shapes.
- `js/ui.js`: saves, sound, menus and input (the floating joystick, mouse, keys).
- `js/game.js`: the scene, camera, game loop, player, fish behaviour, collisions and HUD.

## Testing

- `node tools/check.js`: checks the rules in Node (tiers, growth, combos, the spawner's seed and food share).
- `node tools/playtest.js`: plays the real page headlessly on a phone and a desktop screen. It covers:
  - the menus and settings
  - a real joystick drag, the mouse and the arrow keys
  - eating, combos and growing (with the camera pulling back)
  - the puffer and the hunter
  - pause and auto-pause
  - getting eaten and the game over screen
  - a bot that clears the reef

  WebGL runs in software (SwiftShader). Screenshots go to `playtest-output/` (git-ignored). See `GameDev/CLAUDE.md` for the `NODE_PATH` on this PC.

## What I learned

- **three.js with no build step:** an import map points `three` at the CDN. Plain scripts (data, rules, ui) load first and share globals, then the game loads as a module, which can still see those globals.
- **Low-poly fish from shapes:** a sphere stretched along x for the body (coloured belly to back with vertex colours), a flat extruded tail on a pivot that wags, fins, and sphere eyes. Build each species' geometry once and share it between every fish.
- **Side view in 3D:** everything plays on the z = 0 plane. Scenery sits behind it (z < 0), so the perspective camera gives parallax for free, and fog hides the far edge. Turning the fish slightly towards the camera shows off the 3D.
- **Growing = pulling the camera back:** the camera's distance sets how much of the plane you see (`viewHeight / 2 / tan(fov / 2)`).
- **Making a side view look 3D** (all cheap enough for phones):
  - **The camera tilts** down 22° and swings a few degrees as you swim, so you see the fish's backs, the floor recedes and the parallax always shows. The area on screen is then a trapezoid: four corner rays against z = 0 give the box used for spawning and despawning.
  - **The fish swim:** the body swings against the tail, and they bank into turns.
  - **Caustics:** a few lines of shader added to the standard material (`onBeforeCompile`).
  - **Depth layers:** rock spires in the middle distance and marine snow between you and the camera.
  - Tuning lives in `CAMERA` in `data.js`.
