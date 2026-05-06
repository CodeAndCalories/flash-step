import { state } from './state.js';

// ── Sprite pipeline ───────────────────────────────────────────────────────────
// Drop PNG files in sprites/ and call loadSprites() at boot.
// getSprite(key) returns the Image or null (triggers procedural fallback).
// drawSprite() handles depth-testing and clipping identically to enemy sprites.

const spriteCache = {};

export function loadSprites(defs) {
  return Promise.all(
    Object.entries(defs).map(([key, src]) =>
      new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { spriteCache[key] = img;  resolve(key); };
        img.onerror = () => { spriteCache[key] = null; resolve(null); }; // null → procedural
        img.src = src;
      })
    )
  );
}

export function getSprite(key) { return spriteCache[key] ?? null; }

export function getSpriteReport() {
  const loaded = [], failed = [];
  for (const [k, v] of Object.entries(spriteCache)) (v ? loaded : failed).push(k);
  return { loaded, failed };
}

// Enemy visual evolution params by level bracket.
// dy  = downward Y shift as fraction of projH (hunch/crouch)
// ws  = width scale multiplier (broader silhouette)
// hs  = height scale multiplier
// gl  = glitch mode (level 10+)
// isMimic: 80% shift, stays more upright
function getEvoParams(level, isMimic) {
  const m = isMimic ? 0.8 : 1.0;
  if (level <= 3) return { dy: 0,          ws: 1.0,            hs: 1.0,           gl: false };
  if (level <= 6) return { dy: 0.08 * m,   ws: 1 + 0.10 * m,  hs: 1.0,           gl: false };
  if (level <= 9) return { dy: 0.18 * m,   ws: 1 + 0.30 * m,  hs: 1 - 0.20 * m, gl: false };
  return           { dy: 0.18 * m,   ws: 1 + 0.30 * m,  hs: 1 - 0.20 * m, gl: true  };
}

// drawSprite — depth-tested screen-space sprite draw.
// x, y: top-left corner. w, h: display size. alpha: 0-1 opacity.
// Returns true if the sprite was visible and drawn.
export function drawSprite(ctx, img, x, y, w, h, alpha, zb, cw, dist, W, NR, canvasH) {
  if (!img || alpha <= 0) return false;
  const sc0 = Math.max(0, (x / W * NR) | 0);
  const sc1 = Math.min(NR - 1, ((x + w) / W * NR) | 0);
  let visible = false;
  for (let sc = sc0; sc <= sc1 && !visible; sc++) if (zb[sc] > dist) visible = true;
  if (!visible) return false;
  ctx.save();
  ctx.beginPath();
  for (let sc = sc0; sc <= sc1; sc++) if (zb[sc] > dist) ctx.rect(sc * cw, 0, cw + 1, canvasH);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.restore();
  return true;
}

export const FOV  = Math.PI / 2.3;
export const HFOV = FOV / 2;
export const MAXD = 18;
export const NR   = 240;

function getWallTheme(level) {
  if (state.levelType === 'REFLECTION') return 'reflection';
  if (level >= 10) return 'wrong';
  if (level >= 7)  return 'cave';
  if (level >= 4)  return 'sewer';
  return 'dungeon';
}

function mimicScreen() {
  const { P, M, W, H } = state;
  if (!M || !M.active) return null;
  const dx = M.x - P.x, dy = M.y - P.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return null;
  let a = Math.atan2(dy, dx) - P.angle;
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  if (Math.abs(a) > HFOV * 1.35) return null;
  return { sx: W / 2 + (a / HFOV) * (W / 2), dist, ph: Math.min(H * 1.65 / dist, H * 3.5) };
}

function blindScreen() {
  const { P, B, W, H } = state;
  if (!B || !B.active) return null;
  const dx = B.x - P.x, dy = B.y - P.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return null;
  let a = Math.atan2(dy, dx) - P.angle;
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  if (Math.abs(a) > HFOV * 1.35) return null;
  return { sx: W / 2 + (a / HFOV) * (W / 2), dist, ph: Math.min(H * 1.65 / dist, H * 3.5) };
}

export function cast(ox, oy, angle) {
  const { MAP, COLS, ROWS } = state;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const sx = Math.abs(1 / dx) || 1e10, sy = Math.abs(1 / dy) || 1e10;
  let mx = ox | 0, my = oy | 0;
  let sdx = dx < 0 ? (ox - mx) * sx : (mx + 1 - ox) * sx;
  let sdy = dy < 0 ? (oy - my) * sy : (my + 1 - oy) * sy;
  const ddx = dx < 0 ? -1 : 1, ddy = dy < 0 ? -1 : 1;
  let side = 0, dist = 0;
  for (let i = 0; i < 100; i++) {
    if (sdx < sdy) { dist = sdx; sdx += sx; mx += ddx; side = 0; }
    else           { dist = sdy; sdy += sy; my += ddy; side = 1; }
    if (mx < 0 || my < 0 || mx >= COLS || my >= ROWS) return { dist: MAXD, goal: false, side: 0, wx: 0 };
    const cell = MAP[my][mx];
    if (cell === 1 || cell === 2) {
      const wx = side === 0 ? (oy + dist * dy) % 1 : (ox + dist * dx) % 1;
      return { dist, goal: cell === 2, side, wx: Math.abs(wx) };
    }
  }
  return { dist: MAXD, goal: false, side: 0, wx: 0 };
}

export function enemyScreen() {
  const { P, E, W, H } = state;
  if (!E.active) return null;
  const dx = E.x - P.x, dy = E.y - P.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.1) return null;
  let a = Math.atan2(dy, dx) - P.angle;
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  if (Math.abs(a) > HFOV * 1.35) return null;
  return { sx: W / 2 + (a / HFOV) * (W / 2), dist, ph: Math.min(H * 1.65 / dist, H * 3.5) };
}

