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
      o.type = 'sine'; o.frequency.setValueAtTime(58, when);
      o.frequency.exponentialRampToValueAtTime(28, when + 0.12);
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
      o.start(when); o.stop(when + 0.22);
    };
    thump(t, 0.28 * intensity);
    thump(t + 0.14, 0.14 * intensity);
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

export function playEmpty() {
  tone(95, 'square', 0.07, 0.06);
  tone(70, 'square', 0.09, 0.05, 0.055);
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
    // Two sines 0.6 Hz apart — the beating gives a slow organic tremolo
    const o1 = a.createOscillator(), o2 = a.createOscillator();
    o1.type = 'sine'; o1.frequency.value = 62.0;
    o2.type = 'sine'; o2.frequency.value = 62.6;

    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 185;

    const gain   = a.createGain();     gain.gain.value = 0;
    const panner = a.createStereoPanner(); panner.pan.value = 0;

    o1.connect(lp); o2.connect(lp);
    lp.connect(gain); gain.connect(panner); panner.connect(getMasterGain());
    o1.start(); o2.start();
    humNodes = { o1, o2, gain, panner };
  } catch(e) {}
}

export function stopExitHum() {
  if (!humNodes) return;
  const n = humNodes; humNodes = null;
  try {
    n.gain.gain.setTargetAtTime(0, getAudio().currentTime, 0.25);
    setTimeout(() => { try { n.o1.stop(); n.o2.stop(); } catch(e) {} }, 900);
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
