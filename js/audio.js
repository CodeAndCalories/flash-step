let audioCtx = null;

export function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

let _masterVol     = 1.0;
let masterGainNode = null;

function getMasterGain() {
  if (!masterGainNode) {
    const ctx = getAudio();
    masterGainNode = ctx.createGain();
    masterGainNode.gain.value = _masterVol;
    masterGainNode.connect(ctx.destination);
  }
  return masterGainNode;
}

export function setMasterVolume(v) {
  _masterVol = v;
  if (masterGainNode) masterGainNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
}

export function suspendAudio() {
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
}
export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

export function tone(freq, type, dur, vol = 0.15, delay = 0) {
  try {
    const a = getAudio(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(getMasterGain());
    o.type = type; o.frequency.value = freq;
    const t = a.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  } catch(e) {}
}

export function playShutter() {
  tone(900, 'square', 0.025, 0.07);
  tone(350, 'square', 0.05, 0.04, 0.02);
}

export function playFootstep() {
  try {
    const a = getAudio();
    const buf = a.createBuffer(1, a.sampleRate * 0.055, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / (d.length * 0.25));
    const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 280;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(getMasterGain());
    g.gain.value = 0.22; src.start();
  } catch(e) {}
}

export function playHeartbeat(intensity) {
  try {
    const a = getAudio(), t = a.currentTime;
    const thump = (when, vol) => {
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(getMasterGain());
      o.type = 'sine'; o.frequency.setValueAtTime(46, when);   // deeper (was 58)
      o.frequency.exponentialRampToValueAtTime(20, when + 0.15); // lower thud (was 28/0.12)
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.26);
      o.start(when); o.stop(when + 0.28);
    };
    thump(t, 0.224 * intensity);       // -20% (was 0.28)
    thump(t + 0.15, 0.112 * intensity); // -20% (was 0.14)
  } catch(e) {}
}

export function playCatch() {
  for (let i = 0; i < 7; i++) tone(75 - i * 6, 'sawtooth', 0.35, 0.35, i * 0.065);
  tone(200, 'square', 0.9, 0.18, 0.08);
}

export function playWin() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.4, 0.14, i * 0.11));
}

export function playPickup() {
  tone(660,  'sine', 0.06, 0.11);
  tone(880,  'sine', 0.09, 0.10, 0.055);
  tone(1320, 'sine', 0.13, 0.08, 0.100);
}

export function playScreech() {
  try {
    const a = getAudio();
    const buf = a.createBuffer(1, a.sampleRate * 0.18, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 0.25);
    const src = a.createBufferSource(), g = a.createGain();
    src.buffer = buf; src.connect(g); g.connect(getMasterGain());
    g.gain.value = 1.0; src.start();
  } catch(e) {}
  tone(920,  'sawtooth', 0.22, 0.5);
  tone(1380, 'sawtooth', 0.18, 0.4, 0.015);
  tone(680,  'sawtooth', 0.24, 0.45, 0.008);
}

// ── Ambient audio ─────────────────────────────────────────────────────────────

let ambientRunning = false;
let windNodes = null; // { src, lfo, filterLfo, master }

export function startAmbient() {
  // Stop any previous instance immediately before starting fresh
  ambientRunning = false;
  if (windNodes) {
    const n = windNodes; windNodes = null;
    try { n.src.stop(); }       catch(e) {}
    try { n.lfo.stop(); }       catch(e) {}
    try { n.filterLfo.stop(); } catch(e) {}
  }
  ambientRunning = true;
  startWind();
  scheduleDrip();
  scheduleWindMoan();
}

export function stopAmbient() {
  ambientRunning = false;
  if (windNodes) {
    const n = windNodes; windNodes = null;
    try {
      const a = getAudio();
      n.master.gain.cancelScheduledValues(a.currentTime);
      n.master.gain.setValueAtTime(n.master.gain.value, a.currentTime);
      n.master.gain.linearRampToValueAtTime(0, a.currentTime + 1.4);
      setTimeout(() => {
        try { n.src.stop(); }       catch(e) {}
        try { n.lfo.stop(); }       catch(e) {}
        try { n.filterLfo.stop(); } catch(e) {}
      }, 1500);
    } catch(e) {}
  }
}

