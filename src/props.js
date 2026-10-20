/**
 * The two reading props.
 *   Locket: importance (swing near a node, or tap it)
 *   Coin:   evidence strength (flip near a node, or tap it; flip in open
 *           air highlights the most important node)
 *   Both held at once: path between the two selected nodes.
 *
 * Swing/flip detection cannot be tuned without a real headset, so a plain
 * pinch-tap on the prop always does the same thing (mandatory fallback).
 * Thresholds live in settings.props.
 */
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  Vector3,
  Quaternion,
  OneHandGrabbable,
  RayInteractable,
  Grabbed,
} from '@iwsdk/core';
import { settings } from './config.js';
import { Card } from './render/card.js';

const _v = new Vector3();
const _q = new Quaternion();

export class Props {
  constructor(world, anchor, { onReveal, onBothHeld }) {
    this.world = world;
    this.anchor = anchor;
    this.onReveal = onReveal; // (kind, {via, worldPos})
    this.onBothHeld = onBothHeld;
    this.items = [this._makeLocket(), this._makeCoin()];
    this._bothWasHeld = false;
    this.resetHome();
  }

  resetHome() {
    const { head, yaw } = this.anchor;
    for (const p of this.items) {
      const side = p.kind === 'locket' ? -1 : 1;
      const right = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const fwd = new Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
      p.home = head.clone().addScaledVector(right, side * 0.2).addScaledVector(fwd, 0.34);
      p.home.y = head.y - 0.42;
      p.entity.object3D.position.copy(p.home);
      p.tag.placeFacing(p.home.clone().setY(p.home.y - 0.06), head);
    }
  }

