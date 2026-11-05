/**
 * Your constellation: everything you sealed, as gold stars high in the sky, joined
 * by thin lines. Each star's place comes from its id, so the same items make the
 * same shape every day and it grows as you keep more. It lives on this device with
 * the Library. It is a picture of what you kept: a line here says nothing about how
 * two items relate (that is for labelled links and Connect the dots).
 */
import {
  Group,
  InstancedMesh,
  PlaneGeometry,
  SphereGeometry,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  AdditiveBlending,
  DynamicDrawUsage,
  Matrix4,
  Quaternion,
  Vector3,
  Color,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  SRGBColorSpace,
  RayInteractable,
} from '@iwsdk/core';
import { glowTexture } from './textures.js';
import { UI } from './card.js';
import { hash01 } from '../layout/force.js';

const MAX = 40;
const GOLD = 0xffd98a;
const DIST = 3;
const _m = new Matrix4();
const _s = new Vector3();
const _p = new Vector3();
const _p2 = new Vector3();
const _c = new Color();
const ID_Q = new Quaternion();

export class Constellation {
  constructor(world, anchor) {
    this.anchor = anchor;
    this.time = 0;
    this.stars = new Map(); // id -> { id, label, yaw, elev, parent, at, phase }
    this.hoveredId = null;
    this.group = new Group();
    this.group.name = 'constellation';
    world.createTransformEntity(this.group);

    this.glow = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }),
      MAX * 2,
    );
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 3;
    this.group.add(this.glow);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX * 6), 3).setUsage(DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.lines = new LineSegments(geo, new LineBasicMaterial({ color: new Color(GOLD).multiplyScalar(0.5), transparent: true, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.group.add(this.lines);

    this.hit = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }),
      MAX,
    );
    this.hit.count = 0;
    this.hit.frustumCulled = false;
    this.hitOrder = [];
    this.hitEntity = world.createTransformEntity(this.hit);
    this.hitEntity.addComponent(RayInteractable);
    this.hit.addEventListener('pointermove', (e) => (this.hoveredId = this.hitOrder[e.instanceId] ?? null));
    this.hit.addEventListener('pointerleave', () => (this.hoveredId = null));
    this.hit.addEventListener('click', (e) => {
      const id = this.hitOrder[e.instanceId];
      if (id) this.onSelect?.(id);
    });

    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 112;
    this.tag = { canvas, ctx: canvas.getContext('2d'), tex: new CanvasTexture(canvas), key: '' };
    this.tag.tex.colorSpace = SRGBColorSpace;
    this.tag.sprite = new Sprite(new SpriteMaterial({ map: this.tag.tex, transparent: true, depthWrite: false, fog: false }));
    this.tag.sprite.scale.set(0.7, 0.1, 1);
    this.tag.sprite.renderOrder = 12;
    this.tag.sprite.visible = false;
    this.group.add(this.tag.sprite);
  }

  /** The items you keep now (oldest first). Returns the ids that are new. */
  setItems(items) {
    const list = items.slice(-MAX);
    const keep = new Set(list.map((x) => x.id));
    for (const id of [...this.stars.keys()]) if (!keep.has(id)) this.stars.delete(id);
    for (const st of this.stars.values()) if (st.parent && !keep.has(st.parent)) st.parent = this._nearest(st);
    const fresh = [];
    for (const it of list) {
      const old = this.stars.get(it.id);
      if (old) {
        old.label = it.label;
        continue;
      }
      const st = {
        id: it.id,
        label: it.label,
        yaw: ((-65 + 130 * hash01(it.id, 11)) * Math.PI) / 180,
        elev: ((34 + 14 * hash01(it.id, 12)) * Math.PI) / 180, // above the news, without craning the neck
        h: hash01(it.id, 12),
        phase: hash01(it.id, 13) * Math.PI * 2,
        at: -Infinity,
        parent: null,
      };
      st.parent = this._nearest(st);
      this.stars.set(it.id, st);
      fresh.push(it.id);
    }
    return fresh;
  }

  _nearest(st) {
    let best = null;
    let bestD = Infinity;
    for (const o of this.stars.values()) {
      if (o === st) continue;
      const d = Math.hypot(o.yaw - st.yaw, o.elev - st.elev);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }

  /** A new star waits for the light that flies up to it. */
  appear(id, wait) {
    const st = this.stars.get(id);
    if (st) st.at = this.time + wait;
  }

  worldPositionOf(id, out = new Vector3()) {
    const st = this.stars.get(id);
    if (!st) return null;
    const { head, yaw } = this.anchor;
    const f = this.fit;
    // flat page: a thin band along the top of the window
    const a = yaw + (f ? st.yaw * f.k : st.yaw);
    const e = f ? (f.e1 / 0.82) * (0.87 + 0.09 * st.h) : st.elev;
    out.set(head.x + Math.sin(a) * Math.cos(e) * DIST, head.y + Math.sin(e) * DIST, head.z - Math.cos(a) * Math.cos(e) * DIST);
    return out;
  }

  update(delta, headQuat) {
    this.time += delta;
    this.glow.count = 0;
    this.hit.count = 0;
    this.hitOrder.length = 0;
    const attr = this.lines.geometry.attributes.position;
    let lines = 0;
    for (const st of this.stars.values()) {
      const rise = Math.max(0, Math.min(1, (this.time - st.at) / 0.8));
      if (!rise) continue;
      this.worldPositionOf(st.id, _p);
      const on = st.id === this.hoveredId;
      const breathe = 1 + 0.12 * Math.sin(this.time * 0.8 + st.phase);
      _m.compose(_p, headQuat, _s.setScalar(0.3 * rise * breathe * (on ? 1.5 : 1)));
      this.glow.setMatrixAt(this.glow.count, _m);
      this.glow.setColorAt(this.glow.count++, _c.setHex(GOLD).multiplyScalar(0.5));
      _m.compose(_p, headQuat, _s.setScalar(0.09 * rise * (on ? 1.4 : 1)));
      this.glow.setMatrixAt(this.glow.count, _m);
      this.glow.setColorAt(this.glow.count++, _c.setHex(0xfff4d6));

      _m.compose(_p, ID_Q, _s.setScalar(0.16));
      this.hit.setMatrixAt(this.hit.count++, _m);
      this.hitOrder.push(st.id);

      if (st.parent && this.worldPositionOf(st.parent, _p2)) {
        // the line grows from the older star to the new one
        _p.lerpVectors(_p2, _p, rise);
        attr.array.set([_p2.x, _p2.y, _p2.z, _p.x, _p.y, _p.z], lines * 6);
        lines++;
      }
    }
    this.lines.geometry.setDrawRange(0, lines * 2);
    if (lines) attr.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    this.hit.instanceMatrix.needsUpdate = true;
    this.hit.computeBoundingSphere();
    this._updateTag();
  }

  _updateTag() {
    const st = this.hoveredId && this.stars.get(this.hoveredId);
    if (!st) {
      this.tag.sprite.visible = false;
      return;
    }
    if (this.tag.key !== st.id) {
      this.tag.key = st.id;
      const { ctx, canvas, tex } = this.tag;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(12,14,18,0.8)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, 10, canvas.width - 16, 92, 30);
      else ctx.rect(8, 10, canvas.width - 16, 92);
      ctx.fill();
      ctx.font = `500 32px ${UI.font}`;
      ctx.fillStyle = '#ffe2a8';
      ctx.textBaseline = 'middle';
      let text = st.label;
      while (ctx.measureText(text).width > canvas.width - 70 && text.length > 4) text = text.slice(0, -2);
      ctx.fillText(text === st.label ? text : `${text}…`, 30, 56);
      tex.needsUpdate = true;
    }
    this.worldPositionOf(st.id, _p);
    _p.y -= 0.2;
    this.tag.sprite.position.copy(_p);
    this.tag.sprite.visible = true;
  }
}
