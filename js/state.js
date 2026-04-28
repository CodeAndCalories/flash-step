export const state = {
  canvas: null,
  ctx: null,
  W: 0,
  H: 0,

  MAP: null,
  COLS: 0,
  ROWS: 0,

  P: { x: 1.5, y: 1.5, angle: 0 },
  E: { x: 0, y: 0, moveTimer: 0 },
  ENEMY_MS: 900,

  gameState: 'menu',
  level: 1,

  flashCount: 0,
  flashHeld: false,
  flashAlpha: 0,
  flashDecay: 0,
  outlineAlpha: 0,
  flashHeldMs: 0,

  lastTime: 0,
  frameId: null,

  bobTimer: 0,
  isMoving: false,
  footstepTimer: 0,
  heartbeatTimer: 0,

  shakeX: 0,
  shakeY: 0,
  shakeAmt: 0,

  firstFlashDone: false,
  minimapTimer: 0,

  keys: {},
  dpad: { fwd: false, back: false, turnL: false, turnR: false },
  lookStart: null,
  lookDelta: 0,
  batteries: [],
  decoys: [],
  crumbs: [],
  jumpScareTimer: 0,
  paused: false,
  flashDrainCount: 0,
  panicLevel: 0,
  panicDecayTimer: 0,
  baseEnemyMS: 900,
  playerHistory:   [],
  historyTimer:    0,
  M:               { x: 1.5, y: 1.5, active: false, moveTimer: 0 },
  mimicSoundTimer: 0,
  afterimage:      null,
  lastKnownEnemy:  null,
};
