import { state } from './state.js';

export const FOV  = Math.PI / 2.3;
export const HFOV = FOV / 2;
export const MAXD = 18;
export const NR   = 240;

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

  const hs = bob * H * 0.28;

  if (lit > 0) {
    const cg = ctx.createLinearGradient(0, 0, 0, H / 2 + hs);
    cg.addColorStop(0, `rgba(5,3,3,${lit})`);
    cg.addColorStop(1, `rgba(18,10,10,${lit})`);
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H / 2 + hs);
    const fg = ctx.createLinearGradient(0, H / 2 + hs, 0, H);
    fg.addColorStop(0, `rgba(14,8,8,${lit})`);
    fg.addColorStop(1, `rgba(3,1,1,${lit})`);
    ctx.fillStyle = fg;
    ctx.fillRect(0, H / 2 + hs, W, H);
  }

  const cw = W / NR, zb = new Float32Array(NR);

  // Full colour render while lit
  if (lit > 0) {
    for (let i = 0; i < NR; i++) {
      const ra = P.angle - HFOV + (i / NR) * FOV;
      const { dist, goal, side, wx } = cast(P.x, P.y, ra);
      zb[i] = dist;
      const corr = dist * Math.cos(ra - P.angle);
      const wh   = Math.min(H / corr * 0.9, H * 2.5);
      const top  = (H - wh) / 2 + hs;
      const br   = Math.pow(Math.max(0, 1 - corr / MAXD), 1.08) * lit;
      let r, g, b;
      if (goal) {
        const gp = 0.7 + 0.3 * Math.sin(Date.now() * 0.003);
        r = (4 + br * 18) | 0; g = (25 + br * 170 * gp) | 0; b = (4 + br * 22) | 0;
      } else {
        const sv     = side === 1 ? 0.72 : 1.0;
        const mortar = (wx > 0.47 && wx < 0.53) ? 0.6 : 1.0;
        const shade  = br * sv * mortar;
        r = (18 + shade * 115) | 0; g = (10 + shade * 58) | 0; b = (10 + shade * 62) | 0;
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(i * cw, top, cw + 1, wh);
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
    for (const crumb of state.crumbs) {
      const cdx = crumb.x - P.x, cdy = crumb.y - P.y;
      const cdist2 = cdx * cdx + cdy * cdy;
      if (cdist2 < 0.09 || cdist2 > 64) continue;          // skip <0.3 or >8 units
      const cdist = Math.sqrt(cdist2);
      let ca = Math.atan2(cdy, cdx) - P.angle;
      while (ca >  Math.PI) ca -= Math.PI * 2;
      while (ca < -Math.PI) ca += Math.PI * 2;
      if (Math.abs(ca) > HFOV) continue;                    // outside screen width
      const csx = W / 2 + (ca / HFOV) * (W / 2);
      const col = Math.max(0, Math.min(NR - 1, (csx / W * NR) | 0));
      if (zb[col] < cdist) continue;                        // behind a wall
      const cph  = H * 1.65 / cdist;
      const cy   = H / 2 + cph * 0.30 + hs;
      if (cy > H) continue;
      const alpha = Math.pow(1 - cdist / 8, 1.8) * lit * 0.20;
      if (alpha < 0.012) continue;
      const r = Math.max(1, H * 0.007 / cdist);
      ctx.fillStyle = `rgba(185,162,148,${alpha})`;
      ctx.fillRect(csx - r, cy - r * 0.5, r * 2, r);       // slightly wide, flat dot
    }
  }

  // Battery pickups
  const now = Date.now();
  for (const b of state.batteries) {
    const bdx = b.x - P.x, bdy = b.y - P.y;
    const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
    if (bdist < 0.15 || bdist > MAXD) continue;
    let ba2 = Math.atan2(bdy, bdx) - P.angle;
    while (ba2 >  Math.PI) ba2 -= Math.PI * 2;
    while (ba2 < -Math.PI) ba2 += Math.PI * 2;
    if (Math.abs(ba2) > HFOV * 1.4) continue;

    const bsx  = W / 2 + (ba2 / HFOV) * (W / 2);
    const bph  = Math.min(H * 1.65 / bdist, H * 3.5);
    const bCy  = H / 2 + bph * 0.3;
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.004 + b.x * 2.1);

    // Ambient amber glow — visible in the dark up to 5 units
    if (bdist < 5) {
      const gAlpha = Math.pow(1 - bdist / 5, 1.8) * 0.55 * pulse;
      const gRad   = Math.max(8, bph * 0.22);
      const grd    = ctx.createRadialGradient(bsx, bCy, 0, bsx, bCy, gRad * 2.8);
      grd.addColorStop(0,   `rgba(255,185,30,${gAlpha})`);
      grd.addColorStop(0.5, `rgba(200,110,5,${gAlpha * 0.4})`);
      grd.addColorStop(1,   'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(bsx - gRad * 3, bCy - gRad * 3, gRad * 6, gRad * 6);
    }

    // Full sprite — only when flash is on, depth-tested
    if (lit > 0) {
      const bh  = Math.max(5, bph * 0.14);
      const bw  = bh * 0.52;
      const sc0 = Math.max(0, ((bsx - bw) / W * NR) | 0);
      const sc1 = Math.min(NR - 1, ((bsx + bw) / W * NR) | 0);
      ctx.save();
      ctx.beginPath();
      for (let sc = sc0; sc <= sc1; sc++) if (zb[sc] > bdist) ctx.rect(sc * cw, 0, cw + 1, H);
      ctx.clip();

      const litA = Math.min(1, lit * 1.2) * Math.min(1, 5 / bdist) * pulse;
      // Halo
      const grd2 = ctx.createRadialGradient(bsx, bCy, 0, bsx, bCy, bh * 3.2);
      grd2.addColorStop(0, `rgba(255,210,60,${litA})`);
      grd2.addColorStop(1, 'transparent');
      ctx.fillStyle = grd2;
      ctx.fillRect(bsx - bh * 3.5, bCy - bh * 3.5, bh * 7, bh * 7);
      // Casing
      ctx.fillStyle = `rgba(28,20,3,${litA})`;
      ctx.fillRect(bsx - bw * 0.5, bCy - bh * 0.5, bw, bh);
      // Terminal nub
      ctx.fillStyle = `rgba(255,195,45,${litA})`;
      ctx.fillRect(bsx - bw * 0.18, bCy - bh * 0.62, bw * 0.36, bh * 0.15);
      // Charge fill
      ctx.fillStyle = `rgba(255,220,65,${litA * pulse})`;
      ctx.fillRect(bsx - bw * 0.36, bCy - bh * 0.32, bw * 0.72, bh * 0.58);

      ctx.restore();
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
    ctx.fillStyle = `rgba(5,1,1,${ba})`;
    ctx.fillRect(sprX + sw * 0.23, sprY + ph * 0.2, sw * 0.54, ph * 0.76);
    ctx.fillStyle = `rgba(8,2,2,${ba})`;
    ctx.beginPath(); ctx.ellipse(sx, sprY + ph * 0.13, sw * 0.26, ph * 0.16, 0, 0, Math.PI * 2); ctx.fill();

    const ela  = Math.min(1, lit * 1.3) * eyePulse;
    const esz2 = Math.max(1.5, ph * 0.036), eo2 = Math.max(2, ph * 0.088), ey2 = sprY + ph * 0.1;
    [sx - eo2, sx + eo2].forEach(ex => {
      const eg = ctx.createRadialGradient(ex, ey2, 0, ex, ey2, esz2 * 3.5);
      eg.addColorStop(0, `rgba(255,45,45,${ela})`); eg.addColorStop(1, 'transparent');
      ctx.fillStyle = eg;
      ctx.fillRect(ex - esz2 * 4, ey2 - esz2 * 4, esz2 * 8, esz2 * 8);
      ctx.fillStyle = `rgba(255,235,195,${ela})`;
      ctx.beginPath(); ctx.arc(ex, ey2, esz2, 0, Math.PI * 2); ctx.fill();
    });

    if (ph > 45) {
      ctx.strokeStyle = `rgba(4,1,1,${ba * 0.8})`; ctx.lineWidth = Math.max(1, sw * 0.06);
      ctx.beginPath(); ctx.moveTo(sx - sw * 0.17, sprY + ph * 0.44); ctx.lineTo(sx - sw * 0.6, sprY + ph * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + sw * 0.17, sprY + ph * 0.44); ctx.lineTo(sx + sw * 0.6, sprY + ph * 0.7); ctx.stroke();
    }
    ctx.restore();
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
      ctx.fillStyle = cv === 1 ? '#150808' : cv === 2 ? '#005518' : '#0e0808';
      ctx.fillRect(mx2 + c * ms, my2 + r * ms, ms, ms);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(mx2 + P.x * ms - 1.5, my2 + P.y * ms - 1.5, 3, 3);
    ctx.fillStyle = '#ff2020'; ctx.fillRect(mx2 + E.x * ms - 1.5, my2 + E.y * ms - 1.5, 3, 3);
    ctx.fillStyle = '#ffcc22';
    for (const b of state.batteries) ctx.fillRect(mx2 + b.x * ms - 1, my2 + b.y * ms - 1, 2, 2);
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx2 + P.x * ms, my2 + P.y * ms);
    ctx.lineTo(mx2 + (P.x + Math.cos(P.angle) * 2.5) * ms, my2 + (P.y + Math.sin(P.angle) * 2.5) * ms);
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.restore();
  }

  ctx.restore();

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

  ctx.restore();
}
