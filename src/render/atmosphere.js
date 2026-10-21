/**
 * The fog over a night sky:
 *  - a deep space sky (near-black to dark blue, faint far stars), far behind
 *  - gray fog that fills the space: large soft banks that drift slowly around
 *    the reader, swirl and breathe, a low fog floor, and fine motes
 *  - the news stars shine through it (lights.js)
 * Fog thins near the face so cards and the web stay readable. Calm motion only
 * (no flashing, no camera movement). The quality governor drops fog banks and
 * motes first.
 */
import {
  FogExp2,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  SphereGeometry,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Group,
  Color,
  Vector3,
  BackSide,
} from '@iwsdk/core';
import { particleTexture, cloudTexture, skyTexture } from './textures.js';
import { settings } from '../config.js';

// the night behind the fog, and the fog itself
export const SKY_COLOR = 0x05070d;
export const FOG_COLOR = 0x1c222d; // distance haze: dark blue-gray, so far things sink into the night
const BANK_COLOR = 0x9aa3b1; // the gray fog banks
const BANKS = 72;
const FLOOR = 14;
const _cam = new Vector3();
const _p = new Vector3();

export class Atmosphere {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.scene.fog = new FogExp2(FOG_COLOR, 0.2);
    this.scene.background = new Color(SKY_COLOR);
    this.group = new Group();
    this.group.name = 'atmosphere';
    world.createTransformEntity(this.group);
    this.t = 0;
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    // 1. the sky: a large dome, untouched by the scene fog
    this.sky = new Mesh(
      new SphereGeometry(60, 48, 24),
      new MeshBasicMaterial({ map: skyTexture(), side: BackSide, fog: false, depthWrite: false }),
    );
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    // 2. fog banks: soft gray clouds in a shell around the reader (1.6 m to 9 m),
    //    at every height, drifting slowly round and breathing
    this.banks = [];
    const tex = [cloudTexture(0), cloudTexture(1), cloudTexture(2)];
    const add = (i, { floor = false } = {}) => {
      const mat = new SpriteMaterial({ map: tex[i % 3], color: BANK_COLOR, transparent: true, depthWrite: false, fog: false, opacity: 0 });
      const sp = new Sprite(mat);
      sp.renderOrder = -2;
      const r = floor ? 1.2 + rnd() * 5 : 1.6 + Math.pow(rnd(), 0.8) * 7.4;
      // most of the fog sits around eye level and below, thinning upward
      const y = floor ? -0.15 + rnd() * 0.5 : -0.4 + Math.pow(rnd(), 1.4) * 3.6;
      const size = floor ? 3.5 + rnd() * 3.5 : 3 + rnd() * 5 + r * 0.35;
      this.banks.push({
        sp,
        r,
        a: rnd() * Math.PI * 2,
        y,
        size,
        speed: (0.006 + rnd() * 0.014) * (rnd() < 0.2 ? -1 : 1), // most drift one way, a few against it
        spin: (rnd() - 0.5) * 0.04,
        rot: rnd() * Math.PI * 2,
        opacity: floor ? 0.22 + rnd() * 0.12 : 0.12 + rnd() * 0.16,
        phase: rnd() * 10,
      });
      this.group.add(sp);
    };
    for (let i = 0; i < BANKS; i++) add(i);
    for (let i = 0; i < FLOOR; i++) add(i, { floor: true });

    // 3. motes: fine pale specks close by, no meaning
    // (evidence colours live only on node rings and links; see DECISIONS)
    const n = 520;
    const pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 0.6 + 3.4 * Math.pow(rnd(), 0.7); // shell between 0.6 m and 4 m, never in the face
      const th = rnd() * Math.PI * 2;
      const u = rnd() * 1.6 - 0.8;
      pos[i * 3] = Math.cos(th) * Math.sqrt(1 - u * u) * r;
      pos[i * 3 + 1] = 1.2 + u * r * 0.6;
      pos[i * 3 + 2] = Math.sin(th) * Math.sqrt(1 - u * u) * r;
      this.seed[i] = rnd() * 100;
    }
    this.base = pos.slice();
    const col = new Float32Array(n * 3);
    const tints = [[0.8, 0.83, 0.88], [0.62, 0.7, 0.84]];
    for (let i = 0; i < n; i++) col.set(tints[i % 4 === 0 ? 1 : 0], i * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({ size: 0.008, map: particleTexture(), transparent: true, opacity: 0.28, depthWrite: false, vertexColors: true, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  update(delta) {
    const gentle = settings.comfort.gentle;
    this.t += delta * (gentle ? 0.4 : 1);
    const q = settings.quality;
    const cam = this.world.camera;
    if (cam) cam.getWorldPosition(_cam);
    else _cam.set(0, 1.2, 0);
    this.sky.position.copy(_cam); // the sky never comes closer

    // fog banks: fewer at lower quality (the governor sets fogSheets / particles)
    const banks = q.fogSheets ? this.banks.length : Math.round(this.banks.length * (q.particles > 0 ? 0.35 : 0));
    this.banks.forEach((b, i) => {
      const on = i < banks;
      b.sp.visible = on;
      if (!on) return;
      const a = b.a + this.t * b.speed;
      const breathe = 1 + 0.08 * Math.sin(this.t * 0.11 + b.phase);
      _p.set(Math.sin(a) * b.r, b.y + Math.sin(this.t * 0.05 + b.phase) * 0.15, -Math.cos(a) * b.r);
      b.sp.position.copy(_p);
      b.sp.scale.setScalar(b.size * breathe);
      b.sp.material.rotation = b.rot + this.t * b.spin;
      // thin near the face (cards and the web stay readable), and fade in slowly
      const d = _p.distanceTo(_cam);
      const near = Math.min(1, Math.max(0, (d - 1.1) / 1.4));
      const swell = 0.75 + 0.25 * Math.sin(this.t * 0.07 + b.phase * 2);
      b.sp.material.opacity = b.opacity * near * swell * (gentle ? 0.8 : 1);
    });

    const count = Math.min(Math.round(q.particles * (gentle ? 0.4 : 1)), this.seed.length);
    this.points.visible = count > 0;
    this.points.geometry.setDrawRange(0, count);
    if (count) {
      const attr = this.points.geometry.attributes.position;
      const arr = attr.array;
      for (let i = 0; i < count; i++) {
        const sd = this.seed[i];
        arr[i * 3] = this.base[i * 3] + Math.sin(this.t * 0.07 + sd) * 0.12;
        arr[i * 3 + 1] = this.base[i * 3 + 1] + Math.sin(this.t * 0.05 + sd * 1.3) * 0.08;
        arr[i * 3 + 2] = this.base[i * 3 + 2] + Math.cos(this.t * 0.06 + sd) * 0.12;
      }
      attr.needsUpdate = true;
    }
  }
}
