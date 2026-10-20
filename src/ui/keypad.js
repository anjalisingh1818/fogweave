/**
 * Pinch keypad + suggestion cards: the hands-only way to name a topic or
 * ask a question. Keys are 4+ cm targets, pressed with a ray pinch.
 */
import { Vector3 } from '@iwsdk/core';
import { Card, UI } from '../render/card.js';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export class Keypad {
  constructor(world, anchor, { onSubmit, onClose }) {
    this.world = world;
    this.anchor = anchor;
    this.onSubmit = onSubmit;
    this.onClose = onClose;
    this.text = '';
    this.prompt = 'Name a topic';
    this.suggestions = [];
    this.card = null;
  }

  get isOpen() {
    return !!this.card;
  }

  open({ prompt = 'Name a topic', suggestions = [], text = '' } = {}) {
    this.prompt = prompt;
    this.suggestions = suggestions.slice(0, 4);
    this.text = text;
    if (!this.card) {
      // ray pinch only: with PokeInteractable on, IWSDK 1.0.1 swallowed ray
      // pinch-selects on the panel (see docs/DECISIONS.md)
      this.card = new Card(this.world, { width: 0.5, height: 0.36, name: 'keypad' });
      this._place();
    }
    this.card.setContent((ctx, ui, w, h) => this._draw(ctx, ui, w, h));
  }

  close() {
    if (!this.card) return;
    this.card.dispose();
    this.card = null;
    this.onClose?.();
  }

  setSuggestions(list) {
    this.suggestions = list.slice(0, 4);
    this.card?.redraw();
  }

  type(ch) {
    if (this.text.length >= 80) return;
    this.text += ch;
    this.card?.redraw();
  }

  backspace() {
    this.text = this.text.slice(0, -1);
    this.card?.redraw();
  }

  submit(text = this.text) {
    const value = text.trim();
    if (!value) return;
    this.close();
    this.onSubmit(value);
  }

  _place() {
    // within arm's reach, below eye level, tilted toward the face
    const { head, yaw } = this.anchor;
    const pos = new Vector3(head.x + Math.sin(yaw) * 0.44, head.y - 0.24, head.z - Math.cos(yaw) * 0.44);
    this.card.placeFacing(pos, head);
  }

  _draw(ctx, ui, w, h) {
    const pad = 40;
    // input line
    ui.text(this.prompt.toUpperCase(), pad, 58, { size: 26, color: UI.dim, weight: 600 });
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(pad, 74, w - pad * 2 - 110, 70);
    const shown = this.text || '';
    ui.text(shown + '▏', pad + 18, 124, { size: 40, maxWidth: w - pad * 2 - 150 });
    ui.button('close', '✕', w - pad - 92, 74, 92, 70, () => this.close(), { size: 34 });

    // suggestion cards
    const sw = (w - pad * 2 - 16) / 2;
    this.suggestions.forEach((s, i) => {
      const x = pad + (i % 2) * (sw + 16);
      const y = 162 + Math.floor(i / 2) * 74;
      ui.button(`sug:${i}`, s, x, y, sw, 64, () => this.submit(s), { size: 28 });
    });

    // keys
    const gap = 8;
    const kw = (w - pad * 2 - gap * 9) / 10;
    const kh = 76;
    let y = 324;
    ROWS.forEach((row, r) => {
      const offset = r === 1 ? kw / 2 : r === 2 ? kw / 2 : 0;
      [...row].forEach((ch, i) => {
        ui.button(`key:${ch}`, ch.toUpperCase(), pad + offset + i * (kw + gap), y, kw, kh, () => this.type(ch), { size: 34 });
      });
      if (r === 2) {
        const x = pad + offset + row.length * (kw + gap);
        ui.button('back', '⌫', x, y, kw * 2 + gap, kh, () => this.backspace(), { size: 34 });
      }
      y += kh + gap;
    });
    ui.button('clear', 'Clear', pad, y, kw * 2 + gap, kh, () => {
      this.text = '';
      this.card.redraw();
    }, { size: 30 });
    ui.button('space', 'space', pad + (kw + gap) * 2, y, kw * 5 + gap * 4, kh, () => this.type(' '), { size: 30 });
    ui.button('go', 'Go', pad + (kw + gap) * 7, y, kw * 3 + gap * 2, kh, () => this.submit(), {
      size: 34,
      primary: true,
      disabled: !this.text.trim(),
    });
  }
}
