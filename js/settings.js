export const settings = {
  masterVolume:  0.8,
  flashFade:     1.0,   // multiplier: 0.4 = slow fade, 2.0 = fast fade
  screenshake:   true,
  controlScheme: 'auto', // 'auto' | 'mouse' | 'touch'
  mouseSens:     0.001,
};

// Auto-load on first import — no explicit init call needed
try {
  const s = JSON.parse(localStorage.getItem('flashstep-settings') || '{}');
  if (typeof s.masterVolume  === 'number')  settings.masterVolume  = s.masterVolume;
  if (typeof s.flashFade     === 'number')  settings.flashFade     = s.flashFade;
  if (typeof s.screenshake   === 'boolean') settings.screenshake   = s.screenshake;
  if (typeof s.controlScheme === 'string')  settings.controlScheme = s.controlScheme;
  if (typeof s.mouseSens     === 'number')  settings.mouseSens     = s.mouseSens;
} catch(e) {}

export function saveSettings() {
  try { localStorage.setItem('flashstep-settings', JSON.stringify(settings)); } catch(e) {}
}
