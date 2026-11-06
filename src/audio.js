/**
 * Calm ambient sound for the fog, generated with Web Audio (no audio files,
 * nothing to license): filtered brown noise like distant wind, plus two
 * soft drifting tones. Very quiet; starts only after a user gesture (browser
 * rule) and can be turned off in Settings. Read-aloud uses speechSynthesis
 * when the browser has it (an extra; the text is always on the card). Actions
 * have short soft sounds too, placed left or right of where they happen.
 */
import { settings } from './config.js';

const SCALE = [440, 523.3, 587.3, 659.3, 784, 880, 1046.5]; // A minor pentatonic, calm in any order

export class Ambient {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.on = false;
  }

  start(volume = 0.05) {
    if (this.on) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx ??= new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      // brown noise (wind)
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      this._noise = buf;
      noise.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.25;
      lfo.connect(lfoGain).connect(windGain.gain);
      noise.connect(lp).connect(windGain).connect(this.master);
      // two soft tones, slowly detuning
      const tones = [110, 164.8].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        const drift = ctx.createOscillator();
        drift.frequency.value = 0.03 + Math.random() * 0.02;
        const dg = ctx.createGain();
        dg.gain.value = 1.5;
        drift.connect(dg).connect(o.frequency);
        o.connect(g).connect(this.master);
        return [o, drift];
      });
      this.nodes = [noise, lfo, ...tones.flat()];
      for (const n of this.nodes) n.start();
      this.master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 4); // fade in, no sudden sound
      ctx.resume?.();
      this.on = true;
    } catch (err) {
      console.warn('[fogweave] ambient audio unavailable', err);
    }
  }

  /** One soft tone that dies away; pan is -1 (left) to 1 (right). */
  _tone(freq, { pan = 0, gain = 0.06, decay = 0.7, at = 0, type = 'sine' } = {}) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * this.soft, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    this._toOut(o.connect(g), pan);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  _toOut(node, pan) {
    const p = this.ctx.createStereoPanner?.();
    if (p) {
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(this.ctx.destination);
    } else node.connect(this.ctx.destination);
  }

  /** Air moving: rising when something opens, falling when it goes home. */
  whoosh({ pan = 0, down = false, gain = 0.05, seconds = 0.7 } = {}) {
    if (!this.on || !this.ctx || !this._noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this._noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(down ? 1500 : 320, t);
    f.frequency.exponentialRampToValueAtTime(down ? 260 : 1500, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * this.soft, t + seconds * 0.35);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    this._toOut(s.connect(f).connect(g), pan);
    s.start(t, Math.random() * 3);
    s.stop(t + seconds + 0.02);
  }

  get soft() {
    return settings.comfort.gentle ? 0.6 : 1;
  }

  /** A star opens. */
  chime(pan = 0) {
    this._tone(659.3, { pan, gain: 0.05, decay: 0.9 });
    this._tone(987.8, { pan, gain: 0.03, decay: 0.7, at: 0.05 });
  }

  /** A node opens: the next note of a calm scale, so a growing web plays a phrase. */
  pluck(pan = 0) {
    const now = this.ctx?.currentTime ?? 0;
    if (now - (this._pluckAt ?? -1) < 0.05) return;
    if (now - (this._pluckAt ?? -1) > 2) this._step = 0; // a new web starts the phrase again
    this._pluckAt = now;
    this._step = (this._step ?? 0) + 1;
    this._tone(SCALE[(this._step - 1) % SCALE.length], { pan, gain: 0.028, decay: 0.45 });
  }

  /** A button is pressed. */
  tick() {
    this._tone(880, { gain: 0.018, decay: 0.08, type: 'triangle' });
  }

  /** Something is kept: a low warm bell. */
  bell(pan = 0) {
    this._tone(392, { pan, gain: 0.055, decay: 1.4 });
    this._tone(784, { pan, gain: 0.02, decay: 1 });
  }

  /** News lands: a small high shimmer. */
  shimmer(pan = 0) {
    this._tone(1318.5, { pan, gain: 0.018, decay: 0.5 });
    this._tone(1760, { pan, gain: 0.012, decay: 0.45, at: 0.06 });
  }

  stop() {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.linearRampToValueAtTime(0, t + 1.5);
    const nodes = this.nodes;
    setTimeout(() => nodes.forEach((n) => n.stop()), 1700);
    this.on = false;
  }
}

export const speech = {
  available: () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function',
  speak(text) {
    if (!speech.available()) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
    return true;
  },
  stop() {
    if (speech.available()) window.speechSynthesis.cancel();
  },
  speaking: () => speech.available() && window.speechSynthesis.speaking,
};
