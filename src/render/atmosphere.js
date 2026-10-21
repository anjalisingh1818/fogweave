/**
 * The gray fog: exponential scene fog, slow drifting motes, and a few
 * large soft fog sheets far out. Calm motion only (no flashing, no
 * camera movement). Effects are dropped by the quality governor first.
 */
import {
  FogExp2,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  Group,
  Color,
} from '@iwsdk/core';
import { particleTexture, fogSheetTexture } from './textures.js';
import { settings } from '../config.js';

export const FOG_COLOR = 0x4a4e55;

export class Atmosphere {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.scene.fog = new FogExp2(FOG_COLOR, 0.32);
    this.scene.background = new Color(FOG_COLOR);
    this.group = new Group();
    this.group.name = 'atmosphere';
    world.createTransformEntity(this.group);
    this.t = 0;

    const n = 520;
    const pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    let s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      // shell between 0.6 m and 4 m from the head, never in the face
      const r = 0.6 + 3.4 * Math.pow(rnd(), 0.7);
      const th = rnd() * Math.PI * 2;
      const u = rnd() * 1.6 - 0.8;
      pos[i * 3] = Math.cos(th) * Math.sqrt(1 - u * u) * r;
      pos[i * 3 + 1] = 1.2 + u * r * 0.6;
      pos[i * 3 + 2] = Math.sin(th) * Math.sqrt(1 - u * u) * r;
      this.seed[i] = rnd() * 100;
    }
    this.base = pos.slice();
    // purely decorative motes: faint white, red and blue, tiny, no meaning
    // (evidence colours live only on node rings and links; see DECISIONS)
    const col = new Float32Array(n * 3);
    const tints = [[0.86, 0.88, 0.92], [0.92, 0.7, 0.7], [0.68, 0.76, 0.95]];
    for (let i = 0; i < n; i++) {
      const t = tints[i % 7 === 0 ? 1 : i % 5 === 0 ? 2 : 0];
      col.set(t, i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        size: 0.014,
        map: particleTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        vertexColors: true,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);

    this.sheets = [];
    const sheetMat = new MeshBasicMaterial({
      map: fogSheetTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0xc6cad2,
      fog: false,
    });
    for (let i = 0; i < 6; i++) {
      const m = new Mesh(new PlaneGeometry(7, 3.2), sheetMat);
      const a = (i / 6) * Math.PI * 2;
      m.position.set(Math.sin(a) * 4.5, 0.9 + (i % 3) * 0.5, -Math.cos(a) * 4.5);
      m.lookAt(0, m.position.y, 0);
      m.renderOrder = -1;
      this.group.add(m);
      this.sheets.push({ mesh: m, a, speed: 0.008 + i * 0.002 });
    }
  }

  update(delta) {
    this.t += delta * (settings.comfort.gentle ? 0.4 : 1);
    const q = settings.quality;
    const count = Math.min(Math.round(q.particles * (settings.comfort.gentle ? 0.4 : 1)), this.seed.length);
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
    for (const s of this.sheets) {
      s.mesh.visible = q.fogSheets;
      if (!q.fogSheets) continue;
      const a = s.a + this.t * s.speed;
      s.mesh.position.x = Math.sin(a) * 4.5;
      s.mesh.position.z = -Math.cos(a) * 4.5;
      s.mesh.lookAt(0, s.mesh.position.y, 0);
    }
  }
}