function startWind() {
  try {
    const a = getAudio(), sr = a.sampleRate;

    // 4-second looping white-noise buffer
    const buf = a.createBuffer(1, sr * 4, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = a.createBufferSource();
    src.buffer = buf; src.loop = true;

    // Bandpass → lowpass to carve wind shape out of noise
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.65;

    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;

    // Slow amplitude gust — LFO drives windGain
    const windGain = a.createGain();
    windGain.gain.value = 0.042;

    const lfo = a.createOscillator();
    lfo.frequency.value = 0.07 + Math.random() * 0.06; // 0.07–0.13 Hz
    const lfoG = a.createGain(); lfoG.gain.value = 0.022;
    lfo.connect(lfoG); lfoG.connect(windGain.gain);

    // Slow filter-frequency waver for tonal movement
    const filterLfo = a.createOscillator();
    filterLfo.frequency.value = 0.12 + Math.random() * 0.09;
    const filterLfoG = a.createGain(); filterLfoG.gain.value = 68;
    filterLfo.connect(filterLfoG); filterLfoG.connect(bp.frequency);

    // Master gain — fades the whole wind layer in and out
    const master = a.createGain();
    master.gain.setValueAtTime(0, a.currentTime);
    master.gain.linearRampToValueAtTime(1, a.currentTime + 5);

    src.connect(bp); bp.connect(lp); lp.connect(windGain);
    windGain.connect(master); master.connect(getMasterGain());

    src.start(); lfo.start(); filterLfo.start();
    windNodes = { src, lfo, filterLfo, master };
  } catch(e) {}
}

function playDrip() {
  try {
    const a = getAudio();
    // Short noise click shaped with steep decay
    const len = Math.floor(a.sampleRate * (0.005 + Math.random() * 0.007));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);

    const src = a.createBufferSource();
    // Bandpass resonance gives each drip its tonal character
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 900; // 900–1800 Hz
    bp.Q.value = 7 + Math.random() * 5;

    const g = a.createGain();
    const t = a.currentTime;
    g.gain.setValueAtTime(0.05 + Math.random() * 0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22 + Math.random() * 0.18);

    src.buffer = buf;
    src.connect(bp); bp.connect(g); g.connect(getMasterGain());
    src.start();
  } catch(e) {}
}

function scheduleDrip() {
  const wait = 2000 + Math.random() * 6500;
  setTimeout(() => {
    if (!ambientRunning) return;
    playDrip();
    // 30 % chance of a quick double-drip
    if (Math.random() < 0.3)
      setTimeout(() => { if (ambientRunning) playDrip(); }, 85 + Math.random() * 115);
    scheduleDrip();
  }, wait);
}

function playWindMoan() {
  try {
    const a = getAudio();
    const dur  = 1.6 + Math.random() * 2.8;
    const freq = 46 + Math.random() * 95; // 46–141 Hz

    // Two slightly detuned sines for a natural chorus beat
    const o1 = a.createOscillator(), o2 = a.createOscillator();
    o1.type = 'sine'; o1.frequency.value = freq;
    o2.type = 'sine'; o2.frequency.value = freq * 1.009;

    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 210;

    const g = a.createGain();
    const t = a.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.052, t + dur * 0.32);
    g.gain.setValueAtTime(0.052, t + dur * 0.68);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(getMasterGain());
    o1.start(t); o1.stop(t + dur + 0.1);
    o2.start(t); o2.stop(t + dur + 0.1);
  } catch(e) {}
}

function scheduleWindMoan() {
  const wait = 9000 + Math.random() * 14000;
  setTimeout(() => {
    if (!ambientRunning) return;
    playWindMoan();
    scheduleWindMoan();
  }, wait);
}

// ── Exit hum ──────────────────────────────────────────────────────────────────
// Quiet directional tone tied to goal proximity; runs independently of flash.

let humNodes = null;

export function startExitHum() {
  if (humNodes) return;
  try {
    const a = getAudio();
    // Three-oscillator minor chord — root + minor-third + fifth give a sense of safety/arrival
    const o1 = a.createOscillator(), o2 = a.createOscillator(), o3 = a.createOscillator();
    o1.type = 'sine'; o1.frequency.value = 62.0;   // root
    o2.type = 'sine'; o2.frequency.value = 73.8;   // minor third (~62 × 1.19)
    o3.type = 'sine'; o3.frequency.value = 93.0;   // fifth (~62 × 1.50)

    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 200;

    const gain   = a.createGain();         gain.gain.value = 0;
    const panner = a.createStereoPanner(); panner.pan.value = 0;

    o1.connect(lp); o2.connect(lp); o3.connect(lp);
    lp.connect(gain); gain.connect(panner); panner.connect(getMasterGain());
    o1.start(); o2.start(); o3.start();
    humNodes = { o1, o2, o3, gain, panner };
  } catch(e) {}
}

