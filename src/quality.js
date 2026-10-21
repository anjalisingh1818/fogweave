/**
 * Quality governor: drops effects (fog sheets, motes, labels, glow)
 * before it drops frames. Hysteresis avoids flip-flopping. It also keeps
 * frame-time stats for the ?debug meter and QA reports.
 */
export class QualityGovernor {
  constructor(onChange, { level = 2 } = {}) {
    this.onChange = onChange;
    this.level = level;
    this.targetMs = 1000 / 60; // flat page; XR sessions set their own rate
    this.window = [];
    this.windowStart = 0;
    this.over = 0;
    this.under = 0;
    this.stats = { fps: 0, avgMs: 0, p95Ms: 0, level };
    this.locked = false; // QA can lock the level to measure a fixed config

  }

  setTargetHz(hz) {
    this.targetMs = 1000 / (hz || 72);
  }

  sample(delta) {
    const ms = delta * 1000;
    if (ms <= 0 || ms > 250) return; // tab switches, pauses
    this.window.push(ms);
    if (this.window.length < 120) return;
    const sorted = [...this.window].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    // In the desktop emulator the session claims 72 Hz but the monitor sets
    // the pace, so judge against the interval actually delivered (p10).
    const emulated = typeof window !== 'undefined' && !!window.IWER_DEVICE; // injected after startup
    const target = emulated ? Math.max(this.targetMs, sorted[Math.floor(sorted.length * 0.1)]) : this.targetMs;
    this.stats = {
      fps: 1000 / avg,
      avgMs: avg,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      level: this.level,
      frames: sorted.length,
    };
    this.window.length = 0;
    if (this.locked) return;
    if (avg > target * 1.12) {
      this.over++;
      this.under = 0;
    } else if (avg < target * 0.95) {
      this.under++;
      this.over = 0;
    } else {
      this.over = this.under = 0;
    }
    if (this.over >= 2 && this.level > 0) {
      this.level--;
      this.over = 0;
      this.onChange(this.level);
    } else if (this.under >= 6 && this.level < 2) {
      this.level++;
      this.under = 0;
      this.onChange(this.level);
    }
  }
}
