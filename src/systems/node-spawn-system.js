/**
 * Pinch in empty space (not near an existing node) -> spawn a new
 * draft GraphNode, ask the player to speak its topic, then call the
 * AI bridge to summarize it and suggest links to existing nodes.
 *
 * Pinch an existing node instead:
 *  - untitled draft (nothing was heard last time) -> listen for its topic again
 *  - researched node -> open/close its AI summary panel
 *
 * NOTE ON HAND INPUT: IWSDK's grab / ray-interaction systems handle
 * pinches aimed at objects (locket, coin, confirm markers). For a pinch
 * in *empty* space there is no object to attach a RayInteractable to,
 * so we listen to the raw WebXR 'selectstart' event on the session.
 * That event ALSO fires when the pinch was meant to grab a prop or
 * press a marker, so spawning is deferred a few frames and cancelled
 * if IWSDK claims the pinch (see _resolvePendingPinch).
 *
 * On init the saved graph (graph-store persistence) is respawned, so
 * the space you built last session is still there.
 */
import {
  createSystem,
  Grabbed,
  Hovered,
  Pressed,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from '@iwsdk/core';
import { GraphNode } from '../components/graph-node.js';
import { DivinationProp } from '../components/divination-prop.js';
import { ConfirmMarker } from '../components/confirm-marker.js';
import { nodeEntities } from '../entity-index.js';
import * as graphStore from '../graph-store.js';
import { listenOnce } from '../voice-input.js';
import { summarizeAndLink } from '../ai-bridge.js';

const NODE_RADIUS = 0.06;
const MIN_SPAWN_DISTANCE_FROM_EXISTING = 0.18; // meters — below this, treat the
// pinch as "interacting with that node" instead of spawning a new one.
const PROP_CLEARANCE = 0.12; // meters — pinches this close to a prop/marker never spawn
const SPAWN_DEFER_MS = 180; // time IWSDK gets to claim a pinch as a grab/press

export class NodeSpawnSystem extends createSystem({
  props: { required: [DivinationProp] },
  markers: { required: [ConfirmMarker] },
}) {
  init() {
    this._onSelectStart = this._onSelectStart.bind(this);
    this._session = null;
    this._pending = null; // { pos, at }
    this._busyNodes = new Set(); // nodeIds currently listening/researching
    this._restoreSavedGraph();
    this._attachWhenReady();
  }

  _restoreSavedGraph() {
    if (!graphStore.load()) return;
    for (const n of graphStore.nodes.values()) {
      if (!n.worldPos) continue;
      const entity = this._createNodeEntity(n.worldPos);
      entity.addComponent(GraphNode, {
        nodeId: n.id,
        topic: n.topic,
        status: n.status,
        reliability: n.reliability,
        importance: n.importance || 0,
      });
      nodeEntities.set(n.id, entity);
    }
    graphStore.recomputeImportance(); // also notifies EdgeRenderSystem to draw saved edges
  }

  _attachWhenReady() {
    const tryAttach = () => {
      const session = this.world.renderer?.xr?.getSession?.();
      if (session && session !== this._session) {
        this._session = session;
        session.addEventListener('selectstart', this._onSelectStart);
      }
    };
    tryAttach();
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(() => tryAttach()));
    this._pollId = setInterval(tryAttach, 1000);
    this.cleanupFuncs.push(() => clearInterval(this._pollId));
  }

  _onSelectStart(event) {
    const pos = this._pinchPosition(event);
    if (!pos) return;
    if (this._isNearPropOrMarker(pos) || this._isAimingAtMarker()) return;

    const near = this._nearestNode(pos);
    if (near) {
      this._onNodePinched(near);
      return;
    }
    this._pending = { pos, at: performance.now(), heldAtPinch: this._heldPropCount() };
  }

  update() {
    if (!this._pending) return;
    // a grab or marker press started by this same pinch -> not a spawn
    if (this._heldPropCount() > this._pending.heldAtPinch || this._isAimingAtMarker()) {
      this._pending = null;
      return;
    }
    if (performance.now() - this._pending.at < SPAWN_DEFER_MS) return;
    const { pos } = this._pending;
    this._pending = null;
    this._spawnNode(pos);
  }

  _pinchPosition(event) {
    try {
      const xr = this.world.renderer.xr;
      const refSpace = xr.getReferenceSpace();
      // event.frame is the only frame guaranteed valid inside an input
      // event handler; getFrame() is a fallback for older runtimes.
      const frame = event.frame || xr.getFrame?.();
      const space = event.inputSource?.targetRaySpace;
      if (!frame || !refSpace || !space) return null;
      const pose = frame.getPose(space, refSpace);
      if (!pose) return null;
      const p = pose.transform.position;
      return { x: p.x, y: p.y, z: p.z };
    } catch (err) {
      console.warn('[fogweave] could not read pinch pose:', err);
      return null;
    }
  }

  _heldPropCount() {
    let n = 0;
    this.queries.props.entities.forEach((e) => {
      if (e.hasComponent(Grabbed)) n++;
    });
    return n;
  }

  _isAimingAtMarker() {
    let aiming = false;
    this.queries.markers.entities.forEach((e) => {
      if (e.hasComponent(Hovered) || e.hasComponent(Pressed)) aiming = true;
    });
    return aiming;
  }

  _isNearPropOrMarker(pos) {
    let near = false;
    const check = (e) => {
      const p = e.object3D?.getWorldPosition(e.object3D.position.clone());
      if (p && p.distanceTo(pos) < PROP_CLEARANCE) near = true;
    };
    this.queries.props.entities.forEach(check);
    this.queries.markers.entities.forEach(check);
    return near;
  }

  _nearestNode(pos) {
    let best = null;
    let bestDist = MIN_SPAWN_DISTANCE_FROM_EXISTING;
    for (const [nodeId, entity] of nodeEntities) {
      const o = entity.object3D;
      if (!o) continue;
      const d = o.position.distanceTo(pos);
      if (d < bestDist) {
        bestDist = d;
        best = { nodeId, entity };
      }
    }
    return best;
  }

  _onNodePinched({ nodeId, entity }) {
    if (this._busyNodes.has(nodeId)) return;
    const topic = entity.getValue(GraphNode, 'topic');
    if (!topic) {
      this._listenAndResearch(nodeId, entity);
      return;
    }
    entity.setValue(GraphNode, 'expanded', !entity.getValue(GraphNode, 'expanded'));
  }

  _createNodeEntity(pos) {
    const mesh = new Mesh(
      new SphereGeometry(NODE_RADIUS, 24, 16),
      new MeshStandardMaterial({
        color: 0x9fb3c8,
        emissive: 0x2a3a4a,
        roughness: 0.4,
        metalness: 0.1,
      }),
    );
    const entity = this.world.createTransformEntity(mesh);
    entity.object3D.position.set(pos.x, pos.y, pos.z);
    return entity;
  }

  _spawnNode(pos) {
    const entity = this._createNodeEntity(pos);
    const nodeId = graphStore.createNode('', { x: pos.x, y: pos.y, z: pos.z });
    entity.addComponent(GraphNode, { nodeId, topic: '', status: 'draft' });
    nodeEntities.set(nodeId, entity);
    this._listenAndResearch(nodeId, entity);
  }

  async _listenAndResearch(nodeId, entity) {
    this._busyNodes.add(nodeId);
    try {
      const topic = await listenOnce({ timeoutMs: 7000 });
      // nothing heard -> stays an untitled draft; pinch it to try again
      if (!topic) return;

      graphStore.updateNode(nodeId, { topic, status: 'researching' });
      entity.setValue(GraphNode, 'topic', topic);
      entity.setValue(GraphNode, 'status', 'researching');

      const existing = [...graphStore.nodes.values()].filter((n) => n.id !== nodeId && n.topic);
      const { summary, suggestions, reliability, riskNote } = await summarizeAndLink(
        topic,
        existing,
      );

      graphStore.updateNode(nodeId, { summary, status: 'confirmed', reliability, riskNote });
      entity.setValue(GraphNode, 'status', 'confirmed');
      entity.setValue(GraphNode, 'reliability', reliability);

      for (const s of suggestions) {
        if (!graphStore.nodes.has(s.nodeId)) continue;
        graphStore.createEdge(nodeId, s.nodeId, 'suggested', s.confidence ?? 0.5);
      }
      graphStore.recomputeImportance();
    } finally {
      this._busyNodes.delete(nodeId);
    }
  }
}
