import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityGovernor } from '../src/quality.js';

const feed = (g, ms, frames) => {
  for (let i = 0; i < frames; i++) g.sample(ms / 1000);
};

test('a real headset starts one step down, then climbs back when frames are fast', () => {
  const levels = [];
  const g = new QualityGovernor((l) => levels.push(l));
  g.setTargetHz(72);
  g.startHeadset();
  assert.equal(g.level, 1);
  assert.deepEqual(levels, [1]);
  feed(g, 10, 120 * 5); // five fast windows: not yet
  assert.equal(g.level, 1);
  feed(g, 10, 120); // the sixth: full quality again
  assert.equal(g.level, 2);
});

test('slow frames on a headset still step down to the lowest level', () => {
  const g = new QualityGovernor(() => {});
  g.setTargetHz(72);
  g.startHeadset();
  feed(g, 30, 240);
  assert.equal(g.level, 0);
});

test('a locked governor (QA) and one already low are left alone', () => {
  const locked = new QualityGovernor(() => assert.fail('no change while locked'));
  locked.locked = true;
  locked.startHeadset();
  assert.equal(locked.level, 2);
  const low = new QualityGovernor(() => assert.fail('no change when already low'), { level: 0 });
  low.startHeadset();
  assert.equal(low.level, 0);
});
