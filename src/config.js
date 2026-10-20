/**
 * Runtime settings. Gesture thresholds live here (not in the systems) so
 * they can be retuned on a real headset without touching logic.
 *
 * DEBUG (`?debug`) is only honoured in dev builds; in production builds
 * import.meta.env.DEV is false and the flag is inert.
 */
export const DEBUG = import.meta.env.DEV && new URLSearchParams(location.search).has('debug');

const STORAGE_KEY = 'fogweave.settings.v1';

export const settings = {
  // seated bubble (metres, relative to the head at session start)
  bubble: { forward: 1.05, down: 0.08, radius: 0.5 },
  props: {
    lockRadius: 0.2, // prop must be this close to a node to "find" it
    swingWindowMs: 650,
    swingMinReversals: 2,
    swingMinSpeed: 0.35, // m/s lateral
    flipMinTurnDeg: 150, // coin roll within the window
    flipWindowMs: 450,
    revealSeconds: 6,
    tapMaxMs: 450, // pinch+release this quick...
    tapMaxMove: 0.04, // ...and this still (m) counts as a tap
  },
  gestures: {
    flickMinSpeed: 1.6, // m/s wrist speed to dismiss a card with a flick
    flickMaxSpeed: 5, // faster than this is a tracking jump, not a hand
    flickWindowMs: 160,
    spawnDeferMs: 180, // time IWSDK gets to claim a pinch as a grab/press
  },
  layers: { includeFog: false }, // props/paths read the sealed layer by default
  quality: { level: 2, labels: 22, particles: 300, fogSheets: true, glow: 1, maxNodes: 60 },
  comfort: { gentle: false },
  audio: { enabled: true, readAloud: true },
  voice: { enabled: false }, // optional extra; never required
  feed: { autoExpand: true }, // touching a light also grows it into the web
};

const QUALITY_LEVELS = [
  // the governor drops decoration first (motes, fog sheets, glow), never labels below 8 or text
  { labels: 10, particles: 0, fogSheets: false, glow: 0.7, maxNodes: 60 },
  { labels: 16, particles: 150, fogSheets: false, glow: 0.85, maxNodes: 60 },
  { labels: 22, particles: 300, fogSheets: true, glow: 1, maxNodes: 60 },
];

export function setQuality(level) {
  const l = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, level));
  Object.assign(settings.quality, QUALITY_LEVELS[l], { level: l });
  return l;
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const k of ['layers', 'comfort', 'audio', 'voice']) Object.assign(settings[k], saved[k] || {});
  } catch {
    // defaults
  }
}

export function saveSettings() {
  try {
    const { layers, comfort, audio, voice } = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ layers, comfort, audio, voice }));
  } catch {
    // not persisted
  }
}
