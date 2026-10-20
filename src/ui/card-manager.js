/**
 * Places cards on a seated arc in front of the user (no menus: cards
 * only). Five slots; opening a card when all are taken closes the oldest
 * unpinned one. Workspace panels (Library, Notes, Lights) can be pinned:
 * pinned panels keep their slot, can be moved slot to slot by pinch, and
 * are reopened where you left them next time.
 */
import { Vector3 } from '@iwsdk/core';
import { Card } from '../render/card.js';

// slots: yaw (deg), height offset (m), distance (m) from the head
export const SLOTS = [
  { yaw: 0, dy: -0.1, dist: 0.62 },
  { yaw: -38, dy: -0.08, dist: 0.64 },
  { yaw: 38, dy: -0.08, dist: 0.64 },
  { yaw: -72, dy: -0.04, dist: 0.7 },
  { yaw: 72, dy: -0.04, dist: 0.7 },
];
const LAYOUT_KEY = 'fogweave.workspace.v1';

export class CardManager {
  constructor(world, anchor) {
    this.world = world;
    this.anchor = anchor; // { head: Vector3 (seated head position), yaw: radians }
    this.open = []; // { key, card, slot, target, pinned }
  }

  /**
   * Show (or refresh) a card under `key`. `prefer` is a world point the
   * card should sit near (e.g. its node), used to choose the slot.
   */
  show(key, { width = 0.42, height = 0.3, draw, prefer = null, poke = false, slot = null, pinned = false }) {
    let entry = this.open.find((e) => e.key === key);
    if (!entry) {
      if (this.open.length >= SLOTS.length) {
        const victim = this.open.find((e) => !e.pinned) || this.open[0];
        this.close(victim.key);
      }
      const card = new Card(this.world, { width, height, poke, name: `card:${key}` });
      // a requested slot is a preference: never push out the card you came from
      const busy = new Set(this.open.map((e) => e.slot));
      const s = slot !== null && !busy.has(slot) ? slot : this._freeSlot(prefer, null);
      entry = { key, card, slot: s, born: performance.now(), pinned };
      const clash = this.open.find((e) => e.slot === s);
      if (clash && !clash.pinned) this.close(clash.key); // only when the arc is full
      this.open.push(entry);
      const t = this._slotPosition(entry.slot);
      card.placeFacing(t.clone().lerp(this.anchor.head, -0.25), this.anchor.head);
    }
    entry.card.setContent(draw);
    entry.target = this._slotPosition(entry.slot);
    return entry.card;
  }

  get(key) {
    return this.open.find((e) => e.key === key)?.card || null;
  }

  entry(key) {
    return this.open.find((e) => e.key === key) || null;
  }

  close(key) {
    const i = this.open.findIndex((e) => e.key === key);
    if (i < 0) return;
    const [entry] = this.open.splice(i, 1);
    entry.card.dispose();
    if (entry.pinned) this._saveLayout();
    this.onClose?.(key);
  }

  closeAll({ keepPinned = false } = {}) {
    for (const e of [...this.open]) if (!(keepPinned && e.pinned)) this.close(e.key);
  }

  setPinned(key, pinned) {
    const e = this.entry(key);
    if (!e) return;
    e.pinned = pinned;
    this._saveLayout();
    e.card.redraw();
  }

  /** Move a card to the next slot (swapping with whatever is there). */
  move(key) {
    const e = this.entry(key);
    if (!e) return;
    const next = (e.slot + 1) % SLOTS.length;
    const other = this.open.find((x) => x.slot === next);
    if (other) {
      other.slot = e.slot;
      other.target = this._slotPosition(other.slot);
    }
    e.slot = next;
    e.target = this._slotPosition(e.slot);
    this._saveLayout();
  }

  savedLayout() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    } catch {
      return {};
    }
  }

  _saveLayout() {
    const layout = {};
    for (const e of this.open) if (e.pinned) layout[e.key] = e.slot;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // not persisted
    }
  }

  _freeSlot(prefer, wanted = null) {
    const used = new Set(this.open.filter((e) => e.pinned).map((e) => e.slot));
    const busy = new Set(this.open.map((e) => e.slot));
    let order = [0, 1, 2, 3, 4];
    if (prefer) {
      const d = prefer.clone().sub(this.anchor.head);
      const yaw = (Math.atan2(d.x, -d.z) * 180) / Math.PI - (this.anchor.yaw * 180) / Math.PI;
      order = [...order].sort((a, b) => Math.abs(SLOTS[a].yaw - yaw) - Math.abs(SLOTS[b].yaw - yaw));
    }
    if (wanted !== null && !used.has(wanted)) return wanted;
    return order.find((s) => !busy.has(s)) ?? order.find((s) => !used.has(s)) ?? order[0];
  }

  _slotPosition(i) {
    const s = SLOTS[i];
    const yaw = this.anchor.yaw + (s.yaw * Math.PI) / 180;
    return new Vector3(
      this.anchor.head.x + Math.sin(yaw) * s.dist,
      this.anchor.head.y + s.dy,
      this.anchor.head.z - Math.cos(yaw) * s.dist,
    );
  }

  update(delta) {
    const k = 1 - Math.exp(-delta * 8);
    for (const e of this.open) {
      const o = e.card.object3D;
      o.position.lerp(e.target, k);
      o.lookAt(this.anchor.head);
    }
  }
}
