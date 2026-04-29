# Sprite Specifications — The Flash-Step

All sprites are optional. If a file is missing or fails to load, the game falls back
to the procedural canvas shape automatically. Drop files into `sprites/` and they are
picked up on the next page load with no code changes.

---

## Format Requirements

| Property       | Value                              |
|----------------|------------------------------------|
| File type      | PNG                                |
| Transparency   | Required — fully transparent background |
| Color space    | sRGB                               |
| Bit depth      | 32-bit RGBA (8 bits per channel)   |
| Origin         | Top-left (standard PNG)            |

---

## Current Sprites

### `sprites/battery.png` — Collectible battery pickup

| Property       | Value                              |
|----------------|------------------------------------|
| Canvas size    | 64 × 160 px                        |
| Orientation    | Vertical (upright AA battery)      |
| Padding        | 6 px on all sides                  |
| Aspect ratio   | ~1 : 2.5 (width : height)          |

**Art reference:**
- AA battery standing upright
- Dark metallic grey cylindrical casing (approx `#42454a`)
- Gold / brass positive terminal nub on top (approx `#d0a220`)
- Flat black negative terminal ring on bottom
- Thin green vertical charge-indicator strip on the right side of the casing
- Subtle lighter highlight stripe on the left for cylindrical shading
- No cast shadow in the sprite itself — the renderer adds a floor pool glow

**Rendering notes:**
- The renderer scales this sprite to fit the projected screen height at the current
  distance. At 1 world unit the sprite is displayed at roughly `H × 0.15` px tall.
- The sprite is depth-tested column-by-column against the wall z-buffer, so it
  correctly disappears behind walls.
- A slow vertical bob (±12 % of sprite height, ~0.29 Hz) is applied by the renderer
  on top of the sprite position — design the art without built-in motion.
- An amber radial floor-glow and a dark-range ambient glow are added by the renderer
  regardless of which path (sprite vs procedural) is active.

---

## Adding New Sprites

1. Export as PNG with alpha from your art tool (Aseprite, Photoshop, Figma, etc.)
2. Place the file in `sprites/`
3. Register it in `game.js` inside the `loadSprites({...})` call:
   ```js
   loadSprites({
     battery: 'sprites/battery.png',
     myThing: 'sprites/my_thing.png',   // ← add here
   });
   ```
4. In `renderer.js`, retrieve with `getSprite('myThing')` — returns the loaded
   `Image` object, or `null` if loading failed.
5. Draw with `drawSprite(ctx, img, x, y, w, h, alpha, zb, cw, dist, W, NR, H)`:
   - `x, y` — top-left corner in screen pixels
   - `w, h` — display size in screen pixels
   - `alpha` — 0–1 opacity
   - `zb` — the current frame's z-buffer (Float32Array from the wall render pass)
   - `cw` — column width (`W / NR`)
   - `dist` — world distance to the sprite (for depth test)
   - `W, NR, H` — canvas width, ray count, canvas height
   - Returns `true` if drawn; `false` if fully occluded or sprite missing.

---

## Pipeline Notes

- Sprites and procedural shapes coexist frame-to-frame. You can replace one sprite at
  a time without affecting anything else.
- The `spriteCache` is populated asynchronously at startup; the first few frames may
  render procedurally while images decode (imperceptible at normal play speed).
- Sprites should be designed for a **dark scene** — avoid detail that only reads
  against a light background. The game environment is near-black with flash lighting.
