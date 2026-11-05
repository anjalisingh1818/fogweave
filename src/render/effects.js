/**
 * Short-lived light effects, in world space: a soft ring when a star opens, a
 * shooting star when news arrives, lights and threads that run back into a star
 * when its web closes, and faint puffs of fog behind a moving hand.
 *
 * Budget-minded: everything is drawn by two instanced quads and one LineSegments,
 * and anything over budget is simply not drawn. Decoration only: an effect never
 * carries meaning and never changes the graph. Soft and slow on purpose (no
 * flashing); Calm mode softens it further.
 */
import {
  Group,
  InstancedMesh,
  PlaneGeometry,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  AdditiveBlending,
  DynamicDrawUsage,
  Matrix4,
  Vector3,
  Color,
} from '@iwsdk/core';
import { glowTexture, ringTexture } from './textures.js';
import { settings } from '../config.js';

const MAX_GLOW = 140;
const MAX_RING = 16;
const MAX_THREADS = 64;
const MAX_PUFFS = 14;
const TRAIL = 9;

const _m = new Matrix4();
const _s = new Vector3();
const _p = new Vector3();
const _c = new Color();

const smooth = (t) => t * t * (3 - 2 * t);

export class Effects {
  constructor(world) {
    this.group = new Group();
    this.group.name = 'effects';
    world.createTransformEntity(this.group);
    this.list = [];

    const plane = new PlaneGeometry(1, 1);
    const quad = (map, max) => {
      const mesh = new InstancedMesh(plane, new MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }), max);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      return mesh;
    };
    this.glow = quad(glowTexture(), MAX_GLOW);
    this.ring = quad(ringTexture('solid'), MAX_RING);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_THREADS * 6), 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(MAX_THREADS * 6), 3).setUsage(DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.threads = new LineSegments(geo, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.threads.frustumCulled = false;
    this.threads.renderOrder = 5;
    this.group.add(this.threads);
  }

  /** A soft ring and glow that open at a point. */
  burst(pos, color, { size = 0.16, life = 0.7, delay = 0, strength = 1 } = {}) {
    this.list.push({ kind: 'burst', from: pos.clone(), color, size, life, age: -delay, strength: strength * (settings.comfort.gentle ? 0.5 : 1) });
  }

  /** A shooting star: a light with a short tail, running from one point to another. */
  comet(from, to, color, { life = 0.95, delay = 0, onArrive = null } = {}) {
    this.list.push({ kind: 'comet', from: from.clone(), to: to.clone(), color, life, age: -delay, onArrive });
  }

  /** A light and its thread running from a point back to where it came from. */
  retract(from, to, color, { life = 0.55, delay = 0, onArrive = null } = {}) {
    this.list.push({ kind: 'retract', from: from.clone(), to: to.clone(), color, life, age: -delay, onArrive });
  }

  /** A faint puff of fog (behind a moving hand). */
  puff(pos) {
    if (settings.quality.level < 1 || settings.comfort.gentle) return;
    if (this.list.filter((x) => x.kind === 'puff').length >= MAX_PUFFS) return;
    this.list.push({ kind: 'puff', from: pos.clone(), life: 1.1, age: 0 });
  }

  _glow(pos, size, hex, k, headQuat) {
    if (this.glow.count >= MAX_GLOW) return;
    _m.compose(pos, headQuat, _s.setScalar(size));
    this.glow.setMatrixAt(this.glow.count, _m);
    this.glow.setColorAt(this.glow.count, _c.setHex(hex).multiplyScalar(k));
    this.glow.count++;
  }

  update(delta, headQuat) {
    this.glow.count = 0;
    this.ring.count = 0;
    const attr = this.threads.geometry.attributes.position;
    const col = this.threads.geometry.attributes.color;
    let lines = 0;
    const arrived = [];
    let keep = 0;
    for (const fx of this.list) {
      fx.age += delta;
      if (fx.age >= fx.life) {
        if (fx.onArrive) arrived.push(fx.onArrive);
        continue;
      }
      this.list[keep++] = fx;
      if (fx.age < 0) continue;
      const t = fx.age / fx.life;

      if (fx.kind === 'burst') {
        const fade = (1 - t) * (1 - t) * fx.strength;
        if (this.ring.count < MAX_RING) {
          _m.compose(fx.from, headQuat, _s.setScalar(fx.size * (0.3 + 1.7 * (1 - (1 - t) * (1 - t)))));
          this.ring.setMatrixAt(this.ring.count, _m);
          this.ring.setColorAt(this.ring.count, _c.setHex(fx.color).multiplyScalar(fade));
          this.ring.count++;
        }
        this._glow(fx.from, fx.size * 1.5, fx.color, fade * 0.9, headQuat);
      } else if (fx.kind === 'comet') {
        const u = smooth(t);
        const appear = Math.min(1, t * 6);
        for (let k = settings.quality.level < 1 ? 0 : TRAIL; k >= 0; k--) {
          _p.lerpVectors(fx.from, fx.to, Math.max(0, u - k * 0.016));
          this._glow(_p, 0.09 * (1 - k / (TRAIL + 2)), fx.color, appear * (k ? 0.5 * (1 - k / (TRAIL + 1)) : 1.1), headQuat);
        }
      } else if (fx.kind === 'retract') {
        const u = t * t; // gathers speed on the way home
        _p.lerpVectors(fx.from, fx.to, u);
        this._glow(_p, 0.05, fx.color, 1 - u * 0.4, headQuat);
        if (lines < MAX_THREADS) {
          const i = lines * 6;
          attr.array.set([_p.x, _p.y, _p.z, fx.to.x, fx.to.y, fx.to.z], i);
          _c.setHex(fx.color).multiplyScalar(0.7);
          col.array.set([_c.r, _c.g, _c.b, _c.r * 0.5, _c.g * 0.5, _c.b * 0.5], i);
          lines++;
        }
      } else if (fx.kind === 'puff') {
        this._glow(fx.from, 0.05 + 0.2 * t, 0x9aa3b1, 0.2 * (1 - t), headQuat);
      }
    }
    this.list.length = keep;
    for (const fn of arrived) fn();

    for (const mesh of [this.glow, this.ring]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.threads.geometry.setDrawRange(0, lines * 2);
    if (lines) {
      attr.needsUpdate = true;
      col.needsUpdate = true;
    }
  }
}
