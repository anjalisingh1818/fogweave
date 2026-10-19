/**
 * Hands-only divination, LOTM-style: the TOOL you hold decides what
 * gets revealed, not a menu or typed command.
 *
 *  - Locket (pendulum): swing it near a node -> reveals that node's
 *    IMPORTANCE (how central/connected it is in the graph).
 *  - Coin: flip it near a node -> reveals that node's RELIABILITY
 *    ("real vs risky" read on the data). Flip it in open air (no node
 *    nearby) -> reveals the single most important node in the whole
 *    graph instead, so the coin is never a dead gesture.
 *
 * "How are A and B related" is a separate, voice-driven query (see
 * query-system.js) — it doesn't need a prop at all.
 *
 * The swing/flip detectors below are a cheap starting heuristic, not a
 * final feel — expect to retune the thresholds once you can test real
 * pinch-grab weight on-device.
 */
import {
  createSystem,
  Grabbed,
  OneHandGrabbable,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  CylinderGeometry,
  Group,
} from '@iwsdk/core';
import { DivinationProp } from '../components/divination-prop.js';
import { GraphNode } from '../components/graph-node.js';
import { nodeEntities } from '../entity-index.js';
import * as graphStore from '../graph-store.js';
import { mostCentralNode } from '../graph-algorithms.js';

const NODE_LOCK_RADIUS = 0.22; // meters — how close the prop must be to "find" a node
const MOTION_WINDOW_MS = 650;
const SWING_MIN_REVERSALS = 2;
const SWING_MIN_SPEED = 0.35; // m/s, lateral
const FLIP_MIN_REVERSALS = 1;
const REVEAL_DURATION_MS = 4000;

export class DivinationSystem extends createSystem({
  props: { required: [DivinationProp] },
}) {
  init() {
    this._history = new Map(); // entity -> [{t, pos}]
    this._cooldownUntil = new Map(); // entity -> timestamp
    this._spawnProps();
  }

  // Two small grabbable tools placed within easy reach of a seated
  // player at the start of the session. Positions are fixed in world
  // space near the origin — on-device you'll likely want to parent
  // these to the player rig instead so they stay reachable regardless
  // of where the player recenters.
  _spawnProps() {
    this._spawnLocket({ x: 0.22, y: 1.0, z: -0.28 });
    this._spawnCoin({ x: -0.22, y: 1.0, z: -0.28 });
  }

  _spawnLocket(pos) {
    const group = new Group();
    const bead = new Mesh(
      new SphereGeometry(0.025, 16, 12),
      new MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.3 }),
    );
    const chain = new Mesh(
      new CylinderGeometry(0.002, 0.002, 0.05, 6),
      new MeshStandardMaterial({ color: 0xbfbfbf, metalness: 0.4 }),
    );
    chain.position.y = 0.035;
    group.add(bead, chain);

    const entity = this.world.createTransformEntity(group);
    entity.object3D.position.set(pos.x, pos.y, pos.z);
    entity.addComponent(OneHandGrabbable, {});
    entity.addComponent(DivinationProp, { kind: 'locket' });
  }

  _spawnCoin(pos) {
    const mesh = new Mesh(
      new CylinderGeometry(0.02, 0.02, 0.004, 24),
      new MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.25 }),
    );
    mesh.rotation.x = Math.PI / 2;

    const entity = this.world.createTransformEntity(mesh);
    entity.object3D.position.set(pos.x, pos.y, pos.z);
    entity.addComponent(OneHandGrabbable, {});
    entity.addComponent(DivinationProp, { kind: 'coin' });
  }

  update() {
    const now = performance.now();

    this.queries.props.entities.forEach((entity) => {
      const o = entity.object3D;
      if (!o) return;
      const isHeld = entity.hasComponent(Grabbed);
      const kind = entity.getValue(DivinationProp, 'kind');

      let hist = this._history.get(entity);
      if (!hist) {
        hist = [];
        this._history.set(entity, hist);
      }

      if (!isHeld) {
        hist.length = 0;
        return;
      }

      const worldPos = o.getWorldPosition(new o.position.constructor());
      hist.push({ t: now, pos: worldPos });
      while (hist.length && now - hist[0].t > MOTION_WINDOW_MS) hist.shift();

      const cooldown = this._cooldownUntil.get(entity) || 0;
      if (now < cooldown) return;

      if (kind === 'locket' && this._detectSwing(hist)) {
        this._cooldownUntil.set(entity, now + 1000);
        this._onLocketSwing(worldPos);
      } else if (kind === 'coin' && this._detectFlip(hist)) {
        this._cooldownUntil.set(entity, now + 1200);
        this._onCoinFlip(worldPos);
      }
    });
  }

  // Lateral direction reversals = "is this swinging like a pendulum".
  _detectSwing(positions) {
    if (positions.length < 4) return false;
    let reversals = 0;
    let lastDir = null;
    let maxSpeed = 0;
    for (let i = 1; i < positions.length; i++) {
      const dt = (positions[i].t - positions[i - 1].t) / 1000;
      if (dt <= 0) continue;
      const dx = positions[i].pos.x - positions[i - 1].pos.x;
      const dz = positions[i].pos.z - positions[i - 1].pos.z;
      const speed = Math.sqrt(dx * dx + dz * dz) / dt;
      maxSpeed = Math.max(maxSpeed, speed);
      const dir = dx > 0 ? 1 : dx < 0 ? -1 : lastDir;
      if (lastDir !== null && dir !== null && dir !== lastDir) reversals++;
      lastDir = dir;
    }
    return reversals >= SWING_MIN_REVERSALS && maxSpeed >= SWING_MIN_SPEED;
  }

  // Vertical direction reversals = proxy for "it got flipped/tossed".
  _detectFlip(positions) {
    if (positions.length < 4) return false;
    let reversals = 0;
    let lastDir = null;
    for (let i = 1; i < positions.length; i++) {
      const dy = positions[i].pos.y - positions[i - 1].pos.y;
      const dir = dy > 0.01 ? 1 : dy < -0.01 ? -1 : lastDir;
      if (lastDir !== null && dir !== null && dir !== lastDir) reversals++;
      lastDir = dir;
    }
    return reversals >= FLIP_MIN_REVERSALS;
  }

  _onLocketSwing(worldPos) {
    const near = graphStore.nearestNodeToPosition(worldPos, NODE_LOCK_RADIUS);
    if (!near) return;
    this._reveal(near.id, 'importance');
  }

  _onCoinFlip(worldPos) {
    const near = graphStore.nearestNodeToPosition(worldPos, NODE_LOCK_RADIUS);
    if (near) {
      this._reveal(near.id, 'reliability');
      return;
    }
    // open air: answer "what matters most here?" instead of nothing
    const central = mostCentralNode();
    if (central) this._reveal(central.node.id, 'importance');
  }

  _reveal(nodeId, kind) {
    const entity = nodeEntities.get(nodeId);
    if (!entity) return;
    entity.setValue(GraphNode, 'revealing', true);
    entity.setValue(GraphNode, 'revealKind', kind);
    const token = {};
    this._revealTokens ??= new Map();
    this._revealTokens.set(nodeId, token);
    setTimeout(() => {
      if (this._revealTokens.get(nodeId) !== token) return; // a newer reveal owns it
      if (entity.hasComponent(GraphNode)) {
        entity.setValue(GraphNode, 'revealing', false);
        entity.setValue(GraphNode, 'revealKind', '');
      }
    }, REVEAL_DURATION_MS);
  }
}