  _makeLocket() {
    const group = new Group();
    const gold = new MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.85, roughness: 0.28, emissive: 0x2a2008 });
    const body = new Mesh(new SphereGeometry(0.024, 24, 16), gold);
    body.scale.set(1, 1.25, 0.45);
    const bail = new Mesh(new TorusGeometry(0.008, 0.0022, 8, 20), gold);
    bail.position.y = 0.035;
    const chain = new Mesh(
      new CylinderGeometry(0.0012, 0.0012, 0.07, 6),
      new MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.3 }),
    );
    chain.position.y = 0.078;
    group.add(body, bail, chain);
    return this._register('locket', group);
  }

  _makeCoin() {
    const group = new Group();
    const face = new MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.9, roughness: 0.22, emissive: 0x231a05 });
    const coin = new Mesh(new CylinderGeometry(0.026, 0.026, 0.004, 40), face);
    coin.rotation.x = Math.PI / 2;
    const rim = new Mesh(new TorusGeometry(0.026, 0.0016, 8, 40), face);
    group.add(coin, rim);
    return this._register('coin', group);
  }

  _register(kind, group) {
    const entity = this.world.createTransformEntity(group);
    entity.addComponent(OneHandGrabbable, {});
    entity.addComponent(RayInteractable);
    const prop = { kind, entity, hist: [], cooldown: 0, grabbedSinceDown: false, held: false };
    // IWSDK denies rays on grabbables, so a far pinch-tap goes to this name tag
    prop.tag = new Card(this.world, { width: 0.09, height: 0.034, name: `tag:${kind}` });
    prop.tag.setContent((ctx, ui, w, h) => {
      ui.button('tap', kind === 'coin' ? 'Coin' : 'Locket', 4, 4, w - 8, h - 8, () => this.tap(kind), { size: 40 });
    });
    group.addEventListener('pointerdown', () => {
      prop.grabbedSinceDown = entity.hasComponent(Grabbed);
    });
    group.addEventListener('click', () => {
      // a grab-and-release also produces a click; only a plain tap counts
      if (prop.grabbedSinceDown || entity.hasComponent(Grabbed)) return;
      this.tap(kind);
    });
    return prop;
  }

  /** The pinch-tap fallback (also used by scripted QA). */
  tap(kind) {
    const p = this.items.find((x) => x.kind === kind);
    if (!p) return;
    p.spin = 1; // play the same little animation as the gesture
    this.onReveal(kind, { via: 'tap', worldPos: null });
  }

  isHeld(kind) {
    return this.items.find((x) => x.kind === kind)?.entity.hasComponent(Grabbed) ?? false;
  }

  update(delta, nowMs) {
    const sp = settings.props;
    let held = 0;
    for (const p of this.items) {
      const o = p.entity.object3D;
      const isHeld = p.entity.hasComponent(Grabbed);
      if (isHeld) p.grabbedSinceDown = true;
      if (isHeld) held++;
      // a quick pinch-and-release without moving it is a tap
      if (isHeld && !p.grab) p.grab = { t: nowMs, pos: o.getWorldPosition(new Vector3()), fired: false };
      if (!isHeld && p.grab) {
        const moved = o.getWorldPosition(_v).distanceTo(p.grab.pos);
        if (!p.grab.fired && nowMs - p.grab.t <= sp.tapMaxMs && moved <= sp.tapMaxMove) this.tap(p.kind);
        p.grab = null;
      }
      if (!isHeld) {
        p.hist.length = 0;
        // drift home so the props are always within reach
        o.position.lerp(p.home, 1 - Math.exp(-delta * 3));
        _q.identity();
        if (p.kind === 'locket') _q.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(nowMs / 900) * 0.12);
        if (p.spin > 0) {
          p.spin = Math.max(0, p.spin - delta * 1.5);
          _q.multiply(new Quaternion().setFromAxisAngle(_v.set(p.kind === 'coin' ? 1 : 0, 1, 0).normalize(), (1 - p.spin) * Math.PI * 4));
        }
        o.quaternion.slerp(_q, 1 - Math.exp(-delta * 6));
        continue;
      }
      const worldPos = o.getWorldPosition(new Vector3());
      const worldQuat = o.getWorldQuaternion(new Quaternion());
      p.hist.push({ t: nowMs, pos: worldPos, quat: worldQuat });
      const windowMs = Math.max(sp.swingWindowMs, sp.flipWindowMs);
      while (p.hist.length && nowMs - p.hist[0].t > windowMs) p.hist.shift();
      if (nowMs < p.cooldown) continue;
      if (p.kind === 'locket' && detectSwing(p.hist, sp)) {
        p.cooldown = nowMs + 1000;
        p.grab.fired = true;
        this.onReveal('locket', { via: 'gesture', worldPos });
      } else if (p.kind === 'coin' && detectFlip(p.hist, nowMs, sp)) {
        p.cooldown = nowMs + 1200;
        p.grab.fired = true;
        this.onReveal('coin', { via: 'gesture', worldPos });
      }
    }
    const both = held >= 2;
    if (both && !this._bothWasHeld) this.onBothHeld?.();
    this._bothWasHeld = both;
  }
}

/** Lateral direction reversals at speed = pendulum swing. */
export function detectSwing(hist, sp) {
  const recent = hist.filter((h) => hist.at(-1).t - h.t <= sp.swingWindowMs);
  if (recent.length < 4) return false;
  let reversals = 0;
  let lastDir = 0;
  let maxSpeed = 0;
  for (let i = 1; i < recent.length; i++) {
    const dt = (recent[i].t - recent[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const dx = recent[i].pos.x - recent[i - 1].pos.x;
    const dz = recent[i].pos.z - recent[i - 1].pos.z;
    maxSpeed = Math.max(maxSpeed, Math.hypot(dx, dz) / dt);
    const dir = Math.abs(dx) < 0.002 ? lastDir : Math.sign(dx);
    if (lastDir && dir && dir !== lastDir) reversals++;
    if (dir) lastDir = dir;
  }
  return reversals >= sp.swingMinReversals && maxSpeed >= sp.swingMinSpeed;
}

/** A fast roll of the coin (orientation change) within the window = flip. */
export function detectFlip(hist, nowMs, sp) {
  const recent = hist.filter((h) => nowMs - h.t <= sp.flipWindowMs);
  if (recent.length < 3) return false;
  let total = 0;
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1].quat;
    const b = recent[i].quat;
    const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
    total += 2 * Math.acos(dot);
  }
  return (total * 180) / Math.PI >= sp.flipMinTurnDeg;
}
