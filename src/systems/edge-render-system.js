/**
 * Keeps edge lines synced with graph-store (the logical source of
 * truth) and with where their two nodes currently sit in space (nodes
 * can be dragged around). Also owns the small pinchable "confirm
 * marker" sphere that turns a dotted 'suggested' edge solid.
 *
 * Edge ECS entities are created/destroyed here by diffing against
 * graph-store.edges on every change — graph-store itself stays
 * ECS-agnostic.
 */
import {
  createSystem,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
  Float32BufferAttribute,
  RayInteractable,
  Pressed,
} from '@iwsdk/core';
import { GraphEdge } from '../components/graph-edge.js';
import { ConfirmMarker } from '../components/confirm-marker.js';
import { nodeEntities } from '../entity-index.js';
import * as graphStore from '../graph-store.js';

export class EdgeRenderSystem extends createSystem({
  edges: { required: [GraphEdge] },
  markerPressed: { required: [ConfirmMarker, Pressed] },
}) {
  init() {
    this._edgeEntities = new Map(); // graph-store edgeId -> { entity, markerEntity }
    this._unsubscribe = graphStore.onChange(() => this._sync());
    this._sync();

    this.queries.markerPressed.subscribe('qualify', (entity) => {
      const edgeId = entity.getValue(ConfirmMarker, 'edgeId');
      graphStore.confirmEdge(edgeId);
      graphStore.recomputeImportance();
    });
  }

  destroy() {
    this._unsubscribe?.();
  }

  _sync() {
    const storeIds = new Set(graphStore.edges.keys());

    // remove entities for edges that no longer exist in the store
    for (const [edgeId, rec] of this._edgeEntities) {
      if (!storeIds.has(edgeId)) {
        rec.entity.dispose();
        rec.markerEntity?.dispose();
        this._edgeEntities.delete(edgeId);
      }
    }

    // create entities for new edges
    for (const [edgeId, e] of graphStore.edges) {
      if (this._edgeEntities.has(edgeId)) continue;
      const fromEntity = nodeEntities.get(e.fromId);
      const toEntity = nodeEntities.get(e.toId);
      if (!fromEntity || !toEntity) continue; // nodes not spawned yet

      const geometry = new BufferGeometry().setFromPoints([
        fromEntity.object3D.position,
        toEntity.object3D.position,
      ]);
      const line = new Line(geometry, this._materialFor(e.status));
      if (e.status === 'suggested') line.computeLineDistances();

      const lineEntity = this.world.createTransformEntity(line);
      lineEntity.addComponent(GraphEdge, {
        edgeId,
        fromId: e.fromId,
        toId: e.toId,
        status: e.status,
        confidence: e.confidence,
      });

      let markerEntity = null;
      if (e.status === 'suggested') {
        markerEntity = this._spawnMarker(edgeId, fromEntity, toEntity);
      }

      this._edgeEntities.set(edgeId, { entity: lineEntity, markerEntity });
    }
  }

  _spawnMarker(edgeId, fromEntity, toEntity) {
    const mesh = new Mesh(
      new SphereGeometry(0.018, 12, 10),
      new MeshStandardMaterial({ color: 0xbfe08a, emissive: 0x294010 }),
    );
    const entity = this.world.createTransformEntity(mesh);
    entity.object3D.position.lerpVectors(
      fromEntity.object3D.position,
      toEntity.object3D.position,
      0.5,
    );
    entity.addComponent(ConfirmMarker, { edgeId });
    entity.addComponent(RayInteractable, {});
    return entity;
  }

  _materialFor(status) {
    return status === 'confirmed'
      ? new LineBasicMaterial({ color: 0xd8dde3, transparent: true, opacity: 0.85 })
      : new LineDashedMaterial({
          color: 0x8f9aa6,
          dashSize: 0.03,
          gapSize: 0.02,
          transparent: true,
          opacity: 0.5,
        });
  }

  update() {
    // keep lines glued to their (possibly moving) nodes, and advance
    // the status -> solid transition + path-glow pulse
    this.queries.edges.entities.forEach((entity) => {
      const edgeId = entity.getValue(GraphEdge, 'edgeId');
      const rec = this._edgeEntities.get(edgeId);
      if (!rec) return;
      const fromEntity = nodeEntities.get(entity.getValue(GraphEdge, 'fromId'));
      const toEntity = nodeEntities.get(entity.getValue(GraphEdge, 'toId'));
      if (!fromEntity || !toEntity) return;

      const line = entity.object3D;
      const positions = line.geometry.attributes.position;
      positions.set(
        [
          fromEntity.object3D.position.x,
          fromEntity.object3D.position.y,
          fromEntity.object3D.position.z,
          toEntity.object3D.position.x,
          toEntity.object3D.position.y,
          toEntity.object3D.position.z,
        ],
        0,
      );
      positions.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      if (entity.getValue(GraphEdge, 'status') === 'suggested') line.computeLineDistances();

      // reflect confirmed status from the logical store (set by the
      // marker-pinch handler above) onto this entity + remove its marker
      const storeEdge = graphStore.edges.get(edgeId);
      if (storeEdge && storeEdge.status === 'confirmed' && entity.getValue(GraphEdge, 'status') !== 'confirmed') {
        entity.setValue(GraphEdge, 'status', 'confirmed');
        line.material = this._materialFor('confirmed');
        if (rec.markerEntity) {
          rec.markerEntity.dispose();
          rec.markerEntity = null;
        }
      }

      const glow = entity.getValue(GraphEdge, 'pathGlow');
      const status = entity.getValue(GraphEdge, 'status');
      if (glow > 0) {
        line.material.color?.setHex(0xffe08a);
        line.material.opacity = 0.9;
      } else if (rec.glowing) {
        // path highlight over -> back to the normal look for its status
        line.material = this._materialFor(status);
        if (status === 'suggested') line.computeLineDistances();
      }
      rec.glowing = glow > 0;

      if (rec.markerEntity) {
        rec.markerEntity.object3D.position.lerpVectors(
          fromEntity.object3D.position,
          toEntity.object3D.position,
          0.5,
        );
      }
    });
  }
}
