/**
 * FogWeave entry point: one IWSDK world, one driving system.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { FogSystem } from './systems/fog-system.js';

// No third-party calls: IWSDK loads hand and controller models from a CDN.
// They are vendored in public/vendor/input-profiles (MIT, @webxr-input-profiles/assets 1.0.20).
// Rewritten at fetch, because the input package may load its own copy of three.js
// (so a LoadingManager URL modifier would not reach it).
const INPUT_PROFILES_CDN = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/';
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  if (url.startsWith(INPUT_PROFILES_CDN)) {
    return nativeFetch(`${import.meta.env.BASE_URL}vendor/input-profiles/${url.slice(INPUT_PROFILES_CDN.length)}`, init);
  }
  return nativeFetch(input, init);
};

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  world.registerSystem(FogSystem);
});
