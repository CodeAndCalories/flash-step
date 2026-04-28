import { settings, saveSettings } from './settings.js';
import { setMasterVolume } from './audio.js';

// Apply stored volume immediately (AudioContext may not exist yet — setMasterVolume handles that)
setMasterVolume(settings.masterVolume);

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

// ── Options controls ───────────────────────────────────────────────────────────

const volSlider   = document.getElementById('opt-volume');
const flashSlider = document.getElementById('opt-flash');
const shakeBtn    = document.getElementById('opt-shake');

// Seed controls from loaded settings
volSlider.value   = settings.masterVolume;
flashSlider.value = settings.flashFade;
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

function syncShakeBtn() {
  shakeBtn.textContent = settings.screenshake ? 'ON' : 'OFF';
  shakeBtn.setAttribute('aria-pressed', String(settings.screenshake));
}
