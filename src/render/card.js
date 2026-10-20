/**
 * Card: a floating canvas panel. One mesh + one canvas per card; buttons
 * are rectangles hit-tested from the pointer's uv, so a whole keypad is
 * a single draw call and a single interactable.
 *
 * Works with a hand ray pinch (RayInteractable) and, for panels within
 * reach, a fingertip poke (PokeInteractable). Desktop mouse also works.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  RayInteractable,
  PokeInteractable,
  Vector3,
  DoubleSide,
} from '@iwsdk/core';

export const UI = {
  bg: 'rgba(16,18,24,0.94)',
  border: 'rgba(200,210,225,0.22)',
  text: '#eef1f6',
  dim: '#aab3bf',
  accent: '#e9d9a6',
  button: 'rgba(255,255,255,0.08)',
  buttonHover: 'rgba(233,217,166,0.28)',
  font: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
};

const PX_PER_M = 2048;
const _v = new Vector3();

export class Card {
  /**
   * @param {object} world IWSDK world
   * @param {{width:number,height:number,poke?:boolean,name?:string}} opts metres
   */
  constructor(world, { width = 0.5, height = 0.32, poke = false, name = 'card' } = {}) {
    this.world = world;
    this.name = name;
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * PX_PER_M);
    this.canvas.height = Math.round(height * PX_PER_M);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      fog: false,
      toneMapped: false,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, height), this.material);
    this.mesh.renderOrder = 20;
    this.mesh.name = name;
    this.entity = world.createTransformEntity(this.mesh);
    this.entity.addComponent(RayInteractable);
    if (poke) this.entity.addComponent(PokeInteractable);
    this.buttons = [];
    this.hoverId = null;
    this.flashId = null;
    this._draw = null;
    this.visible = true;
    this.mesh.addEventListener('pointermove', (e) => this._onMove(e));
    this.mesh.addEventListener('pointerleave', () => this._setHover(null));
    this.mesh.addEventListener('click', (e) => this._onClick(e));
  }

  get object3D() {
    return this.entity.object3D;
  }

  /** draw(ctx, ui) is called on every redraw; register buttons via ui.button(). */
  setContent(draw) {
    this._draw = draw;
    this.redraw();
  }

  redraw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    this.buttons = [];
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 4, 4, w - 8, h - 8, 36);
    ctx.fillStyle = UI.bg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = UI.border;
    ctx.stroke();
    if (this._draw) this._draw(ctx, this._helpers(), w, h);
    this.texture.needsUpdate = true;
  }

  _helpers() {
    const card = this;
    const ctx = this.ctx;
    return {
      text(str, x, y, { size = 40, color = UI.text, weight = 400, align = 'left', maxWidth } = {}) {
        ctx.font = `${weight} ${size}px ${UI.font}`;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(str, x, y, maxWidth);
      },
      /** wrapped paragraph; returns the y after the last line */
      para(str, x, y, maxWidth, { size = 36, color = UI.text, weight = 400, lineHeight = 1.3, maxLines = 99 } = {}) {
        ctx.font = `${weight} ${size}px ${UI.font}`;
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        const lines = wrap(ctx, String(str ?? ''), maxWidth);
        const shown = lines.slice(0, maxLines);
        if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].replace(/\s*\S*$/, '…');
        for (const line of shown) {
          ctx.fillText(line, x, y);
          y += size * lineHeight;
        }
        return y;
      },
      button(id, label, x, y, w, h, onPress, { size = 36, primary = false, disabled = false, icon = null } = {}) {
        const hovered = card.hoverId === id && !disabled;
        const flashing = card.flashId === id;
        roundRect(ctx, x, y, w, h, Math.min(24, h / 2));
        ctx.fillStyle = flashing ? 'rgba(233,217,166,0.6)' : hovered ? UI.buttonHover : primary ? 'rgba(233,217,166,0.16)' : UI.button;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = primary ? 'rgba(233,217,166,0.6)' : 'rgba(255,255,255,0.16)';
        ctx.stroke();
        ctx.font = `600 ${size}px ${UI.font}`;
        ctx.fillStyle = disabled ? 'rgba(255,255,255,0.3)' : primary ? UI.accent : UI.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon ? `${icon}  ${label}` : label, x + w / 2, y + h / 2 + 2, w - 16);
        ctx.textBaseline = 'alphabetic';
        if (!disabled) card.buttons.push({ id, x, y, w, h, onPress });
      },
      ringIcon(cx, cy, r, color, style) {
        drawRing(ctx, cx, cy, r, color, style);
      },
      rule(y, x0 = 40, x1 = card.canvas.width - 40) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      },
    };
  }

  _hit(e) {
    const uv = e.uv;
    if (!uv) return null;
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  }

  _onMove(e) {
    this._setHover(this._hit(e)?.id ?? null);
  }

  _setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.redraw();
  }

  _onClick(e) {
    const b = this._hit(e);
    if (b) this.press(b.id, e);
  }

  /** Press a button by id (used by clicks and by scripted QA). */
  press(id, event = null) {
    const b = this.buttons.find((x) => x.id === id);
    if (!b) return false;
    this.flashId = id;
    this.redraw();
    setTimeout(() => {
      if (this.flashId === id) {
        this.flashId = null;
        if (this.visible) this.redraw();
      }
    }, 140);
    b.onPress?.(event);
    return true;
  }

  buttonIds() {
    return this.buttons.map((b) => b.id);
  }

  /** World-space centre of a button (lets scripted hands aim at it). */
  buttonWorldPosition(id, out = new Vector3()) {
    const b = this.buttons.find((x) => x.id === id);
    if (!b) return null;
    out.set(
      ((b.x + b.w / 2) / this.canvas.width - 0.5) * this.width,
      (0.5 - (b.y + b.h / 2) / this.canvas.height) * this.height,
      0,
    );
    this.object3D.updateMatrixWorld(true);
    return this.object3D.localToWorld(out);
  }

  setVisible(v) {
    this.visible = v;
    this.object3D.visible = v;
    // invisible cards must not swallow rays
    if (v && !this.entity.hasComponent(RayInteractable)) this.entity.addComponent(RayInteractable);
    if (!v && this.entity.hasComponent(RayInteractable)) this.entity.removeComponent(RayInteractable);
  }

  /** Place at a world position, facing the given world point (the head). */
  placeFacing(pos, lookAt) {
    const o = this.object3D;
    o.position.copy(pos);
    _v.copy(lookAt);
    o.lookAt(_v);
  }

  dispose() {
    this.entity.dispose(); // also frees geometry, material and texture
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawRing(ctx, cx, cy, r, color, style) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const ring = (rr, w, dash) => {
    ctx.lineWidth = w;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (style === 'solid') ring(r, r * 0.3);
  else if (style === 'double') {
    ring(r, r * 0.16);
    ring(r * 0.7, r * 0.16);
  } else if (style === 'dashed') ring(r, r * 0.3, [r * 0.55, r * 0.35]);
  else ring(r, r * 0.26, [1, r * 0.42]);
  ctx.restore();
}

export function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}
