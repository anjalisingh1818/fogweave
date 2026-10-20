/**
 * FogWeave entry point: one IWSDK world, one driving system.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { FogSystem } from './systems/fog-system.js';

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  world.registerSystem(FogSystem);
});