export function stopExitHum() {
  if (!humNodes) return;
  const n = humNodes; humNodes = null;
  try {
    n.gain.gain.setTargetAtTime(0, getAudio().currentTime, 0.25);
    setTimeout(() => { try { n.o1.stop(); n.o2.stop(); n.o3.stop(); } catch(e) {} }, 900);
  } catch(e) {}
}

export function updateExitHum(dist, pan) {
  if (!humNodes) return;
  try {
    const a = getAudio();
    // Volume: inaudible beyond 12 units, curves up steeply close to goal
    const t          = Math.max(0, 1 - dist / 12);
    const targetGain = Math.pow(t, 2.2) * 0.060;
    humNodes.gain.gain.setTargetAtTime(targetGain, a.currentTime, 0.12);
    // Pan: soft L/R nudge based on goal bearing (±0.6 max)
    humNodes.panner.pan.setTargetAtTime(pan, a.currentTime, 0.08);
  } catch(e) {}
}

// ── Panic audio ───────────────────────────────────────────────────────────────

// Distant muffled warning screech — triggered at panic level 1 (3 s hold)
export function playPanicWarning() {
  try {
    const a = getAudio();
    const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = 175;
    f.type = 'lowpass';  f.frequency.value  = 360; f.Q.value = 1.8;
    const t = a.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(f); f.connect(g); g.connect(getMasterGain());
    o.start(t); o.stop(t + 1.15);
  } catch(e) {}
  tone(88, 'square', 0.28, 0.07, 0.06);
}

// Heavy spatial footstep — panned to enemy bearing
function playPanicFootstep(pan, vol) {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.09);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(Math.max(0, 1 - i / (len * 0.12)), 2.2);
    const src    = a.createBufferSource();
    const lp     = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const g      = a.createGain();         g.gain.value = vol;
    const panner = a.createStereoPanner(); panner.pan.value = pan;
    src.buffer = buf;
    src.connect(lp); lp.connect(g); g.connect(panner); panner.connect(getMasterGain());
    src.start();
  } catch(e) {}
}

// Heavy exhale — level 3 only
function playPanicBreath(pan) {
  try {
    const a   = getAudio();
    const len = Math.floor(a.sampleRate * (0.4 + Math.random() * 0.18));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src    = a.createBufferSource();
    const bp     = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 580; bp.Q.value = 1.8;
    const g      = a.createGain();         g.gain.value = 0.13;
    const panner = a.createStereoPanner(); panner.pan.value = pan;
    src.buffer = buf;
    src.connect(bp); bp.connect(g); g.connect(panner); panner.connect(getMasterGain());
    src.start();
  } catch(e) {}
}

// AudioContext-time scheduling — called every game frame while panic > 0
let _stepNext  = 0;
let _breathNext = 0;

export function updatePanicAudio(level, pan, dist) {
  if (level === 0) return;
  try {
    const a    = getAudio();
    const now  = a.currentTime;
    const intervals = [0, 0, 0.36, 0.17]; // seconds between footsteps
    const interval  = intervals[Math.min(level, 3)];
    const vol  = Math.min(1, 2.2 / Math.max(0.6, dist)) * (0.22 + level * 0.11);

    if (interval > 0 && now >= _stepNext) {
      _stepNext = now + interval * (0.85 + Math.random() * 0.3);
      playPanicFootstep(pan, vol);
    }
    if (level >= 3 && now >= _breathNext) {
      _breathNext = now + 0.60 + Math.random() * 0.35;
      playPanicBreath(pan * 0.5);
    }
  } catch(e) {}
}

export function resetPanicAudio() {
  _stepNext   = 0;
  _breathNext = 0;
}

// ── New feature sounds ────────────────────────────────────────────────────────

