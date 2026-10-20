/**
 * Places cards on a seated arc in front of the user (no menus: cards
 * only). At most three content cards are open; opening a fourth closes
 * the oldest. Cards ease into place and always face the head.
 */
import { Vector3 } from '@iwsdk/core';
import { Card } from '../render/card.js';

// slots: yaw (deg), height offset (m), distance (m) from the head
const SLOTS = [
  { yaw: 0, dy: -0.1, dist: 0.62 },
  { yaw: -38, dy: -0.08, dist: 0.64 },
  { yaw: 38, dy: -0.08, dist: 0.64 },
];

export class CardManager {
  constructor(world, anchor) {
    this.world = world;
    this.anchor = anchor; // { head: Vector3 (seated head position), yaw: radians }
    this.open = []; // { key, card, slot, target: Vector3 }
  }

  /**
   * Show (or refresh) a card under `key`. `prefer` is a world point the
   * card should sit near (e.g. its node), used to choose the slot.
   */
  show(key, { width = 0.42, height = 0.3, draw, prefer = null, poke = false, slot = null }) {
    let entry = this.open.find((e) => e.key === key);
    if (!entry) {
      if (this.open.length >= SLOTS.length) this.close(this.open[0].key);
      const card = new Card(this.world, { width, height, poke, name: `card:${key}` });
      entry = { key, card, slot: slot ?? this._freeSlot(prefer), born: performance.now() };
      this.open.push(entry);
      const t = this._slotPosition(entry.slot);
      // start slightly further away and ease in
      card.placeFacing(t.clone().lerp(this.anchor.head, -0.25), this.anchor.head);
    }
    entry.card.setContent(draw);
    entry.target = this._slotPosition(entry.slot);
    return entry.card;
  }

  get(key) {
    return this.open.find((e) => e.key === key)?.card || null;
  }

  close(key) {
    const i = this.open.findIndex((e) => e.key === key);
    if (i < 0) return;
    const [entry] = this.open.splice(i, 1);
    entry.card.dispose();
    this.onClose?.(key);
  }

  closeAll() {
    for (const e of [...this.open]) this.close(e.key);
  }

  _freeSlot(prefer) {
    const used = new Set(this.open.map((e) => e.slot));
    let order = [0, 1, 2];
    if (prefer) {
      const d = prefer.clone().sub(this.anchor.head);
      const yaw = (Math.atan2(d.x, -d.z) * 180) / Math.PI - (this.anchor.yaw * 180) / Math.PI;
      order = [...order].sort((a, b) => Math.abs(SLOTS[a].yaw - yaw) - Math.abs(SLOTS[b].yaw - yaw));
    }
    return order.find((s) => !used.has(s)) ?? order[0];
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
