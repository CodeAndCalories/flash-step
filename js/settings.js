export const settings = {
  masterVolume: 0.8,
  flashFade:    1.0,  // multiplier: 0.4 = slow fade, 2.0 = fast fade
  screenshake:  true,
};

// Auto-load on first import — no explicit init call needed
try {
  const s = JSON.parse(localStorage.getItem('flashstep-settings') || '{}');
  if (typeof s.masterVolume === 'number')  settings.masterVolume = s.masterVolume;
  if (typeof s.flashFade    === 'number')  settings.flashFade    = s.flashFade;
  if (typeof s.screenshake  === 'boolean') settings.screenshake  = s.screenshake;
} catch(e) {}

export function saveSettings() {
  try { localStorage.setItem('flashstep-settings', JSON.stringify(settings)); } catch(e) {}
}
