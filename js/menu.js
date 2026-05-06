import { settings, saveSettings } from './settings.js';
import { setMasterVolume } from './audio.js';

// Apply stored volume immediately (AudioContext may not exist yet — setMasterVolume handles that)
setMasterVolume(settings.masterVolume);

// ── Photosensitivity warning ────────────────────────────────────────────────
(function () {
  const el = document.getElementById('photo-warning');
  if (sessionStorage.getItem('photoWarningSeen')) {
    el.style.display = 'none';
    return;
  }
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    sessionStorage.setItem('photoWarningSeen', '1');
    el.classList.add('fade-out');
    setTimeout(() => { el.style.display = 'none'; }, 650);
  };
  const timer = setTimeout(dismiss, 4000);
  el.addEventListener('click', dismiss);
  el.addEventListener('touchend', dismiss, { passive: true });
}());

// ── Panel navigation ───────────────────────────────────────────────────────────

const panels = {
  main:    document.getElementById('menu-main'),
  options: document.getElementById('menu-options'),
  exit:    document.getElementById('menu-exit'),
};

function showPanel(name) {
  Object.values(panels).forEach(p => p.classList.remove('active'));
  panels[name].classList.add('active');
}

document.getElementById('btn-options').addEventListener('click',  () => showPanel('options'));
document.getElementById('btn-exit').addEventListener('click',     () => showPanel('exit'));
document.getElementById('btn-opts-back').addEventListener('click',() => showPanel('main'));
document.getElementById('btn-exit-back').addEventListener('click',() => showPanel('main'));

// How to Play — shared overlay (also used from pause screen via game.js)
const howtoOverlay = document.getElementById('howto-overlay');
document.getElementById('btn-howto').addEventListener('click',   () => { howtoOverlay.style.display = 'flex'; });
document.getElementById('howto-back').addEventListener('click',  () => { howtoOverlay.style.display = 'none'; });

// ── Options controls ───────────────────────────────────────────────────────────

const volSlider   = document.getElementById('opt-volume');
const flashSlider = document.getElementById('opt-flash');
const shakeBtn    = document.getElementById('opt-shake');
const sensSlider  = document.getElementById('opt-sens');

// Seed controls from loaded settings
volSlider.value   = settings.masterVolume;
flashSlider.value = settings.flashFade;
sensSlider.value  = settings.mouseSens;
syncShakeBtn();

volSlider.addEventListener('input', () => {
  settings.masterVolume = parseFloat(volSlider.value);
  setMasterVolume(settings.masterVolume);
  saveSettings();
});

flashSlider.addEventListener('input', () => {
  settings.flashFade = parseFloat(flashSlider.value);
  saveSettings();
});

shakeBtn.addEventListener('click', () => {
  settings.screenshake = !settings.screenshake;
  syncShakeBtn();
  saveSettings();
});

sensSlider.addEventListener('input', () => {
  settings.mouseSens = parseFloat(sensSlider.value);
  saveSettings();
});

function syncShakeBtn() {
  shakeBtn.textContent = settings.screenshake ? 'ON' : 'OFF';
  shakeBtn.setAttribute('aria-pressed', String(settings.screenshake));
}