export function playPaperRustle() {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.18);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len) * 0.4;
    const src = a.createBufferSource();
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.7;
    const g = a.createGain(); g.gain.value = 0.20;
    src.buffer = buf; src.connect(bp); bp.connect(g); g.connect(getMasterGain()); src.start();
  } catch(e) {}
}

export function playBatScreech() {
  tone(2900, 'sawtooth', 0.06, 0.09);
  tone(3700, 'sine',     0.08, 0.07, 0.018);
  tone(2100, 'square',   0.05, 0.06, 0.008);
}

export function playRatSkitter() {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.042);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const src = a.createBufferSource();
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const g = a.createGain(); g.gain.value = 0.16;
    src.buffer = buf; src.connect(hp); hp.connect(g); g.connect(getMasterGain()); src.start();
  } catch(e) {}
}

export function playWebStick() {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.12);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.5) * 0.28;
    const src = a.createBufferSource();
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.5;
    const g = a.createGain(); g.gain.value = 0.24;
    src.buffer = buf; src.connect(bp); bp.connect(g); g.connect(getMasterGain()); src.start();
  } catch(e) {}
}

export function playBlindClick(pan, intensity) {
  try {
    const a = getAudio(), t = a.currentTime;
    const p = a.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    // Sharp sonar ping — sine sweep from high to mid, distinct from heartbeat
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(2800, t);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.030);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.028 * intensity, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
    o.connect(g); g.connect(p); p.connect(getMasterGain());
    o.start(t); o.stop(t + 0.048);
    // Faint reverb tail
    const o2 = a.createOscillator(), g2 = a.createGain();
    o2.type = 'sine'; o2.frequency.value = 2000;
    g2.gain.setValueAtTime(0.010 * intensity, t + 0.014);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    o2.connect(g2); g2.connect(p);
    o2.start(t + 0.014); o2.stop(t + 0.09);
  } catch(e) {}
}

// Wet dragging sound — plays each time the Stalker takes a BFS step (very quiet)
export function playStalkerDrag() {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.12);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len) * 0.42;
    const src = a.createBufferSource();
    const lp  = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g   = a.createGain();         g.gain.value = 0.042;
    src.buffer = buf;
    src.connect(lp); lp.connect(g); g.connect(getMasterGain());
    src.start();
  } catch(e) {}
}

// Reversed-decay whisper — subtle Mimic movement tell
export function playMimicWhisper() {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.08);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(i / len, 0.5) * (1 - i / len); // grows then fades
    const src = a.createBufferSource();
    const lp  = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const g   = a.createGain();         g.gain.value = 0.055;
    src.buffer = buf;
    src.connect(lp); lp.connect(g); g.connect(getMasterGain());
    src.start();
  } catch(e) {}
}

// Mimic proximity ping — high ethereal tone, distinct from heartbeat
export function playCursedFlash() {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.35);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = i < len * 0.07 ? i / (len * 0.07) : Math.pow(1 - i / len, 0.4);
      d[i] = (Math.random() * 2 - 1) * env * (Math.random() < 0.22 ? 2.8 : 0.55);
    }
    const src = a.createBufferSource();
    const g   = a.createGain(); g.gain.value = 0.80;
    src.buffer = buf; src.connect(g); g.connect(getMasterGain()); src.start();
  } catch(e) {}
  tone(130, 'sawtooth', 0.55, 0.42);
  tone(195, 'square',   0.50, 0.32, 0.04);
  tone(78,  'sawtooth', 0.75, 0.48, 0.02);
}

// ── Reflection ambient ────────────────────────────────────────────────────────
// Flanged eerie noise for REFLECTION levels — reversed-wind feel

let reflAmbRunning = false;
let reflAmbNodes   = null;

export function startReflectionAmbient() {
  stopReflectionAmbient();
  reflAmbRunning = true;
  startReflWind();
  scheduleReflMoan();
}

export function stopReflectionAmbient() {
  reflAmbRunning = false;
  if (reflAmbNodes) {
    const n = reflAmbNodes; reflAmbNodes = null;
    try {
      const a = getAudio();
      n.master.gain.cancelScheduledValues(a.currentTime);
      n.master.gain.setValueAtTime(n.master.gain.value, a.currentTime);
      n.master.gain.linearRampToValueAtTime(0, a.currentTime + 1.2);
      setTimeout(() => {
        try { n.src.stop(); n.lfo.stop(); n.dlfo.stop(); } catch(e) {}
      }, 1300);
    } catch(e) {}
  }
}

