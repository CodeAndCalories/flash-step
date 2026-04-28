import { state } from './state.js';
import { bfs, shuf } from './maze.js';

export function stepEnemy() {
  const { E, P, MAP, COLS, ROWS } = state;
  const gc = E.x | 0, gr = E.y | 0, pc = P.x | 0, pr = P.y | 0;
  if (gc === pc && gr === pr) return;
  const pass = (c, r) => MAP[r][c] !== 1;
  const dm = bfs(pass, COLS, ROWS, pc, pr);
  const cur = dm[gr][gc];
  if (cur <= 0) return;
  const dirs = shuf([[0, 1], [0, -1], [1, 0], [-1, 0]]);
  for (const [dc, dr] of dirs) {
    const nc = gc + dc, nr = gr + dr;
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || !pass(nc, nr)) continue;
    const d = dm[nr][nc];
    if (d >= 0 && d < cur) { E.x = nc + 0.5; E.y = nr + 0.5; return; }
  }
}

export function checkEnd() {
  const { P, E, MAP } = state;
  if (Math.sqrt((P.x - E.x) ** 2 + (P.y - E.y) ** 2) < 0.52) return 'dead';
  const pc = P.x | 0, pr = P.y | 0;
  if (MAP[pr] && MAP[pr][pc] === 2) return 'win';
  return null;
}

export function isWall(x, y, m = 0.3) {
  const { MAP, COLS, ROWS } = state;
  for (const [cx, cy] of [[x - m, y - m], [x + m, y - m], [x - m, y + m], [x + m, y + m]]) {
    const c = cx | 0, r = cy | 0;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS || MAP[r][c] === 1) return true;
  }
  return false;
}
