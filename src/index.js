/**
 * FogWeave entry point.
 */
import { World, FogExp2 } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { NodeSpawnSystem } from './systems/node-spawn-system.js';
import { DivinationSystem } from './systems/divination-system.js';
import { QuerySystem } from './systems/query-system.js';
import { NodeRenderSystem } from './systems/node-render-system.js';
import { EdgeRenderSystem } from './systems/edge-render-system.js';

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  // Gray-fog atmosphere: distant
  // nodes/edges dissolve into mist rather than popping in/out.
  try {
    world.scene.fog = new FogExp2(0x2a2d33, 0.12);
  } catch (err) {
    console.warn('[fogweave] could not set scene fog — check world.scene path for this @iwsdk/core version', err);
  }

  world.registerSystem(NodeSpawnSystem);
  world.registerSystem(DivinationSystem);
  world.registerSystem(QuerySystem);
  world.registerSystem(NodeRenderSystem);
  world.registerSystem(EdgeRenderSystem);
});
