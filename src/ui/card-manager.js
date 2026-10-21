/**
 * Places cards on a seated arc in front of the user (no menus: cards
 * only). Five slots; opening a card when all are taken closes the oldest
 * unpinned one. Workspace panels (Library, Notes, Lights) can be pinned:
 * pinned panels keep their slot, can be moved slot to slot by pinch, and
 * are reopened where you left them next time.
 *
 * On a flat page (no XR session: desktop browser, dev fallback) the arc does
 * not fit a window, so cards sit in two columns at the screen's left and right
 * edges, scaled to fit, on the side away from the thing they belong to, and at
 * most two are open.
 */
import { Vector3, Quaternion } from '@iwsdk/core';
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
const FLAT_MAX = 2;
const FLAT_DIST = 0.6; // m in front of the camera
const _q = new Quaternion();
const _p = new Vector3();

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
      if (this.open.length >= (this.flat ? FLAT_MAX : SLOTS.length)) {
        const victim = this.open.find((e) => !e.pinned) || this.open[0];
        this.close(victim.key);
      }
      const card = new Card(this.world, { width, height, poke, name: `card:${key}` });
      // a requested slot is a preference: never push out the card you came from
      const busy = new Set(this.open.map((e) => e.slot));
      const s = slot !== null && !busy.has(slot) ? slot : this._freeSlot(prefer, null);
      entry = { key, card, slot: s, born: performance.now(), pinned, side: this._flatSide(prefer) };
      const clash = this.open.find((e) => e.slot === s);
      if (clash && !clash.pinned) this.close(clash.key); // only when the arc is full
      this.open.push(entry);
      const t = this._slotPosition(entry.slot);
      card.placeFacing(t.clone().lerp(this.anchor.head, -0.25), this.anchor.head);
      if (this.flat && this.world.camera) {
        card.object3D.scale.setScalar(this._flatPose(entry, _p));
        card.object3D.position.copy(_p);
      }
    }
    entry.card.setContent(draw);
    entry.target = this._slotPosition(entry.slot);
    return entry.card;
  }

  get(key) {
    return this.open.find((e) => e.key === key)?.card || null;
  }

  /** True on a flat page (no XR session). */
  get flat() {
    return !this.world.session;
  }

  /** Resize an open card in place (same slot and side). */
  resize(key, width, height) {
    this.entry(key)?.card.resize(width, height);
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
    if (this.flat) {
      // flat page: swap sides with the other column
      const other = this.open.find((x) => x !== e && x.side === -e.side);
      if (other) other.side = e.side;
      e.side = -e.side;
      return;
    }
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

  /** Flat page: the side (+1 right, -1 left) away from `prefer`, if free. */
  _flatSide(prefer) {
    let want = 1;
    const cam = this.world.camera;
    if (prefer && cam) {
      _p.copy(prefer).project(cam);
      want = _p.x > 0 ? -1 : 1;
    }
    // the new card takes the side away from its thing; an older card there moves over
    for (const e of this.open) if (e.side === want) e.side = -want;
    return want;
  }

  /** Flat page: where a card sits and how large, from the camera's view. */
  _flatPose(e, outPos) {
    const cam = this.world.camera;
    const halfH = Math.tan(((cam.fov ?? 50) * Math.PI) / 360) * FLAT_DIST;
    const halfW = halfH * (cam.aspect || 1.33);
    const c = e.card;
    const scale = Math.min(1, (halfW * 2 * 0.42) / c.width, (halfH * 2 * 0.84) / c.height);
    const side = e.side ?? 1;
    outPos.set(side * (halfW * 0.97 - (c.width * scale) / 2), -halfH * 0.02, -FLAT_DIST);
    cam.updateMatrixWorld();
    outPos.applyMatrix4(cam.matrixWorld);
    return scale;
  }

  update(delta) {
    const k = 1 - Math.exp(-delta * 8);
    const flat = this.flat && this.world.camera;
    if (flat) this.world.camera.getWorldQuaternion(_q);
    for (const e of this.open) {
      const o = e.card.object3D;
      if (flat) {
        const scale = this._flatPose(e, _p);
        o.position.lerp(_p, k);
        o.quaternion.copy(_q);
        o.scale.setScalar(scale);
        continue;
      }
      o.scale.setScalar(1);
      o.position.lerp(e.target, k);
      o.lookAt(this.anchor.head);
    }
  }
}
