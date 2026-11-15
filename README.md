# threejs-gulp

**Gulp!**: a fish-eat-fish game in three.js. You're a small fish: eat smaller fish to grow, and stay away from bigger ones. It has a 3D look with 2D gameplay: low-poly fish built in code, real lighting and underwater fog, and you swim on a flat side-view plane.

No build step and no asset files: three.js loads from a CDN through an import map, every fish and coral is built from simple 3D shapes in code, and the sounds are synthesized.

- **Play:** https://craigsubnarine.github.io/threejs-gulp/
- **Repo:** https://github.com/CraigSubnarine/threejs-gulp
- **Run locally:** the `gamedev` preview server at http://localhost:8765/threejs-gulp/ (or `node tools/server.js` from a script)
- **Controls:**
  - **Phone:** touch anywhere and drag, like a joystick. The further you drag, the faster you swim.
  - **Computer:** the fish follows the mouse, or use the arrow keys or WASD.
  - **Pause:** the top-right button, or Esc / P.
- **Status:** Step 1 of 3 is live: the Sunny Reef and the core loop. The full plan is in `GameDev/gulp-plan.md`.

## How it plays

- **The food chain:** every fish has a tier, from 0 (tiny fry) to 3. You start each zone at tier 1. You can eat fish below your tier, fish above it eat you, and fish at your tier just bump into you.
  - The bar at the top shows each of the zone's fish: green means food, red means danger.
- **Growing:** eating fills your meter. You grow a tier at each third, and the camera pulls back so you can see more. A full meter clears the zone.
- **One life:** if a bigger fish catches you, the run is over.
- **Combos:** eats less than 1.5 s apart multiply the points (up to ×8).
- **The Sunny Reef:**
  - Minnows come in schools and dart away.
  - Butterflyfish and parrotfish flee when you're bigger.
  - Groupers hunt you: a red "!" means one is chasing, and it gives up after a few seconds.
  - Pufferfish swell up into a danger when you swim close, so sneak up or wait for them to shrink.
- **Deeper:** clearing the reef pays a bonus and starts it again at the next depth, with faster fish.

## Replay and competition hooks

- A score, always: points per fish × combo, plus a clear bonus per depth. Your best score and depth are saved.
- Seeded spawns: each run has a seed, and the same seed gives the same sea (ready for a Daily Dive and leaderboards).
- Next (Steps 2-3): apex predator bosses, mutations between zones, 5 zones from the reef to the abyss, endless mode and the Daily Dive. Later: Supabase leaderboards.

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
