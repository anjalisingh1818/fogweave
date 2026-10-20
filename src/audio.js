/**
 * Calm ambient sound for the fog, generated with Web Audio (no audio files,
 * nothing to license): filtered brown noise like distant wind, plus two
 * soft drifting tones. Very quiet; starts only after a user gesture (browser
 * rule) and can be turned off in Settings. Read-aloud uses speechSynthesis
 * when the browser has it (an extra; the text is always on the card).
 */
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
