/**
 * Keeps each GraphNode entity's visuals in sync with its component
 * state: color/emissive by status, a soft pulse while researching,
 * a bright flash while highlighted, and a readout color (gold for
 * importance, blue for reliability) while a divination reveal is
 * active. Readouts, the risk note and the AI summary (when the node
 * is pinched open) are drawn on a canvas-texture label above the node.
 */
import { createSystem, CanvasTexture, Sprite, SpriteMaterial } from '@iwsdk/core';
import { GraphNode } from '../components/graph-node.js';
import * as graphStore from '../graph-store.js';

const STATUS_COLOR = {
  draft: 0x6b6f76,
  researching: 0x8aa0b5,
  confirmed: 0x9fb3c8,
};
const IMPORTANCE_COLOR = 0xd4af37; // matches the locket
const RELIABILITY_COLOR = 0x5aa9e6; // matches the coin

export class NodeRenderSystem extends createSystem({
  nodes: { required: [GraphNode] },
}) {
  init() {
    this._labels = new Map(); // entity -> { sprite, canvas, ctx, texture }
    this._t = 0;
  }

  update(delta) {
    this._t += delta;
    this.queries.nodes.entities.forEach((entity) => {
      const mesh = entity.object3D?.children?.[0] || entity.object3D;
      if (!mesh || !mesh.material) return;

      // graph-store owns importance (recomputed on every confirm) and
      // reliability (from the AI); mirror them so the props read live values
      const stored = graphStore.nodes.get(entity.getValue(GraphNode, 'nodeId'));
      if (stored) {
        entity.setValue(GraphNode, 'importance', stored.importance || 0);
        entity.setValue(GraphNode, 'reliability', stored.reliability ?? 0.5);
      }

      const status = entity.getValue(GraphNode, 'status');
      const highlighted = entity.getValue(GraphNode, 'highlighted');
      const revealing = entity.getValue(GraphNode, 'revealing');
      const revealKind = entity.getValue(GraphNode, 'revealKind');

      let color = STATUS_COLOR[status] ?? STATUS_COLOR.draft;
      if (revealing) {
        color = revealKind === 'importance' ? IMPORTANCE_COLOR : RELIABILITY_COLOR;
      }
      mesh.material.color?.setHex(color);

      if (status === 'researching') {
        const pulse = 0.5 + 0.5 * Math.sin(this._t * 4);
        mesh.material.emissiveIntensity = 0.3 + pulse * 0.7;
      } else if (highlighted) {
        mesh.material.emissiveIntensity = 1.2;
      } else if (revealing) {
        mesh.material.emissiveIntensity = 0.9;
      } else {
        mesh.material.emissiveIntensity = 0.25;
      }

      this._updateLabel(entity);
    });
  }

  _updateLabel(entity) {
    const topic = entity.getValue(GraphNode, 'topic');
    const status = entity.getValue(GraphNode, 'status');
    const revealing = entity.getValue(GraphNode, 'revealing');
    const revealKind = entity.getValue(GraphNode, 'revealKind');
    const importance = entity.getValue(GraphNode, 'importance');
    const reliability = entity.getValue(GraphNode, 'reliability');
    const expanded = entity.getValue(GraphNode, 'expanded');

    let title = topic || (status === 'draft' ? 'Pinch & speak a topic' : '…');
    let body = '';
    if (status === 'researching') body = 'Researching…';
    if (revealing && revealKind === 'importance') {
      body = `Importance: ${Math.round(importance * 100)}%`;
    } else if (revealing && revealKind === 'reliability') {
      const risk = reliability > 0.66 ? 'Low risk' : reliability > 0.33 ? 'Medium risk' : 'High risk';
      const verdict = reliability > 0.66 ? 'Likely real' : reliability > 0.33 ? 'Unverified' : 'Likely unreliable';
      const note = graphStore.nodes.get(entity.getValue(GraphNode, 'nodeId'))?.riskNote || '';
      body = `${verdict} — ${Math.round(reliability * 100)}% (${risk})\n${note}`;
    } else if (expanded) {
      body = graphStore.nodes.get(entity.getValue(GraphNode, 'nodeId'))?.summary || 'No summary yet.';
    }
    const big = !!body && (expanded || revealKind === 'reliability');
    const key = `${title}|${body}|${big}`;

    let entry = this._labels.get(entity);
    if (!entry) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const texture = new CanvasTexture(canvas);
      const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true }));
      entity.object3D.add(sprite);
      entry = { sprite, canvas, ctx, texture, lastKey: null };
      this._labels.set(entity, entry);
    }

    if (entry.lastKey === key) return;
    entry.lastKey = key;
    const { ctx, canvas, texture, sprite } = entry;

    // small tag normally; a taller reading panel for summaries / risk notes
    canvas.width = 512;
    canvas.height = big ? 384 : 128;
    sprite.scale.set(0.36, big ? 0.27 : 0.09, 1);
    sprite.position.set(0, big ? 0.22 : 0.11, 0);
    texture.dispose(); // canvas resized -> GPU texture must be re-allocated

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10,10,15,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2f2f6';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(title, canvas.width / 2, 46, canvas.width - 24);
    ctx.fillStyle = '#cfd5dd';
    ctx.font = '26px sans-serif';
    let y = 90;
    for (const line of wrap(ctx, body, canvas.width - 40)) {
      if (y > canvas.height - 12) break;
      ctx.fillText(line, canvas.width / 2, y);
      y += 32;
    }
    texture.needsUpdate = true;
  }
}

function wrap(ctx, text, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
