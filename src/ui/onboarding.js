/**
 * First-run guided start (about 60 s). A bundled web grows in front of
 * the user, then each step waits for the real action (or Next) before
 * moving on. Short text, large type, no timers rushing the user.
 */
import { UI } from '../render/card.js';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to FogWeave',
    body: 'Research grows here as a web of claims. Each claim shows how well independent sources support it.',
    wait: null,
  },
  { id: 'pinch-node', title: 'Open a node', body: 'Point at a glowing node and pinch. Its card shows the evidence.', wait: 'card-opened' },
  { id: 'seal', title: 'Keep what you trust', body: 'Press Seal on the card. Sealed items turn solid and go to your Library.', wait: 'sealed' },
  { id: 'coin', title: 'The Coin', body: 'Tap the Coin at your lower right (or flip it near a node) to read its evidence.', wait: 'coin' },
  { id: 'locket', title: 'The Locket', body: 'Tap the Locket at your lower left (or swing it near a node) to see how central it is.', wait: 'locket' },
  { id: 'your-turn', title: 'Your turn', body: 'Pinch empty space to name your own topic. The "?" on your left wrist has help.', wait: null, last: true },
];

const DONE_KEY = 'fogweave.onboarded.v1';

export class Onboarding {
  constructor(app) {
    this.app = app;
    this.index = -1;
  }

  static needed() {
    try {
      return !localStorage.getItem(DONE_KEY);
    } catch {
      return true;
    }
  }

  get active() {
    return this.index >= 0;
  }

  get step() {
    return STEPS[this.index] || null;
  }

  start() {
    this.index = 0;
    this._show();
  }

  /** Called by the app when the user does something. */
  notify(event) {
    if (this.step?.wait === event) this.next();
  }

  next() {
    if (this.step?.last) return this.finish();
    this.index++;
    this._show();
  }

  finish() {
    this.index = -1;
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // will show again next time
    }
    this.app.closeCard('tour');
  }

  _show() {
    const step = this.step;
    this.app.cards.show('tour', {
      width: 0.42,
      height: 0.24,
      slot: 1,
      draw: (ctx, ui, w, h) => {
        const pad = 44;
        ui.text(`${this.index + 1} / ${STEPS.length}`, w - pad, 66, { size: 28, color: UI.dim, align: 'right' });
        ui.text(step.title, pad, 70, { size: 42, weight: 700, color: UI.accent });
        ui.para(step.body, pad, 140, w - pad * 2, { size: 34, maxLines: 4 });
        const label = step.last ? 'Done' : step.wait ? 'Skip step' : 'Next';
        ui.button('next', label, w - pad - 240, h - 116, 240, 82, () => this.next(), { primary: !step.wait });
        if (!step.last) ui.button('skip', 'End tour', pad, h - 116, 240, 82, () => this.finish());
      },
    });
  }
}