export function draw(lit, bob, outline) {
  const { ctx, W, H, P, E, MAP, COLS, ROWS, flashDecay, minimapTimer, gameState } = state;

  ctx.save();
  if (state.shakeAmt > 0) {
    ctx.translate(state.shakeX * state.shakeAmt, state.shakeY * state.shakeAmt);
    state.shakeAmt = Math.max(0, state.shakeAmt - 0.045);
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(-20, -20, W + 40, H + 40);

  const hs    = bob * H * 0.28;
  const theme = getWallTheme(state.level);

  if (lit > 0) {
    // Theme-aware ceiling and floor tints
    let c0, c1, f0, f1;
    if (theme === 'sewer') {
      c0 = `rgba(3,7,4,${lit})`;  c1 = `rgba(10,16,9,${lit})`;
      f0 = `rgba(6,12,6,${lit})`; f1 = `rgba(1,4,1,${lit})`;
    } else if (theme === 'cave') {
      c0 = `rgba(6,4,2,${lit})`;  c1 = `rgba(20,11,5,${lit})`;
      f0 = `rgba(16,8,3,${lit})`; f1 = `rgba(4,2,1,${lit})`;
    } else if (theme === 'wrong') {
      const tw  = (Date.now() / 5000) % 1;
      const swp = 0.5 + 0.5 * Math.sin(tw * Math.PI * 2);
      const hi = (14 + (swp * 8) | 0), lo = (4 - (swp * 2) | 0);
      c0 = `rgba(${hi},3,3,${lit})`; c1 = `rgba(${lo + 2},8,10,${lit})`;
      f0 = `rgba(${lo + 8},9,8,${lit})`; f1 = `rgba(3,${lo},1,${lit})`;
    } else if (theme === 'reflection') {
      c0 = `rgba(3,5,9,${lit})`;   c1 = `rgba(7,11,18,${lit})`;
      f0 = `rgba(5,8,13,${lit})`;  f1 = `rgba(2,3,6,${lit})`;
    } else {
      c0 = `rgba(5,3,3,${lit})`;  c1 = `rgba(18,10,10,${lit})`;
      f0 = `rgba(14,8,8,${lit})`; f1 = `rgba(3,1,1,${lit})`;
    }
    const cg = ctx.createLinearGradient(0, 0, 0, H / 2 + hs);
    cg.addColorStop(0, c0); cg.addColorStop(1, c1);
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H / 2 + hs);
    const fg = ctx.createLinearGradient(0, H / 2 + hs, 0, H);
    fg.addColorStop(0, f0); fg.addColorStop(1, f1);
    ctx.fillStyle = fg; ctx.fillRect(0, H / 2 + hs, W, H);
  }

  const cw = W / NR, zb = new Float32Array(NR);
  const wallTops = new Float32Array(NR), wallWHs = new Float32Array(NR);

  // Ray cast loop — always runs to fill depth buffer and wall geometry
  {
    const wallH   = theme === 'sewer' ? 0.765 : 0.9;
    const effMXD  = lit > 0 ? Math.max(5, MAXD * state.flashBrightness) : MAXD;
    let goalL = NR, goalR = -1, goalTopY = 0, goalWH = 0;
    for (let i = 0; i < NR; i++) {
      const ra = P.angle - HFOV + (i / NR) * FOV;
      const { dist, goal, side, wx } = cast(P.x, P.y, ra);
      zb[i] = dist;
      const corr = dist * Math.cos(ra - P.angle);
      const wh   = Math.min(H / corr * wallH, H * 2.5);
      const top  = (H - wh) / 2 + hs;
      wallTops[i] = top; wallWHs[i] = wh;

      if (lit > 0) {
        const br = Math.pow(Math.max(0, 1 - corr / effMXD), 1.08) * lit;
        let r, g, b;
        if (goal) {
          const gp = 0.7 + 0.3 * Math.sin(Date.now() * 0.003);
          r = (4 + br * 18) | 0; g = (25 + br * 170 * gp) | 0; b = (4 + br * 22) | 0;
        } else {
          const sv     = side === 1 ? 0.72 : 1.0;
          const mortar = (wx > 0.47 && wx < 0.53) ? 0.6 : 1.0;
          const shade  = br * sv * mortar;
          if (theme === 'sewer') {
            r = (10 + shade * 80) | 0; g = (18 + shade * 90) | 0; b = (12 + shade * 52) | 0;
          } else if (theme === 'cave') {
            const n = 0.88 + 0.24 * Math.abs(Math.sin(i * 7.31 + 1.1));
            r = (22 + shade * 128 * n) | 0; g = (10 + shade * 46 * n) | 0; b = (4 + shade * 22 * n) | 0;
          } else if (theme === 'wrong') {
            const wb = 0.72 + 0.28 * Math.sin(Date.now() / 3800 * Math.PI * 2);
            r = (20 + shade * 125 * wb) | 0; g = (5 + shade * 22) | 0; b = (8 + shade * 55 * (1.4 - wb)) | 0;
          } else if (theme === 'reflection') {
            r = (6 + shade * 58) | 0; g = (9 + shade * 75) | 0; b = (16 + shade * 108) | 0;
          } else {
            r = (18 + shade * 115) | 0; g = (10 + shade * 58) | 0; b = (10 + shade * 62) | 0;
          }
        }
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(i * cw, top, cw + 1, wh);
      }
      if (goal) { if (i < goalL) { goalL = i; goalTopY = top; goalWH = wh; } if (i > goalR) goalR = i; }
    }

    if (lit > 0) {
      // Exit door frame + floating particles
      if (goalL <= goalR) {
        const doorW  = (goalR - goalL + 1) * cw;
        const doorSpr = getSprite('door');
        if (doorSpr) ctx.drawImage(doorSpr, goalL * cw, goalTopY, doorW, goalWH);
        const fw    = Math.max(2, doorW * 0.055);
        ctx.fillStyle = `rgba(50,255,80,${lit * 0.88})`;
        ctx.fillRect(goalL * cw, goalTopY, fw, goalWH);
        ctx.fillRect((goalR + 1) * cw - fw, goalTopY, fw, goalWH);
        ctx.fillRect(goalL * cw, goalTopY, doorW, fw);
        const t3 = Date.now() / 1600;
        for (let p = 0; p < 6; p++) {
          const frac = (t3 + p * 0.167) % 1;
          const px   = goalL * cw + doorW * ((p + 0.5) / 6);
          const py   = (goalTopY + goalWH) - frac * Math.min(goalWH * 0.72, 58);
          ctx.fillStyle = `rgba(80,255,100,${lit * (0.22 + 0.78 * (1 - frac))})`;
          ctx.fillRect(px - 1, py, 2, 3);
        }
      }
      // Sewer: occasional drip dots at floor level
      if (theme === 'sewer') {
        ctx.fillStyle = `rgba(30,155,50,${lit * 0.10})`;
        for (let j = 0; j < 5; j++) {
          const col = (Math.random() * NR) | 0;
          if (zb[col] > 1.5) {
            const floorY = H / 2 + (H * 1.65 / zb[col]) * 0.30 + hs;
            if (floorY < H - 2) ctx.fillRect(col * cw, floorY, 1, 1 + Math.random() * 4);
          }
        }
      }
      // REFLECTION: second raycaster pass from opposite direction — ghostly mirror on walls
      if (state.levelType === 'REFLECTION') {
        ctx.save();
        for (let i = 0; i < NR; i++) {
          const mra   = (P.angle + Math.PI) - HFOV + (i / NR) * FOV;
          const { dist: md, side: ms } = cast(P.x, P.y, mra);
          const mcorr = md * Math.cos(mra - (P.angle + Math.PI));
          const mwh   = Math.min(H / mcorr * 0.9, H * 2.5);
          const mtop  = (H - mwh) / 2 + hs;
          const mbr   = Math.pow(Math.max(0, 1 - mcorr / MAXD), 1.08) * lit * (ms === 1 ? 0.72 : 1.0);
          const mr2   = (18 + mbr * 55) | 0;
          const mg2   = (25 + mbr * 72) | 0;
          const mbl2  = (40 + mbr * 98) | 0;
          ctx.globalAlpha = 0.12;
          ctx.fillStyle   = `rgb(${mr2},${mg2},${mbl2})`;
          ctx.fillRect(i * cw, mtop, cw + 1, mwh);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  }

  // Floor/ceiling edge glow — bioluminescent moss lines, present even in darkness
  {
    const fA  = (0.35 + lit * 0.28).toFixed(2);
    const cA  = (0.20 + lit * 0.15).toFixed(2);
    const fSt = `rgba(60,30,30,${fA})`;
    const cSt = `rgba(60,30,30,${cA})`;
    for (let i = 0; i < NR; i++) {
      const top = wallTops[i], wh = wallWHs[i];
      ctx.fillStyle = fSt;
      ctx.fillRect(i * cw, top + wh - 2, cw + 1, 2);
      ctx.fillStyle = cSt;
      ctx.fillRect(i * cw, top, cw + 1, 2);
    }
  }

  // Spider web overlays — faint radial patterns on wall faces (flash only)
  if (lit > 0 && state.webs) {
    for (const web of state.webs) {
      if (web.hit) continue;
      const wdx = web.x - P.x, wdy = web.y - P.y;
      const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
      if (wdist > 5) continue;
      let wa = Math.atan2(wdy, wdx) - P.angle;
      while (wa >  Math.PI) wa -= Math.PI * 2;
      while (wa < -Math.PI) wa += Math.PI * 2;
      if (Math.abs(wa) > HFOV) continue;
      const wsx = W / 2 + (wa / HFOV) * (W / 2);
      const col = Math.max(0, Math.min(NR - 1, (wsx / W * NR) | 0));
      if (zb[col] > wdist * 0.92) {
        const wrad  = Math.min(H * 1.65 / wdist * 0.45, W * 0.10);
        const wcy   = H / 2 + hs;
        const webSpr = getSprite('web');
        ctx.save();
        if (webSpr) {
          ctx.globalCompositeOperation = 'screen'; // black bg → transparent
          ctx.globalAlpha = Math.max(0, (1 - wdist / 5) * lit * 0.32);
          ctx.drawImage(webSpr, wsx - wrad, wcy - wrad, wrad * 2, wrad * 2);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.globalAlpha = Math.max(0, (1 - wdist / 5) * lit * 0.22);
          ctx.strokeStyle = '#e8e0c8'; ctx.lineWidth = 0.6;
          for (let k = 0; k < 8; k++) {
            const ang = k * Math.PI / 4;
            ctx.beginPath(); ctx.moveTo(wsx, wcy);
            ctx.lineTo(wsx + Math.cos(ang) * wrad, wcy + Math.sin(ang) * wrad); ctx.stroke();
          }
          for (let ring = 1; ring <= 3; ring++) {
            ctx.beginPath(); ctx.arc(wsx, wcy, wrad * ring / 3, 0, Math.PI * 2); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1; ctx.restore();
        // Spider sitting at mid-height on the wall surface
        const spiderSpr = getSprite('spider');
        if (spiderSpr && !web.hit) {
          const sz = Math.max(4, H * 1.65 / wdist * 0.15);
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = Math.max(0, (1 - wdist / 5) * lit * 0.78);
          ctx.drawImage(spiderSpr, wsx - sz / 2, H / 2 + hs - sz / 2, sz, sz);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }
    }
  }

  // Outline / afterglow — wall edges linger after flash released
  if (outline > 0 && lit < 0.9) {
    const oLit = outline * (1 - lit);
    for (let i = 0; i < NR; i++) {
      const ra = P.angle - HFOV + (i / NR) * FOV;
      const { dist, goal } = cast(P.x, P.y, ra);
      const corr   = dist * Math.cos(ra - P.angle);
      const wh     = Math.min(H / corr * 0.9, H * 2.5);
      const top    = (H - wh) / 2 + hs;
      const bright = Math.pow(Math.max(0, 1 - corr / MAXD), 1.2) * oLit;
      if (bright < 0.004) continue;
      const edgeCol = goal
        ? `rgba(0,${(bright * 180) | 0},${(bright * 40) | 0},${bright})`
        : `rgba(${(bright * 130) | 0},${(bright * 80) | 0},${(bright * 80) | 0},${bright})`;
      ctx.fillStyle = edgeCol;
      ctx.fillRect(i * cw, top, cw + 1, Math.max(1, wh * 0.025));
      ctx.fillRect(i * cw, top + wh - Math.max(1, wh * 0.025), cw + 1, Math.max(1, wh * 0.025));
    }
    ctx.fillStyle = `rgba(80,50,50,${oLit * 0.12})`;
    ctx.fillRect(0, H / 2 + hs - 1, W, 2);
  }

  // Breadcrumbs — player trail, floor level, flash-only
  if (lit > 0) {
    const footSpr = getSprite('footprint');
    for (let ci = 0; ci < state.crumbs.length; ci++) {
      const crumb = state.crumbs[ci];
      const cdx = crumb.x - P.x, cdy = crumb.y - P.y;
      const cdist2 = cdx * cdx + cdy * cdy;
      if (cdist2 < 0.09 || cdist2 > 64) continue;
      const cdist = Math.sqrt(cdist2);
      let ca = Math.atan2(cdy, cdx) - P.angle;
      while (ca >  Math.PI) ca -= Math.PI * 2;
      while (ca < -Math.PI) ca += Math.PI * 2;
      if (Math.abs(ca) > HFOV) continue;
      const csx = W / 2 + (ca / HFOV) * (W / 2);
      const col = Math.max(0, Math.min(NR - 1, (csx / W * NR) | 0));
      if (zb[col] < cdist) continue;
      const cph  = H * 1.65 / cdist;
      const cy   = H / 2 + cph * 0.30 + hs;
      if (cy > H) continue;
      const alpha = Math.pow(1 - cdist / 8, 1.8) * lit * 0.20;
      if (alpha < 0.012) continue;
      const r = Math.max(1, H * 0.007 / cdist);
      if (footSpr) {
        const isLeft  = ci % 2 === 0;
        const fw = r * 3.5, fh = r * 2.2;
        const rot = (crumb.angle || 0) - P.angle; // orient in walk direction
        ctx.save();
        ctx.translate(csx, cy);
        ctx.rotate(rot);
        if (!isLeft) ctx.scale(-1, 1);            // mirror for right foot
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = alpha;
        ctx.drawImage(footSpr, -fw / 2, -fh / 2, fw, fh);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(185,162,148,${alpha})`;
        ctx.fillRect(csx - r, cy - r * 0.5, r * 2, r);
      }
    }
  }

  // Battery pickups — AA battery with bob, floor pool, and PNG sprite support
  const now = Date.now();
  for (const b of state.batteries) {
    const bdx = b.x - P.x, bdy = b.y - P.y;
    const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
    if (bdist < 0.15 || bdist > MAXD) continue;
    let ba2 = Math.atan2(bdy, bdx) - P.angle;
    while (ba2 >  Math.PI) ba2 -= Math.PI * 2;
    while (ba2 < -Math.PI) ba2 += Math.PI * 2;
    if (Math.abs(ba2) > HFOV * 1.4) continue;

    const bsx     = W / 2 + (ba2 / HFOV) * (W / 2);
    const bph     = Math.min(H * 1.65 / bdist, H * 3.5);
    const bFloorY = H / 2 + bph * 0.30;          // floor contact level
    const pulse   = 0.65 + 0.35 * Math.sin(now * 0.004 + b.x * 2.1);

    // Ambient amber glow — visible in the dark up to 5 units
    if (bdist < 5) {
      const gAlpha = Math.pow(1 - bdist / 5, 1.8) * 0.58 * pulse;
      const gRad   = Math.max(8, bph * 0.26);
      const grd    = ctx.createRadialGradient(bsx, bFloorY, 0, bsx, bFloorY, gRad * 2.8);
      grd.addColorStop(0,   `rgba(255,190,30,${gAlpha})`);
      grd.addColorStop(0.5, `rgba(200,110,5,${gAlpha * 0.4})`);
      grd.addColorStop(1,   'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(bsx - gRad * 3, bFloorY - gRad * 3, gRad * 6, gRad * 6);
    }

    // Full render when flash is on, depth-tested
    if (lit > 0) {
      const bh  = Math.max(6, bph * 0.15);                 // body height
      const bw  = bh * 0.38;                                // AA: tall & narrow
      const bob = Math.sin(now * 0.0018 + b.x * 3.7) * bh * 0.12; // slow float
      const ty  = bFloorY - bh - bob;                       // top of battery
      const sc0 = Math.max(0, ((bsx - bw * 1.3) / W * NR) | 0);
      const sc1 = Math.min(NR - 1, ((bsx + bw * 1.3) / W * NR) | 0);

      ctx.save();
      ctx.beginPath();
      for (let sc = sc0; sc <= sc1; sc++) if (zb[sc] > bdist) ctx.rect(sc * cw, 0, cw + 1, H);
      ctx.clip();

      const litA = Math.min(1, lit * 1.2) * Math.min(1, 5 / bdist);
      const spr  = getSprite('battery');

      // ── Floor light pool (flattened amber ellipse) ──────────────────────
      ctx.save();
      ctx.translate(bsx, bFloorY);
      ctx.scale(1, 0.28);
      const pgrd = ctx.createRadialGradient(0, 0, 0, 0, 0, bw * 2.4);
      pgrd.addColorStop(0, `rgba(255,168,18,${litA * 0.28})`);
      pgrd.addColorStop(1, 'transparent');
      ctx.fillStyle = pgrd;
      ctx.fillRect(-bw * 2.6, -bw * 2.6, bw * 5.2, bw * 5.2);
      ctx.restore();

      if (spr) {
        // ── PNG sprite path ───────────────────────────────────────────────
        ctx.globalAlpha = litA * pulse;
        ctx.drawImage(spr, bsx - bw, ty, bw * 2, bh);
        ctx.globalAlpha = 1;
      } else {
        // ── Procedural AA battery ─────────────────────────────────────────
        const r = Math.max(1, bw * 0.28);  // corner radius

        // Casing body — dark metallic grey with rounded top/bottom
        ctx.fillStyle = `rgba(65,68,73,${litA})`;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bsx - bw * 0.5, ty + bh * 0.10, bw, bh * 0.84, [r, r, r * 0.5, r * 0.5]);
          ctx.fill();
        } else {
          ctx.fillRect(bsx - bw * 0.5, ty + bh * 0.10, bw, bh * 0.84);
        }

        // Metallic highlight stripe (left ~28 %)
        {
          const hlg = ctx.createLinearGradient(bsx - bw * 0.5, 0, bsx - bw * 0.14, 0);
          hlg.addColorStop(0, `rgba(148,152,160,${litA * 0.55})`);
          hlg.addColorStop(1, 'transparent');
          ctx.fillStyle = hlg;
          ctx.fillRect(bsx - bw * 0.5, ty + bh * 0.10, bw * 0.36, bh * 0.84);
        }

        // Label band — darker equatorial stripe
        ctx.fillStyle = `rgba(36,38,42,${litA * 0.92})`;
        ctx.fillRect(bsx - bw * 0.46, ty + bh * 0.40, bw * 0.92, bh * 0.20);

        // Charge indicator bar (right of centre, vertical)
        {
          const barX = bsx + bw * 0.24, barT = ty + bh * 0.16, barH = bh * 0.62;
          const cf   = state.flashCount === Infinity ? 1 : Math.min(1, state.flashCount / 12);
          // Track
          ctx.fillStyle = `rgba(12,25,12,${litA})`;
          ctx.fillRect(barX, barT, bw * 0.11, barH);
          // Fill (green → amber → red)
          ctx.fillStyle = cf > 0.5 ? `rgba(45,215,65,${litA})`
                        : cf > 0.2 ? `rgba(215,192,25,${litA})`
                        :            `rgba(215,42,22,${litA})`;
          ctx.fillRect(barX, barT + barH * (1 - cf), bw * 0.11, barH * cf);
          // Soft glow on bar
          const bgrd = ctx.createRadialGradient(barX + bw * 0.055, barT + barH * 0.5, 0,
                                                barX + bw * 0.055, barT + barH * 0.5, bw * 0.55);
          bgrd.addColorStop(0, cf > 0.5 ? `rgba(60,255,80,${litA * 0.36 * pulse})`
                              :           `rgba(255,175,25,${litA * 0.36 * pulse})`);
          bgrd.addColorStop(1, 'transparent');
          ctx.fillStyle = bgrd;
          ctx.fillRect(barX - bw * 0.4, barT, bw, barH);
        }

        // Positive terminal — gold nub on top
        ctx.fillStyle = `rgba(208,162,32,${litA})`;
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bsx - bw * 0.20, ty, bw * 0.40, bh * 0.12, bw * 0.09);
          ctx.fill();
        } else {
          ctx.fillRect(bsx - bw * 0.20, ty, bw * 0.40, bh * 0.12);
        }
        // Terminal highlight
        ctx.fillStyle = `rgba(238,205,78,${litA * 0.65})`;
        ctx.fillRect(bsx - bw * 0.17, ty + bh * 0.012, bw * 0.20, bh * 0.05);

        // Negative terminal — flat black ring on bottom
        ctx.fillStyle = `rgba(8,8,8,${litA})`;
        ctx.fillRect(bsx - bw * 0.46, ty + bh * 0.92, bw * 0.92, bh * 0.06);
      }

      ctx.restore();
    }
  }

  // Exit door ambient glow — faint green visible in darkness up to ~4.5 units
  {
    const exitX = state.COLS - 1.5, exitY = state.ROWS - 1.5;
    const eDx   = exitX - P.x, eDy = exitY - P.y;
    const eDist = Math.sqrt(eDx * eDx + eDy * eDy);
    if (eDist > 0.1 && eDist < 4.5) {
      let eA = Math.atan2(eDy, eDx) - P.angle;
      while (eA >  Math.PI) eA -= Math.PI * 2;
      while (eA < -Math.PI) eA += Math.PI * 2;
      if (Math.abs(eA) <= HFOV * 1.35) {
        const esx    = W / 2 + (eA / HFOV) * (W / 2);
        const eglow  = Math.pow(Math.max(0, 1 - eDist / 4.5), 2.2) * 0.40
                     * (0.65 + 0.35 * Math.sin(now * 0.003));
        const egrd   = ctx.createRadialGradient(esx, H / 2, 0, esx, H / 2, H * 0.38);
        egrd.addColorStop(0,   `rgba(20,220,60,${eglow})`);
        egrd.addColorStop(0.4, `rgba(10,150,28,${eglow * 0.38})`);
        egrd.addColorStop(1,   'transparent');
        ctx.fillStyle = egrd; ctx.fillRect(esx - H * 0.4, 0, H * 0.8, H);
      }
    }
  }

  // Collectible note — cream floor sprite, glows amber in dark
  if (state.note && !state.noteCollected) {
    const ndx = state.note.x - P.x, ndy = state.note.y - P.y;
    const ndist = Math.sqrt(ndx * ndx + ndy * ndy);
    if (ndist >= 0.15 && ndist <= MAXD) {
      let na = Math.atan2(ndy, ndx) - P.angle;
      while (na >  Math.PI) na -= Math.PI * 2;
      while (na < -Math.PI) na += Math.PI * 2;
      if (Math.abs(na) <= HFOV * 1.4) {
        const nsx = W / 2 + (na / HFOV) * (W / 2);
        const nph = Math.min(H * 1.65 / ndist, H * 3.5);
        const nCy = H / 2 + nph * 0.30;
        const npulse = 0.7 + 0.3 * Math.sin(now * 0.003 + state.note.x);
        if (ndist < 5) {
          const nA = Math.pow(1 - ndist / 5, 1.8) * 0.50 * npulse;
          const ng = ctx.createRadialGradient(nsx, nCy, 0, nsx, nCy, Math.max(8, nph * 0.25) * 2.5);
          ng.addColorStop(0, `rgba(240,225,185,${nA})`); ng.addColorStop(1, 'transparent');
          ctx.fillStyle = ng; ctx.fillRect(nsx - nph * 0.5, nCy - nph * 0.5, nph, nph);
        }
        if (lit > 0) {
          const nh = Math.max(5, nph * 0.12), nw = nh * 0.75;
          const nc0 = Math.max(0, ((nsx - nw) / W * NR) | 0);
          const nc1 = Math.min(NR - 1, ((nsx + nw) / W * NR) | 0);
          ctx.save(); ctx.beginPath();
          for (let sc = nc0; sc <= nc1; sc++) if (zb[sc] > ndist) ctx.rect(sc * cw, 0, cw + 1, H);
          ctx.clip();
          const nLitA  = Math.min(1, lit * 1.3) * Math.min(1, 4 / ndist) * npulse;
          const noteSpr = getSprite('note');
          if (noteSpr) {
            ctx.globalAlpha = nLitA;
            ctx.drawImage(noteSpr, nsx - nw, nCy - nh, nw * 2, nh * 1.5);
            ctx.globalAlpha = 1;
          } else {
            const ng2 = ctx.createRadialGradient(nsx, nCy, 0, nsx, nCy, nh * 2.8);
            ng2.addColorStop(0, `rgba(245,232,195,${nLitA})`); ng2.addColorStop(1, 'transparent');
            ctx.fillStyle = ng2; ctx.fillRect(nsx - nh * 3, nCy - nh * 3, nh * 6, nh * 6);
            ctx.fillStyle = `rgba(240,228,192,${nLitA})`;
            ctx.fillRect(nsx - nw * 0.5, nCy - nh * 0.5, nw, nh);
          }
          ctx.restore();
        }
      }
    }
  }

  // Rat floor sprite (world space, only when lit)
  if (state.rat && lit > 0) {
    const rdx = state.rat.wx - P.x, rdy = state.rat.wy - P.y;
    const rdist = Math.sqrt(rdx * rdx + rdy * rdy);
    if (rdist > 0.1 && rdist < 6) {
      let ra = Math.atan2(rdy, rdx) - P.angle;
      while (ra >  Math.PI) ra -= Math.PI * 2;
      while (ra < -Math.PI) ra += Math.PI * 2;
      if (Math.abs(ra) <= HFOV) {
        const rsx = W / 2 + (ra / HFOV) * (W / 2);
        const rcol = Math.max(0, Math.min(NR - 1, (rsx / W * NR) | 0));
        if (zb[rcol] >= rdist * 0.9) {
          const rph = H * 1.65 / rdist;
          const rcy = H / 2 + rph * 0.30 + hs;
          if (rcy < H) {
            const rr    = Math.max(2, H * 0.005 / rdist);
            const ratSpr = getSprite('rat');
            ctx.save(); ctx.globalAlpha = state.rat.life * 0.90;
            if (ratSpr) {
              ctx.translate(rsx, rcy);
              if ((state.rat.vx || 0) < 0) ctx.scale(-1, 1);
              ctx.drawImage(ratSpr, -rr * 2.5, -rr * 1.2, rr * 5, rr * 2.4);
            } else {
              ctx.fillStyle = '#181010';
              ctx.beginPath(); ctx.ellipse(rsx, rcy, rr * 2.2, rr, 0.3, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1; ctx.restore();
          }
        }
      }
    }
  }

  // Decoy eyes in dead ends — identical to real enemy eyes, dark-only, vanish up close
  for (const decoy of state.decoys) {
    const ddx = decoy.x - P.x, ddy = decoy.y - P.y;
    const ddist = Math.sqrt(ddx * ddx + ddy * ddy);
    if (ddist < 0.1 || ddist > 8) continue;
    let da = Math.atan2(ddy, ddx) - P.angle;
    while (da >  Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > HFOV * 1.35) continue;

    // Fade out when the flash is on (decoys only lurk in darkness)
    const darkOnly = Math.max(0, 1 - lit * 4);
    if (darkOnly < 0.01) continue;
    // Fade out when player gets within 1.5 units — nothing there to find
    const proximity = Math.min(1, (ddist - 1.2) / 0.9);
    if (proximity <= 0) continue;

    const dsx  = W / 2 + (da / HFOV) * (W / 2);
    const dph  = Math.min(H * 1.65 / ddist, H * 3.5);
    const dey  = H / 2 - dph * 0.38 + hs;
    const dpulse = 0.52 + 0.48 * Math.sin(now * 0.0038 + decoy.phase);
    const dea  = Math.pow(Math.max(0, 1 - ddist / 8), 2.0) * 0.9 * dpulse * darkOnly * proximity;
    if (dea < 0.012) continue;

    const desz = Math.max(1.5, dph * 0.036);
    const deo  = Math.max(2.5, dph * 0.088);
    [dsx - deo, dsx + deo].forEach(ex => {
      const eg = ctx.createRadialGradient(ex, dey, 0, ex, dey, desz * 4.5);
      eg.addColorStop(0,   `rgba(255,25,25,${dea})`);
      eg.addColorStop(0.5, `rgba(180,0,0,${dea * 0.4})`);
      eg.addColorStop(1,   'transparent');
      ctx.fillStyle = eg;
      ctx.fillRect(ex - desz * 6, dey - desz * 6, desz * 12, desz * 12);
      ctx.fillStyle = `rgba(255,230,190,${Math.min(1, dea * 1.3)})`;
      ctx.beginPath(); ctx.arc(ex, dey, desz * 0.75, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Enemy rendering
  const eyePulse = 0.55 + 0.45 * Math.sin(Date.now() * 0.004);
  const es = enemyScreen();

  // Ambient eyes visible in the dark up to ~5.5 units
  if (es && es.dist < 5.5) {
    const ea = Math.pow(1 - es.dist / 5.5, 2.2) * 0.95 * eyePulse;
    if (ea > 0.015) {
      const ey  = H / 2 - es.ph * 0.38 + hs;
      const esz = Math.max(1.5, es.ph * 0.036);
      const eo  = Math.max(2.5, es.ph * 0.088);
      [es.sx - eo, es.sx + eo].forEach(ex => {
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, esz * 4.5);
        eg.addColorStop(0,   `rgba(255,25,25,${ea})`);
        eg.addColorStop(0.5, `rgba(180,0,0,${ea * 0.4})`);
        eg.addColorStop(1,   'transparent');
        ctx.fillStyle = eg;
        ctx.fillRect(ex - esz * 6, ey - esz * 6, esz * 12, esz * 12);
        ctx.fillStyle = `rgba(255,230,190,${Math.min(1, ea * 1.3)})`;
        ctx.beginPath(); ctx.arc(ex, ey, esz * 0.75, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  // Full sprite render when flash is on
  if (es && lit > 0) {
    state.lastKnownE = { wx: E.x, wy: E.y };   // snapshot for afterimage
    const { sx, dist: d, ph } = es;
    const sw = ph * 0.58, sprX = sx - sw / 2, sprY = H / 2 - ph * 0.5 + hs;
    const sc0 = Math.max(0, (sprX / W * NR) | 0), sc1 = Math.min(NR - 1, ((sprX + sw) / W * NR) | 0);
    ctx.save();
    ctx.beginPath();
    for (let sc = sc0; sc <= sc1; sc++) if (zb[sc] > d) { ctx.rect(sc * cw, 0, cw + 1, H); }
    ctx.clip();

    const ga = Math.max(0, 1 - d / 9) * lit * 0.5 * eyePulse;
    if (ga > 0) {
      const grd = ctx.createRadialGradient(sx, H / 2 + hs, 0, sx, H / 2 + hs, sw * 1.6);
      grd.addColorStop(0, `rgba(150,0,0,${ga})`); grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(sprX - sw, sprY - ph * 0.5, sw * 3, ph * 2);
    }

    const ba = Math.min(1, lit * 1.1) * Math.min(1, 5 / d);

    // Apply level-bracket visual evolution
    const evo  = getEvoParams(state.level, false);
    const evoW = sw * evo.ws, evoH = ph * evo.hs;
    const evoX = sx - evoW / 2, evoY = sprY + ph * evo.dy;
    const bucket = Math.floor(Date.now() / 600);
    const gOffX  = evo.gl ? ((bucket * 7919 + 13) % 9) - 4 : 0;
    const gOffY  = evo.gl ? ((bucket * 6271 + 17) % 7) - 3 : 0;
    const fX = evoX + gOffX, fY = evoY + gOffY;

    const stalkerSpr = getSprite('stalker');
    const sprAlpha = Math.min(1, lit * 1.1) * Math.min(1, 6 / d);
    if (stalkerSpr) {
      ctx.globalAlpha = sprAlpha;
      ctx.drawImage(stalkerSpr, fX, fY, evoW, evoH);
      if (evo.gl && Math.random() < 0.15) {
        ctx.globalAlpha = sprAlpha * 0.30;
        ctx.drawImage(stalkerSpr, fX + 8, fY, evoW, evoH);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = `rgba(5,1,1,${ba})`;
      ctx.fillRect(fX + evoW * 0.23, fY + evoH * 0.2, evoW * 0.54, evoH * 0.76);
      ctx.fillStyle = `rgba(8,2,2,${ba})`;
      ctx.beginPath(); ctx.ellipse(sx, fY + evoH * 0.13, evoW * 0.26, evoH * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }

    // Red eye glow always on top (sprite or procedural)
    const ela  = Math.min(1, lit * 1.3) * eyePulse;
    const esz2 = Math.max(1.5, ph * 0.036), eo2 = Math.max(2, ph * 0.088), ey2 = fY + evoH * 0.1;
    [sx - eo2, sx + eo2].forEach(ex => {
      const eg = ctx.createRadialGradient(ex, ey2, 0, ex, ey2, esz2 * 3.5);
      eg.addColorStop(0, `rgba(255,45,45,${ela})`); eg.addColorStop(1, 'transparent');
      ctx.fillStyle = eg;
      ctx.fillRect(ex - esz2 * 4, ey2 - esz2 * 4, esz2 * 8, esz2 * 8);
      ctx.fillStyle = `rgba(255,235,195,${ela})`;
      ctx.beginPath(); ctx.arc(ex, ey2, esz2, 0, Math.PI * 2); ctx.fill();
    });

    if (!stalkerSpr && ph > 45) {
      ctx.strokeStyle = `rgba(4,1,1,${ba * 0.8})`; ctx.lineWidth = Math.max(1, evoW * 0.06);
      ctx.beginPath(); ctx.moveTo(sx - evoW * 0.17, fY + evoH * 0.44); ctx.lineTo(sx - evoW * 0.6, fY + evoH * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + evoW * 0.17, fY + evoH * 0.44); ctx.lineTo(sx + evoW * 0.6, fY + evoH * 0.7); ctx.stroke();
    }
    ctx.restore();
  }

  // Afterimages — one per enemy, no eyes, deterministic grain for VHS-static feel
  for (const ai of state.afterimages) {
    if (ai.alpha <= 0) continue;
    const adx = ai.wx - P.x, ady = ai.wy - P.y;
    const adist = Math.sqrt(adx * adx + ady * ady);
    if (adist < 0.1) continue;
    let aa = Math.atan2(ady, adx) - P.angle;
    while (aa >  Math.PI) aa -= Math.PI * 2;
    while (aa < -Math.PI) aa += Math.PI * 2;
    if (Math.abs(aa) > HFOV * 1.35) continue;
    const asx  = W / 2 + (aa / HFOV) * (W / 2);
    const aph  = Math.min(H * 1.65 / adist, H * 3.5);
    const asw  = aph * 0.58, asprX = asx - asw / 2, asprY = H / 2 - aph * 0.5 + hs;
    const alpha = Math.max(0, Math.min(ai.alpha, ai.maxAlpha));
    ctx.save();
    ctx.globalAlpha = alpha;
    // Body + head silhouette (no eyes — pure psychological uncertainty)
    ctx.fillStyle = 'rgba(145,18,18,1)';
    ctx.fillRect(asprX + asw * 0.23, asprY + aph * 0.2, asw * 0.54, aph * 0.76);
    ctx.beginPath(); ctx.ellipse(asx, asprY + aph * 0.13, asw * 0.26, aph * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    // Deterministic grain — seed updates ~12×/s, unique per afterimage position
    ctx.globalAlpha = alpha * 0.55;
    const grainT = (Math.floor(Date.now() / 82) + (ai.wx * 73 | 0)) & 0xFFFF;
    for (let g = 0; g < 9; g++) {
      const h = (grainT * 1337 + g * 53) & 0xFFFF;
      const gx = asprX + (h % 997) / 997 * asw;
      const gy = asprY + ((h * 31 + 7) % 997) / 997 * aph;
      ctx.fillStyle = h & 1 ? '#fff' : '#000';
      ctx.fillRect(gx, gy, 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // REFLECTION: ghost player — fixed overlay at center, same look as Mimic
  if (state.levelType === 'REFLECTION' && lit > 0) {
    const ghostDist = 8;
    const ghostPH   = Math.min(H * 1.65 / ghostDist, H * 3.5);
    const ghostSW   = ghostPH * 0.58;
    const ghostX    = W / 2 - ghostSW / 2;
    const ghostY    = H / 2 - ghostPH * 0.5 + hs;
    const ghostA    = 0.15 * (0.72 + 0.28 * Math.sin(Date.now() * 0.0014));
    const stalkerSpr = getSprite('stalker');
    ctx.save();
    ctx.globalAlpha = ghostA * Math.min(1, lit * 1.4);
    if (stalkerSpr) {
      ctx.drawImage(stalkerSpr, ghostX, ghostY, ghostSW, ghostPH);
    } else {
      ctx.fillStyle = 'rgba(210,215,255,1)';
      ctx.fillRect(ghostX + ghostSW * 0.23, ghostY + ghostPH * 0.2, ghostSW * 0.54, ghostPH * 0.76);
      ctx.beginPath(); ctx.ellipse(W / 2, ghostY + ghostPH * 0.13, ghostSW * 0.26, ghostPH * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Mimic — pale ghostly silhouette, white eyes, level 3+
  const ms = state.level >= 3 ? mimicScreen() : null;
  const mimicPulse = 0.45 + 0.55 * Math.sin(Date.now() * 0.0028);

  // Ambient mimic eyes in the dark — pale blue-white, slightly farther range than enemy
  if (ms && ms.dist < 6.5) {
    const mea = Math.pow(1 - ms.dist / 6.5, 2.0) * 0.78 * mimicPulse * Math.max(0, 1 - lit * 3);
    if (mea > 0.01) {
      const mey  = H / 2 - ms.ph * 0.38 + hs;
      const mesz = Math.max(1.5, ms.ph * 0.036);
      const meo  = Math.max(2.5, ms.ph * 0.088);
      [ms.sx - meo, ms.sx + meo].forEach(ex => {
        const eg = ctx.createRadialGradient(ex, mey, 0, ex, mey, mesz * 4.5);
        eg.addColorStop(0,   `rgba(190,190,255,${mea})`);
        eg.addColorStop(0.5, `rgba(110,110,190,${mea * 0.3})`);
        eg.addColorStop(1,   'transparent');
        ctx.fillStyle = eg;
        ctx.fillRect(ex - mesz * 6, mey - mesz * 6, mesz * 12, mesz * 12);
        ctx.fillStyle = `rgba(235,235,255,${Math.min(1, mea * 1.2)})`;
        ctx.beginPath(); ctx.arc(ex, mey, mesz * 0.75, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  // Mimic full ghostly sprite when lit (semi-transparent, no arms)
  if (ms && lit > 0) {
    state.lastKnownM = { wx: state.M.x, wy: state.M.y };
    const { sx: msx, dist: md, ph: mph } = ms;
    const msw = mph * 0.58, msprX = msx - msw / 2, msprY = H / 2 - mph * 0.5 + hs;
    const msc0 = Math.max(0, (msprX / W * NR) | 0), msc1 = Math.min(NR - 1, ((msprX + msw) / W * NR) | 0);
    ctx.save();
    ctx.beginPath();
    for (let sc = msc0; sc <= msc1; sc++) if (zb[sc] > md) ctx.rect(sc * cw, 0, cw + 1, H);
    ctx.clip();
    const mba = Math.min(1, lit * 0.65) * Math.min(1, 5 / md) * 0.50;
    const mevo  = getEvoParams(state.level, true); // mimic = 80% shift
    const mevoW = msw * mevo.ws, mevoH = mph * mevo.hs;
    const mevoX = msx - mevoW / 2, mevoY = msprY + mph * mevo.dy;
    const mimicSpr = getSprite('mimic');
    if (mimicSpr) {
      ctx.globalCompositeOperation = 'screen'; // black bg → transparent
      ctx.globalAlpha = mba;
      ctx.drawImage(mimicSpr, mevoX, mevoY, mevoW, mevoH);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.fillStyle = `rgba(8,6,12,${mba})`;
      ctx.fillRect(mevoX + mevoW * 0.23, mevoY + mevoH * 0.2, mevoW * 0.54, mevoH * 0.76);
      ctx.fillStyle = `rgba(10,8,16,${mba})`;
      ctx.beginPath(); ctx.ellipse(msx, mevoY + mevoH * 0.13, mevoW * 0.26, mevoH * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    const mela = Math.min(1, lit * 1.0) * mimicPulse * 0.85;
    const mesz2 = Math.max(1.5, mph * 0.036), meo2 = Math.max(2, mph * 0.088), mey2 = mevoY + mevoH * 0.1;
    [msx - meo2, msx + meo2].forEach(ex => {
      const eg = ctx.createRadialGradient(ex, mey2, 0, ex, mey2, mesz2 * 3.5);
      eg.addColorStop(0, `rgba(200,200,255,${mela})`); eg.addColorStop(1, 'transparent');
      ctx.fillStyle = eg;
      ctx.fillRect(ex - mesz2 * 4, mey2 - mesz2 * 4, mesz2 * 8, mesz2 * 8);
      ctx.fillStyle = `rgba(240,240,255,${mela})`;
      ctx.beginPath(); ctx.arc(ex, mey2, mesz2, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  // Blind One — no eyes, slightly shorter, only visible when lit (no dark tell)
  const bs = state.level >= 5 ? blindScreen() : null;
  if (bs && lit > 0) {
    state.lastKnownB = { wx: state.B.x, wy: state.B.y };
    const { sx: bsx2, dist: bd, ph: bph2 } = bs;
    const bsw = bph2 * 0.50, bsprX = bsx2 - bsw / 2;
    const bph2r = bph2 * 0.78, bsprY = H / 2 - bph2r * 0.5 + hs;
    const bsc0 = Math.max(0, (bsprX / W * NR) | 0), bsc1 = Math.min(NR - 1, ((bsprX + bsw) / W * NR) | 0);
    ctx.save(); ctx.beginPath();
    for (let sc = bsc0; sc <= bsc1; sc++) if (zb[sc] > bd) ctx.rect(sc * cw, 0, cw + 1, H);
    ctx.clip();
    const bba     = Math.min(1, lit * 1.0) * Math.min(1, 5 / bd);
    const blindSpr = getSprite('blind');
    if (blindSpr) {
      ctx.globalAlpha = bba;
      ctx.drawImage(blindSpr, bsprX, bsprY, bsw, bph2r);
      ctx.globalAlpha = 1;
      // No eye rendering — blind one has no eyes
    } else {
      ctx.fillStyle = `rgba(2,1,1,${bba})`;
      ctx.fillRect(bsprX + bsw * 0.23, bsprY + bph2r * 0.2, bsw * 0.54, bph2r * 0.76);
      ctx.fillStyle = `rgba(3,1,1,${bba})`;
      ctx.beginPath(); ctx.ellipse(bsx2, bsprY + bph2r * 0.13, bsw * 0.26, bph2r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      // Void eye sockets — solid black, no glow
      const besz = Math.max(1.5, bph2r * 0.030), beo = Math.max(2, bph2r * 0.078);
      ctx.fillStyle = `rgba(0,0,0,${bba})`;
      [bsx2 - beo, bsx2 + beo].forEach(ex => {
        ctx.beginPath(); ctx.arc(ex, bsprY + bph2r * 0.1, besz * 1.3, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.restore();
  }

  // Extra stalkers (level 9+) — pinkish-red eyes, same sprite as main enemy
  for (const es of state.extraStalkers) {
    const esdx = es.x - P.x, esdy = es.y - P.y;
    const esdist = Math.sqrt(esdx * esdx + esdy * esdy);
    if (esdist < 0.1) continue;
    let esa = Math.atan2(esdy, esdx) - P.angle;
    while (esa >  Math.PI) esa -= Math.PI * 2;
    while (esa < -Math.PI) esa += Math.PI * 2;
    if (Math.abs(esa) > HFOV * 1.35) continue;
    const essx = W / 2 + (esa / HFOV) * (W / 2);
    const esph = Math.min(H * 1.65 / esdist, H * 3.5);
    const espulse = 0.55 + 0.45 * Math.sin(Date.now() * 0.004 + es.x);
    if (esdist < 5.5) {
      const esea = Math.pow(1 - esdist / 5.5, 2.2) * 0.90 * espulse;
      if (esea > 0.01) {
        const esey = H / 2 - esph * 0.38 + hs;
        const esesz = Math.max(1.5, esph * 0.036), eseo = Math.max(2.5, esph * 0.088);
        [essx - eseo, essx + eseo].forEach(ex => {
          const eg = ctx.createRadialGradient(ex, esey, 0, ex, esey, esesz * 4.5);
          eg.addColorStop(0,   `rgba(255,20,80,${esea})`);
          eg.addColorStop(0.5, `rgba(180,0,50,${esea * 0.4})`);
          eg.addColorStop(1,   'transparent');
          ctx.fillStyle = eg; ctx.fillRect(ex - esesz * 6, esey - esesz * 6, esesz * 12, esesz * 12);
          ctx.fillStyle = `rgba(255,205,215,${Math.min(1, esea * 1.3)})`;
          ctx.beginPath(); ctx.arc(ex, esey, esesz * 0.75, 0, Math.PI * 2); ctx.fill();
        });
      }
    }
    if (lit > 0) {
      const essw = esph * 0.58, esprX = essx - essw / 2, esprY = H / 2 - esph * 0.5 + hs;
      const esc0 = Math.max(0, (esprX / W * NR) | 0), esc1 = Math.min(NR - 1, ((esprX + essw) / W * NR) | 0);
      ctx.save(); ctx.beginPath();
      for (let sc = esc0; sc <= esc1; sc++) if (zb[sc] > esdist) ctx.rect(sc * cw, 0, cw + 1, H);
      ctx.clip();
      const esba = Math.min(1, lit * 1.1) * Math.min(1, 5 / esdist);
      const esevo  = getEvoParams(state.level, false);
      const esevoW = essw * esevo.ws, esevoH = esph * esevo.hs;
      const esevoX = essx - esevoW / 2, esevoY = esprY + esph * esevo.dy;
      const esBucket = Math.floor(Date.now() / 600);
      const esGX = esevo.gl ? ((esBucket * 7919 + 31) % 9) - 4 : 0;
      const esGY = esevo.gl ? ((esBucket * 6271 + 41) % 7) - 3 : 0;
      const esFX = esevoX + esGX, esFY = esevoY + esGY;
      const estalkerSpr = getSprite('stalker');
      if (estalkerSpr) {
        const essprAlpha = Math.min(1, lit * 1.1) * Math.min(1, 6 / esdist);
        ctx.globalAlpha = essprAlpha;
        ctx.drawImage(estalkerSpr, esFX, esFY, esevoW, esevoH);
        if (esevo.gl && Math.random() < 0.15) {
          ctx.globalAlpha = essprAlpha * 0.30;
          ctx.drawImage(estalkerSpr, esFX + 8, esFY, esevoW, esevoH);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = `rgba(5,1,3,${esba})`;
        ctx.fillRect(esFX + esevoW * 0.23, esFY + esevoH * 0.2, esevoW * 0.54, esevoH * 0.76);
        ctx.fillStyle = `rgba(8,2,5,${esba})`;
        ctx.beginPath(); ctx.ellipse(essx, esFY + esevoH * 0.13, esevoW * 0.26, esevoH * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      }
      const esela = Math.min(1, lit * 1.3) * espulse;
      const esesz2 = Math.max(1.5, esph * 0.036), eseo2 = Math.max(2, esph * 0.088), esey2 = esFY + esevoH * 0.1;
      [essx - eseo2, essx + eseo2].forEach(ex => {
        const eg = ctx.createRadialGradient(ex, esey2, 0, ex, esey2, esesz2 * 3.5);
        eg.addColorStop(0, `rgba(255,30,100,${esela})`); eg.addColorStop(1, 'transparent');
        ctx.fillStyle = eg; ctx.fillRect(ex - esesz2 * 4, esey2 - esesz2 * 4, esesz2 * 8, esesz2 * 8);
        ctx.fillStyle = `rgba(255,200,215,${esela})`;
        ctx.beginPath(); ctx.arc(ex, esey2, esesz2, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
  }

  // Cursed flash — red overlay + deep crimson edge burn
  if (state.cursedFlash && lit > 0) {
    ctx.fillStyle = 'rgba(175,0,0,0.26)'; ctx.fillRect(0, 0, W, H);
    const cv2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.14, W / 2, H / 2, H * 0.96);
    cv2.addColorStop(0, 'transparent');
    cv2.addColorStop(1, 'rgba(215,0,0,0.68)');
    ctx.fillStyle = cv2; ctx.fillRect(0, 0, W, H);
  }
  // Camera burn from previous cursed flash (subtle red tint on next 3 flashes)
  if (state.cursedBurnCount > 0 && lit > 0) {
    ctx.fillStyle = `rgba(160,0,0,${state.cursedBurnCount * 0.032})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Vignette + flash burst + scanlines
  if (lit > 0) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, H * 0.88);
    vg.addColorStop(0, 'transparent');
    vg.addColorStop(1, `rgba(0,0,0,${0.62 * lit})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (flashDecay > 0.87) {
      const b = (flashDecay - 0.87) / 0.13;
      ctx.fillStyle = `rgba(255,252,238,${b * 0.13})`; ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  }

  // Proximity danger vignette — pulses red when enemy is close, even in the dark
  const pd = Math.sqrt((P.x - E.x) ** 2 + (P.y - E.y) ** 2);
  if (pd < 5) {
    const pi = (1 - pd / 5) * 0.5 * eyePulse;
    const pv = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.75);
    pv.addColorStop(0, 'transparent');
    pv.addColorStop(1, `rgba(110,0,0,${pi})`);
    ctx.fillStyle = pv; ctx.fillRect(0, 0, W, H);
  }

  // Panic vignette — escalating red edge pulse while flash is overheating
  if (state.panicLevel > 0) {
    const rates  = [0, 1150, 620, 290]; // ms per full pulse at each level
    const maxA   = [0, 0.30, 0.46, 0.65][state.panicLevel];
    const decay  = state.flashHeld ? 1 : Math.max(0, 1 - state.panicDecayTimer / 3000);
    const pulse  = 0.5 + 0.5 * Math.sin((Date.now() / rates[state.panicLevel]) * Math.PI * 2);
    const alpha  = pulse * maxA * decay;
    if (alpha > 0.008) {
      const pv2 = ctx.createRadialGradient(W / 2, H / 2, H * 0.24, W / 2, H / 2, H * 0.92);
      pv2.addColorStop(0,   'transparent');
      pv2.addColorStop(0.6, `rgba(160,0,0,${alpha * 0.45})`);
      pv2.addColorStop(1,   `rgba(220,0,0,${alpha})`);
      ctx.fillStyle = pv2; ctx.fillRect(0, 0, W, H);
    }
  }

  // Web vignette — soft sticky overlay when player hit a web
  if (state.webEffect) {
    const wa = Math.min(1, state.webEffect.timer / 600) * 0.18;
    const wvg = ctx.createRadialGradient(W / 2, H / 2, H * 0.12, W / 2, H / 2, H * 0.88);
    wvg.addColorStop(0, 'transparent');
    wvg.addColorStop(1, `rgba(200,195,168,${wa})`);
    ctx.fillStyle = wvg; ctx.fillRect(0, 0, W, H);
  }

  // Hallucination vignette — brief red flash paired with fake footstep sounds
  if (state.hallucinVignette > 0) {
    const hv = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.75);
    hv.addColorStop(0, 'transparent');
    hv.addColorStop(1, `rgba(110,0,0,${(state.hallucinVignette * 0.38).toFixed(3)})`);
    ctx.fillStyle = hv; ctx.fillRect(0, 0, W, H);
  }

  // Minimap — shown for 4 s after first flash
  if (minimapTimer > 0 && gameState === 'playing') {
    const a   = Math.min(1, minimapTimer * 0.8) * 0.88;
    const ms  = Math.max(4, Math.min(7, Math.floor(Math.min(W, H) / (COLS * 1.6))));
    const mw  = COLS * ms, mh = ROWS * ms, mx2 = W - mw - 14, my2 = 14;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(mx2 - 4, my2 - 4, mw + 8, mh + 8);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cv = MAP[r][c];
      // Exit cell: dark fill only (outline drawn separately)
      ctx.fillStyle = cv === 1 ? '#150808' : cv === 2 ? '#051a08' : '#0e0808';
      ctx.fillRect(mx2 + c * ms, my2 + r * ms, ms, ms);
    }
    // Exit door: bright green outline instead of filled square
    ctx.strokeStyle = '#22ee44'; ctx.lineWidth = 1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (MAP[r][c] === 2) ctx.strokeRect(mx2 + c * ms + 0.5, my2 + r * ms + 0.5, ms - 1, ms - 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(mx2 + P.x * ms - 1.5, my2 + P.y * ms - 1.5, 3, 3);
    ctx.fillStyle = '#ff2020'; ctx.fillRect(mx2 + E.x * ms - 1.5, my2 + E.y * ms - 1.5, 3, 3);
    ctx.fillStyle = '#ffcc22';
    for (const b of state.batteries) ctx.fillRect(mx2 + b.x * ms - 1, my2 + b.y * ms - 1, 2, 2);
    if (state.level >= 3 && state.M.active) {
      ctx.fillStyle = '#ccccff';
      ctx.fillRect(mx2 + state.M.x * ms - 1.5, my2 + state.M.y * ms - 1.5, 3, 3);
    }
    if (state.level >= 5 && state.B.active) {
      ctx.fillStyle = '#404040';
      ctx.fillRect(mx2 + state.B.x * ms - 1.5, my2 + state.B.y * ms - 1.5, 3, 3);
    }
    for (const es of state.extraStalkers) {
      ctx.fillStyle = '#cc3366';
      ctx.fillRect(mx2 + es.x * ms - 1.5, my2 + es.y * ms - 1.5, 3, 3);
    }
    for (const web of state.webs) if (!web.hit) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(mx2 + web.x * ms - 1, my2 + web.y * ms - 1, 2, 2);
    }
    if (state.note && !state.noteCollected) {
      ctx.fillStyle = '#f0e4b8';
      ctx.fillRect(mx2 + state.note.x * ms - 1, my2 + state.note.y * ms - 1, 2, 2);
    }
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx2 + P.x * ms, my2 + P.y * ms);
    ctx.lineTo(mx2 + (P.x + Math.cos(P.angle) * 2.5) * ms, my2 + (P.y + Math.sin(P.angle) * 2.5) * ms);
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.restore();
  }

  ctx.restore();

  // Bat scare — screen-space, outside shake transform
  if (state.bat) {
    const { t, dir } = state.bat;
    const bx = dir > 0 ? t * (W + 80) - 40 : W + 40 - t * (W + 80);
    const by = H * 0.14 + Math.sin(t * Math.PI * 5) * H * 0.04;
    const batSpr = getSprite('bat');
    if (batSpr) {
      const frame = Math.floor(Date.now() / 100) % 3;
      const fw    = batSpr.width / 3;
      const bw    = Math.max(55, H * 0.09);
      const bh    = bw * batSpr.height / fw;
      ctx.save();
      ctx.translate(bx, by);
      if (dir < 0) ctx.scale(-1, 1);   // flip to match travel direction
      ctx.globalCompositeOperation = 'screen'; // black bg → transparent
      ctx.drawImage(batSpr, frame * fw, 0, fw, batSpr.height, -bw / 2, -bh / 2, bw, bh);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    } else {
      const flap = Math.sin(t * Math.PI * 14);
      ctx.save(); ctx.fillStyle = 'rgba(3,2,2,0.96)';
      ctx.beginPath(); ctx.ellipse(bx, by, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 5, by);
      ctx.bezierCurveTo(bx-24, by-15*(1+flap), bx-36, by+6, bx-22, by+4);
      ctx.bezierCurveTo(bx-12, by+7, bx-5, by+2, bx-5, by); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx + 5, by);
      ctx.bezierCurveTo(bx+24, by-15*(1+flap), bx+36, by+6, bx+22, by+4);
      ctx.bezierCurveTo(bx+12, by+7, bx+5, by+2, bx+5, by); ctx.fill();
      ctx.restore();
    }
  }

  // Jump scare overlay — drawn outside the shake transform
  if (state.jumpScareTimer > 0) drawJumpScare(ctx, W, H, state.jumpScareTimer);
}

// Fixed crack geometry so the face doesn't flicker between frames
const CRACK_BENDS = [0.12, -0.09, 0.16, -0.13, 0.08, -0.17, 0.11, -0.07];
const CRACK_LENS  = [1.35, 1.48, 1.28, 1.52, 1.40, 1.32, 1.45, 1.38];

function drawJumpScare(ctx, W, H, t) {
  // t: 1.0 = just triggered → 0.0 = done; hold peak then fade
  const alpha = t > 0.6 ? 1.0 : t / 0.6;
  ctx.save();

  // Blood-red full-screen wash
  ctx.fillStyle = `rgba(130,0,0,${alpha * 0.94})`;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.43;
  const sz = Math.min(W, H) * 0.46;

  // Dark head mass
  ctx.fillStyle = `rgba(4,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, sz * 0.68, sz * 0.84, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const eyeOffX = sz * 0.26, eyeY = cy - sz * 0.13;
  for (const ex of [cx - eyeOffX, cx + eyeOffX]) {
    const er = sz * 0.17;
    // Bleed glow
    const grd = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, er * 3.4);
    grd.addColorStop(0,    `rgba(255,55,0,${alpha})`);
    grd.addColorStop(0.35, `rgba(210,0,0,${alpha * 0.5})`);
    grd.addColorStop(1,    'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(ex - er * 3.6, eyeY - er * 3.6, er * 7.2, er * 7.2);
    // Sclera
    ctx.fillStyle = `rgba(255,215,165,${alpha})`;
    ctx.beginPath(); ctx.ellipse(ex, eyeY, er, er * 1.12, 0, 0, Math.PI * 2); ctx.fill();
    // Iris
    ctx.fillStyle = `rgba(175,0,0,${alpha})`;
    ctx.beginPath(); ctx.arc(ex, eyeY, er * 0.62, 0, Math.PI * 2); ctx.fill();
    // Slit pupil
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath(); ctx.ellipse(ex, eyeY, er * 0.13, er * 0.56, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Mouth — gaping with teeth
  const mY = cy + sz * 0.26, mW = sz * 0.70, mH = sz * 0.36;
  // Dark maw cavity
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, mY + mH * 0.32, mW * 0.48, mH * 0.60, 0, 0, Math.PI * 2);
  ctx.fill();
  // Upper teeth
  ctx.fillStyle = `rgba(215,200,175,${alpha})`;
  const tW = mW / 9;
  for (let i = 0; i < 8; i++) {
    const tx = cx - mW * 0.5 + (i + 0.5) * tW;
    const th = mH * (i % 3 === 1 ? 0.38 : 0.24);
    ctx.beginPath();
    ctx.moveTo(tx - tW * 0.44, mY);
    ctx.lineTo(tx + tW * 0.44, mY);
    ctx.lineTo(tx + tW * 0.18, mY + th);
    ctx.lineTo(tx - tW * 0.18, mY + th);
    ctx.closePath(); ctx.fill();
  }
  // Lower teeth
  const mBot = mY + mH * 0.82;
  for (let i = 0; i < 5; i++) {
    const tx = cx - mW * 0.36 + i * (mW * 0.72 / 4);
    ctx.beginPath();
    ctx.moveTo(tx - tW * 0.38, mBot);
    ctx.lineTo(tx + tW * 0.38, mBot);
    ctx.lineTo(tx, mBot - mH * 0.20);
    ctx.closePath(); ctx.fill();
  }

  // Radiating cracks
  ctx.strokeStyle = `rgba(55,0,0,${alpha * 0.55})`;
  ctx.lineWidth = Math.max(1, sz * 0.016);
  for (let i = 0; i < 8; i++) {
    const ang  = (i / 8) * Math.PI * 2 + 0.38;
    const bend = CRACK_BENDS[i];
    const endR = sz * CRACK_LENS[i];
    const r0   = sz * 0.66, r1 = r0 + (endR - r0) * 0.38, r2 = r0 + (endR - r0) * 0.70;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r0,         cy + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang + bend) * r1,  cy + Math.sin(ang + bend) * r1);
    ctx.lineTo(cx + Math.cos(ang - bend) * r2,  cy + Math.sin(ang - bend) * r2);
    ctx.lineTo(cx + Math.cos(ang) * endR,        cy + Math.sin(ang) * endR);
    ctx.stroke();
  }

  // Jumpscare face sprite — layered on top via screen blend (black bg → transparent)
  const jsSpr = getSprite('jumpscareface');
  if (jsSpr) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = alpha;
    ctx.drawImage(jsSpr, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
