export function shuf(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * i | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function genMaze(cols, rows) {
  if (cols % 2 === 0) cols++;
  if (rows % 2 === 0) rows++;
  const g = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r % 2 === 0 || c % 2 === 0) ? 1 : 0)
  );
  const vis = new Set(['1,1']);
  const stk = [[1, 1]];
  while (stk.length) {
    const [r, c] = stk[stk.length - 1];
    const dirs = shuf([[0, 2], [0, -2], [2, 0], [-2, 0]]);
    let mv = false;
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1 && !vis.has(`${nr},${nc}`)) {
        vis.add(`${nr},${nc}`);
        g[r + dr / 2][c + dc / 2] = 0;
        stk.push([nr, nc]);
        mv = true;
        break;
      }
    }
    if (!mv) stk.pop();
  }
  // Extra loops for organic feel
  const cands = [];
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    if (!g[r][c]) continue;
    if (c > 0 && c < cols - 1 && !g[r][c - 1] && !g[r][c + 1]) cands.push([r, c]);
    else if (r > 0 && r < rows - 1 && !g[r - 1][c] && !g[r + 1][c]) cands.push([r, c]);
  }
  shuf(cands);
  for (let i = 0; i < Math.floor(cands.length * 0.28); i++) g[cands[i][0]][cands[i][1]] = 0;
  return { g, cols, rows };
}

export function findDeadEnds(MAP, COLS, ROWS) {
  const out = [];
  for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
    if (MAP[r][c] !== 0) continue;
    let open = 0;
    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]])
      if (MAP[r + dr]?.[c + dc] === 0) open++;
    if (open === 1) out.push([c, r]);
  }
  return out;
}

export function bfs(pass, cols, rows, fc, fr) {
  const d = Array.from({ length: rows }, () => new Int32Array(cols).fill(-1));
  d[fr][fc] = 0;
  const q = [[fc, fr]];
  while (q.length) {
    const [c, r] = q.shift();
    for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || !pass(nc, nr) || d[nr][nc] !== -1) continue;
      d[nr][nc] = d[r][c] + 1;
      q.push([nc, nr]);
    }
  }
  return d;
}