function startReflWind() {
  try {
    const a = getAudio(), sr = a.sampleRate;
    const buf = a.createBuffer(1, sr * 4, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = a.createBufferSource();
    src.buffer = buf; src.loop = true;

    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 2.8;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass';  lp.frequency.value = 360;

    // Flanging via LFO-modulated short delay
    const delay = a.createDelay(0.025); delay.delayTime.value = 0.006;
    const dlfo  = a.createOscillator(); dlfo.frequency.value = 0.38 + Math.random() * 0.28;
    const dlfog = a.createGain();       dlfog.gain.value = 0.0038;
    dlfo.connect(dlfog); dlfog.connect(delay.delayTime);

    const wet   = a.createGain(); wet.gain.value  = 0.52;
    const dry   = a.createGain(); dry.gain.value  = 0.48;
    const mix   = a.createGain(); mix.gain.value  = 0.040;

    const lfo  = a.createOscillator(); lfo.frequency.value = 0.08 + Math.random() * 0.05;
    const lfog = a.createGain();       lfog.gain.value = 0.015;
    lfo.connect(lfog); lfog.connect(mix.gain);

    const master = a.createGain();
    master.gain.setValueAtTime(0, a.currentTime);
    master.gain.linearRampToValueAtTime(1, a.currentTime + 5);

    src.connect(bp); bp.connect(lp);
    lp.connect(dry); dry.connect(mix);
    lp.connect(delay); delay.connect(wet); wet.connect(mix);
    mix.connect(master); master.connect(getMasterGain());

    src.start(); lfo.start(); dlfo.start();
    reflAmbNodes = { src, lfo, dlfo, master };
  } catch(e) {}
}

function scheduleReflMoan() {
  const wait = 6000 + Math.random() * 10000;
  setTimeout(() => {
    if (!reflAmbRunning) return;
    try {
      const a   = getAudio();
      const dur = 2.0 + Math.random() * 2.5;
      const frq = 50 + Math.random() * 75;
      const o1  = a.createOscillator(), o2 = a.createOscillator();
      o1.type = 'sawtooth'; o1.frequency.value = frq;
      o2.type = 'sawtooth'; o2.frequency.value = frq * 0.997;
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 175;
      const g  = a.createGain(), t = a.currentTime;
      g.gain.setValueAtTime(0.042, t);
      g.gain.setValueAtTime(0.042, t + dur * 0.14);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(getMasterGain());
      o1.start(t); o1.stop(t + dur + 0.05);
      o2.start(t); o2.stop(t + dur + 0.05);
    } catch(e) {}
    scheduleReflMoan();
  }, wait);
}

// Footstep echo — delayed, heavily lowpassed copy played 280 ms after the real step
export function playReflectionEcho() {
  try {
    const a = getAudio();
    const buf = a.createBuffer(1, a.sampleRate * 0.08, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++)
      d[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / (d.length * 0.25));
    const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 110;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(getMasterGain());
    g.gain.value = 0.10;
    src.start();
  } catch(e) {}
}

// ── Audio hallucinations ──────────────────────────────────────────────────────
// Faint distant footsteps from a random direction — vol ~25% of real enemy sounds

let hallucinRunning = false;
let hallucinGen     = 0;

function playHallucinationStep(pan) {
  try {
    const a = getAudio();
    const len = Math.floor(a.sampleRate * 0.075);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(Math.max(0, 1 - i / (len * 0.12)), 2.4);
    const src    = a.createBufferSource();
    const lp     = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 185;
    const g      = a.createGain();         g.gain.value = 0.035;
    const panner = a.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.buffer = buf;
    src.connect(lp); lp.connect(g); g.connect(panner); panner.connect(getMasterGain());
    src.start();
  } catch(e) {}
}

export function startHallucinations(safeCheck, onVignette) {
  hallucinRunning = false;
  hallucinGen++;
  hallucinRunning = true;
  scheduleHallucination(safeCheck, onVignette, hallucinGen);
}

export function stopHallucinations() {
  hallucinRunning = false;
  hallucinGen++;
}

function scheduleHallucination(safeCheck, onVignette, gen) {
  const wait = 25000 + Math.random() * 35000; // 25–60 s
  setTimeout(() => {
    if (!hallucinRunning || hallucinGen !== gen) return;
    if (safeCheck()) {
      const pan = Math.random() * 2 - 1;
      playHallucinationStep(pan);
      // Second step ~45% of the time for realism
      if (Math.random() < 0.45) {
        setTimeout(() => {
          if (hallucinRunning && hallucinGen === gen && safeCheck())
            playHallucinationStep(pan * 0.72 + (Math.random() - 0.5) * 0.38);
        }, 155 + Math.random() * 135);
      }
      if (Math.random() < 0.2) onVignette();
    }
    scheduleHallucination(safeCheck, onVignette, gen);
  }, wait);
}

// ── Ending heartbeat ──────────────────────────────────────────────────────────
// Slow, quiet pulse used under the level-10 ending sequence

let endingHbRunning = false;

export function startEndingHeartbeat() {
  endingHbRunning = true;
  scheduleEndingHb();
}

export function stopEndingHeartbeat() {
  endingHbRunning = false;
}

function scheduleEndingHb() {
  if (!endingHbRunning) return;
  playHeartbeat(0.30);
  setTimeout(scheduleEndingHb, 1900 + Math.random() * 500);
}

export function playMimicPulse(intensity) {
  try {
    const a = getAudio(), t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = 520;
    o.connect(g); g.connect(getMasterGain());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.038 * intensity, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.start(t); o.stop(t + 0.58);
  } catch(e) {}
}

// ── Maze Master intercom ────────────────────────────────────────────────────────
// Static burst → low band-passed tremolo tone, panned slightly left (wall speaker).
export function playIntercom() {
  try {
    const a = getAudio(), t = a.currentTime;
    const panner = a.createStereoPanner(); panner.pan.value = -0.2;
    panner.connect(getMasterGain());

    // Static burst — 80 ms of white noise, gain 0.3
    const len = Math.floor(a.sampleRate * 0.08);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.35);
    const noise = a.createBufferSource(); noise.buffer = buf;
    const ng = a.createGain(); ng.gain.value = 0.3;
    noise.connect(ng); ng.connect(panner);
    noise.start(t);

    // Low band-passed tone — 180 Hz, gain 0.08, 1.2 s, 4 Hz tremolo, 400 ms fade-out
    const t0  = t + 0.06;
    const osc = a.createOscillator(); osc.type = 'sine'; osc.frequency.value = 180;
    const bp  = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 4;
    const tg  = a.createGain();
    tg.gain.setValueAtTime(0, t0);
    tg.gain.linearRampToValueAtTime(0.08, t0 + 0.05);
    tg.gain.setValueAtTime(0.08, t0 + 1.2);
    tg.gain.linearRampToValueAtTime(0, t0 + 1.6);   // fade out over 400 ms
    // Tremolo at 4 Hz, summed into the tone's gain param
    const trem  = a.createOscillator(); trem.type = 'sine'; trem.frequency.value = 4;
    const tremG = a.createGain(); tremG.gain.value = 0.03;
    trem.connect(tremG); tremG.connect(tg.gain);
    osc.connect(bp); bp.connect(tg); tg.connect(panner);
    osc.start(t0);  osc.stop(t0 + 1.65);
    trem.start(t0); trem.stop(t0 + 1.65);
  } catch(e) {}
}

// ── THE VOID — wall proximity sonar ─────────────────────────────────────────────
// Soft echo off an unseen surface. gain & pan supplied by the caller (proximity).
export function playWallProximity(gain, pan) {
  try {
    const a = getAudio(), t = a.currentTime;
    const panner = a.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan || 0));
    panner.connect(getMasterGain());

    // 60 ms white-noise burst, level scaled by proximity
    const len = Math.floor(a.sampleRate * 0.06);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.2);
    const src = a.createBufferSource(); src.buffer = buf;

    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 3.0;
    const g  = a.createGain(); g.gain.value = Math.max(0, gain || 0);

    // Soft echo tail — 80 ms delay with 0.3 feedback, feels like a reflection
    const delay = a.createDelay(0.25); delay.delayTime.value = 0.08;
    const fb    = a.createGain(); fb.gain.value = 0.3;

    src.connect(bp); bp.connect(g); g.connect(panner);
    g.connect(delay); delay.connect(fb); fb.connect(delay); fb.connect(panner);
    src.start(t);
  } catch(e) {}
}
