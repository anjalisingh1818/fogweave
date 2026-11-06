// The thinking agent in the client, with its answers scripted so no model quota is
// spent: the button, the tree that grows in the fog, dropped thoughts with their
// reasons, the card, Show, Explore next, Stop, and a run that never answers.
// "Why did this happen?" has no button for now, but its run shares all of this.
// What the real agent finds is measured in server/eval/v4_agent.py, not here.
//   node qa/ui-v2-agent.mjs      (needs the local backend for live mode)
import { writeFileSync } from 'node:fs';
import { launch, open, shot, errorsOf, OUT } from './lib.mjs';

const results = [];
const { browser, context, page, logs } = await launch();
const ev = (fn, a) => page.evaluate(fn, a);
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  ${name}  ${JSON.stringify(detail ?? '').slice(0, 400)}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  ${name}  ${String(err.message || err).slice(0, 400)}`);
    await shot(page, `uiv2a-fail-${name.replace(/\W+/g, '-').slice(0, 30)}`).catch(() => {});
  }
};
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

try {
  let why = () => [];
  await context.route('**/agent/why', async (route) => {
    const body = why(route.request().postDataJSON());
    if (body === null) return; // never answers
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(body) });
  });
  // a real recorded web to work on; the engine's answers are scripted
  let nextSent = null;
  await context.route('**/agent/next', async (route) => {
    nextSent = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: nextSent.nodes.slice(0, 2).map((n) => ({ id: n.id, label: n.label, question: 'What does this add to the story?' })) }) });
  });
  await context.route('**/agent/patterns', async (route) => {
    const ids = route.request().postDataJSON().items.map((i) => i.id);
    const quotes = ids.slice(0, 2).map((x) => ({ id: x, quote: 'A quote from this item', date: '2026-10-01' }));
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        { type: 'status', text: 'Thinking of different patterns' },
        { type: 'thought', state: 'open', id: 'T1', parent: null, depth: 1, kind: 'recurring', text: 'The same kind of event comes back' },
        { type: 'thought', state: 'open', id: 'T2', parent: null, depth: 1, kind: 'common_theme', text: 'They only look alike' },
        { type: 'thought', id: 'T2', state: 'dropped', why: 'too unsure' },
        { type: 'thought', id: 'T1', state: 'chosen' },
        { type: 'result', results: [{ kind: 'recurring', label: 'inferred', text: 'The same kind of event comes back in these items.', items: ids.slice(0, 2), quotes }], dropped: [{ thought: 'T2', why: 'too unsure' }], items: {}, calls: 3, note: '' },
        { type: 'done', stats: { calls: 3 } },
      ]),
    });
  });
  await open(page, { query: '?debug&demo' });
  await page.waitForFunction(() => window.__fw.app.mode === 'offline' && window.__fw.app.lights.items.length > 1, null, { timeout: 60000 });
  const { id, older, waiting } = await (async () => {
    const star = await ev(() => {
      const a = window.__fw.app;
      a.onboarding.finish();
      a.cards.closeAll();
      a.governor.locked = true;
      Object.assign(window.__fw.settings.quality, { level: 2, labels: 22, particles: 300, fogSheets: true, glow: 1, maxNodes: 60 });
      const it = a.lights.items.find((x) => a.snapshot.expansions[x.id]);
      a.openLight(it.id);
      return it.id;
    });
    await page.waitForFunction((x) => window.__fw.app.getItem(x)?.expanded === true, star, { timeout: 60000 });
    return ev((x) => {
      const a = window.__fw.app;
      a.mode = 'live'; // the button and the calls behave as with the live engine
      a.cards.get(`light:${x}`).redraw();
      const near = a.store.neighbors(x).map((n) => a.store.nodes.get(n.id));
      const older = near.find((n) => n?.type === 'NewsItem')?.id;
      const waiting = near.find((n) => n && n.type !== 'NewsItem' && n.type !== 'Claim' && n.type !== 'Source');
      waiting.hidden = true;
      a.store._emit('node-updated', [waiting.id]);
      return { id: x, older, waiting: waiting.id };
    }, star);
  })();
  await page.waitForTimeout(500);

  await step('the news card offers Explore next once the web has grown, and no Why button', async () => {
    const b = await ev((x) => window.__fw.app.cards.get(`light:${x}`).buttonIds(), id);
    if (!b.includes('next') || b.includes('why')) throw new Error(JSON.stringify(b));
    return b;
  });

  let sent = null;
  await step('asking sends the story, the news around it and the nodes not opened yet', async () => {
    why = (body) => {
      sent = body;
      return [{ type: 'result', results: [], dropped: [], items: {}, calls: 2, note: '' }, { type: 'done', stats: { calls: 2 } }];
    };
    await ev((x) => window.__fw.app.askWhy(x), id);
    await page.waitForTimeout(500);
    if (sent?.story?.id !== id || !sent.related.some((r) => r.id === older)) throw new Error(JSON.stringify(sent).slice(0, 300));
    return { related: sent.related.length, nodes: sent.nodes.length };
  });

  await step('an empty answer says so honestly', async () => {
    const r = await ev(() => ({ text: window.__fw.app.cards.get('agent').boxes.map((b) => b.text).join(' | '), running: window.__fw.app.agent.running }));
    if (r.running || !/No explanation held up/.test(r.text)) throw new Error(JSON.stringify(r));
    return r.text.slice(0, 120);
  });

  await step('the tree grows thought by thought; the web steps back', async () => {
    const r = await ev((x) => {
      const a = window.__fw.app;
      const run = a._agentRun({ job: 'why', focus: x, cardKey: 'agent', title: 'WHY DID THIS HAPPEN?', question: 'Why did this happen?', noteLabel: 'Why', empty: 'None.' });
      window.__run = run;
      const e = (o) => a._onAgentEvent(run, o);
      e({ type: 'status', text: 'Thinking of different explanations' });
      e({ type: 'thought', state: 'open', id: 'T1', parent: null, depth: 1, kind: 'background', text: 'An earlier round of talks failed' });
      e({ type: 'thought', state: 'open', id: 'T2', parent: null, depth: 1, kind: 'trigger', text: 'A new offer set this off' });
      e({ type: 'thought', state: 'open', id: 'T3', parent: null, depth: 1, kind: 'precedent', text: 'Talks like this happened before' });
      return { nodes: a.thoughts.nodes.size, quiet: a.view.quiet, want: a.thoughts.want };
    }, id);
    await page.waitForTimeout(900);
    await shot(page, 'uiv2a-1-thinking');
    if (r.nodes !== 4 || !r.quiet || r.want !== 1) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('dropped thoughts sink and say why; the best goes deeper and is chosen', async () => {
    const quotes = [{ id: older, quote: 'The first round of talks ended in Geneva', date: '2024-01-02' }];
    await ev(({ q, older, waiting }) => {
      const a = window.__fw.app;
      const e = (o) => a._onAgentEvent(window.__run, o);
      e({ type: 'tool', name: 'search', query: 'Geneva talks', state: 'done', found: 2 });
      e({ type: 'thought', id: 'T2', state: 'dropped', why: 'no quote from another item' });
      e({ type: 'thought', id: 'T3', state: 'dropped', why: 'a second look: they only share a name' });
      e({ type: 'thought', id: 'T1', state: 'kept', score: 6 });
      e({ type: 'thought', state: 'open', id: 'T1a', parent: 'T1', depth: 2, kind: 'background', text: 'The first round ended without agreement' });
      e({ type: 'thought', id: 'T1a', state: 'kept', score: 6 });
      e({ type: 'thought', id: 'T1a', state: 'chosen' });
      e({ type: 'result', results: [{ kind: 'background', label: 'inferred', text: 'The first round ended without agreement, so this is a second attempt.', items: [older], quotes: q }], items: { [older]: { id: older, label: 'An earlier round of talks' } }, dropped: [{ thought: 'T2', why: 'no quote from another item' }, { thought: 'T3', why: 'a second look: they only share a name' }], calls: 5, note: '' });
      e({ type: 'next', items: [{ id: waiting, label: 'Geneva', question: 'Why were the talks held here?' }] });
      a._agentDone(window.__run, { calls: 5 });
    }, { q: quotes, older, waiting });
    await page.waitForTimeout(1400);
    await shot(page, 'uiv2a-2-chosen');
    const r = await ev(() => {
      const a = window.__fw.app;
      const c = a.cards.get('agent');
      const boxes = c.boxes.filter((b) => b.w > 0 && b.h > 0);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i];
          const q = boxes[j];
          if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 2 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 2) overlaps.push(`${p.text} / ${q.text}`);
        }
      return { overlaps, buttons: c.buttonIds(), sink: a.thoughts.nodes.get('T2').sink, chosen: a.thoughts.nodes.get('T1a').state, burst: a.fx.list.length, close: c.buttonIds().includes('close') };
    });
    if (r.overlaps.length || r.sink < 0.8 || r.chosen !== 'chosen' || !r.buttons.includes('show:0') || !r.buttons.includes('next:0')) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('Show opens the earlier news the explanation rests on', async () => {
    const r = await ev(() => {
      const a = window.__fw.app;
      a.cards.get('agent').press('show:0');
      return { open: a.cards.open.map((e) => e.key), quiet: a.view.quiet };
    });
    if (!r.open.includes(`node:${older}`) || r.quiet) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('Explore next on the news card lists real nodes, and says they are suggestions', async () => {
    await ev((x) => {
      const a = window.__fw.app;
      a.closeAgent();
      a.cards.closeAll();
      a.openLight(x);
    }, id);
    await page.waitForTimeout(400);
    await ev((x) => window.__fw.app.cards.get(`light:${x}`).press('next'), id);
    await page.waitForFunction(() => window.__fw.app.nextSteps && !window.__fw.app.nextSteps.running, null, { timeout: 8000 });
    await page.waitForTimeout(500);
    await shot(page, 'uiv2a-3-explore-next');
    const r = await ev(() => {
      const c = window.__fw.app.cards.get('next');
      const boxes = c.boxes.filter((b) => b.w > 0 && b.h > 0);
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i];
          const q = boxes[j];
          if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 2 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 2) overlaps.push(`${p.text} / ${q.text}`);
        }
      return { overlaps, buttons: c.buttonIds(), text: c.boxes.map((b) => b.text).join(' | ') };
    });
    if (r.overlaps.length || !r.buttons.includes('next:0') || !/Suggested by AI/.test(r.text)) throw new Error(JSON.stringify(r));
    if (nextSent?.story?.id !== id || !nextSent.nodes.some((n) => n.id === waiting)) throw new Error(JSON.stringify(nextSent).slice(0, 300));
    return { nodes: nextSent.nodes.length, buttons: r.buttons };
  });

  await step('a suggestion brings out the node that was waiting, and opens it', async () => {
    const r = await ev(({ w }) => {
      const a = window.__fw.app;
      const c = a.cards.get('next');
      const i = a.nextSteps.items.findIndex((n) => n.id === w);
      if (i < 0) a.nextSteps.items.unshift({ id: w, label: 'Waiting', question: 'What is it?' });
      c.redraw();
      c.press(`next:${Math.max(i, 0)}`);
      return { hidden: a.store.nodes.get(w).hidden, open: a.cards.open.map((e) => e.key) };
    }, { w: waiting });
    if (r.hidden || !r.open.includes(`node:${waiting}`) || r.open.includes('next')) throw new Error(JSON.stringify(r));
    return r;
  });

  await step('Find patterns runs the agent: its tree grows and Show lights the items', async () => {
    await ev(() => {
      const a = window.__fw.app;
      a.cards.closeAll();
      for (const it of a.lights.items.slice(0, 3)) a.sealLight(it.id);
      a.findPatterns();
    });
    await page.waitForFunction(() => window.__fw.app.agent?.job === 'patterns' && !window.__fw.app.agent.running, null, { timeout: 8000 });
    await page.waitForTimeout(900);
    await shot(page, 'uiv2a-4-patterns');
    const r = await ev(() => {
      const a = window.__fw.app;
      const c = a.cards.get('patterns');
      return { buttons: c.buttonIds(), nodes: a.thoughts.nodes.size, chosen: a.thoughts.nodes.get('T1')?.state, last: a.lastPatterns };
    });
    if (!r.buttons.some((b) => b.startsWith('show:')) || r.nodes < 3 || r.chosen !== 'chosen') throw new Error(JSON.stringify(r));
    const after = await ev(() => {
      const a = window.__fw.app;
      const c = a.cards.get('patterns');
      const n = a.agent.results.length + (a.agent.shared || []).length;
      c.press(`show:${n - 1}`);
      const quiet = a.view.quiet;
      a.closeAgent();
      return { quiet, want: a.thoughts.want };
    });
    if (after.quiet || after.want) throw new Error(JSON.stringify(after));
    return { nodes: r.nodes, buttons: r.buttons };
  });

  await step('Stop ends a run that never answers, and the tree leaves', async () => {
    why = () => null;
    await ev((x) => {
      window.__fw.app.askWhy(x);
    }, id);
    await page.waitForTimeout(300);
    const during = await ev(() => ({ running: window.__fw.app.agent?.running, close: window.__fw.app.cards.get('agent').buttonIds().includes('close') }));
    await ev(() => window.__fw.app.cards.get('agent').press('close'));
    await page.waitForTimeout(500);
    const after = await ev(() => ({ agent: !!window.__fw.app.agent, card: !!window.__fw.app.cards.get('agent'), want: window.__fw.app.thoughts.want, quiet: window.__fw.app.view.quiet }));
    if (!during.running || after.agent || after.card || after.want || after.quiet) throw new Error(JSON.stringify({ during, after }));
    return { during, after };
  });

  await step('no answer in time says so, and asking again works', async () => {
    why = () => null;
    await ev((x) => {
      const a = window.__fw.app;
      a.client.stallMs = 800;
      a.askWhy(x);
    }, id);
    await page.waitForFunction(() => window.__fw.app.agent && !window.__fw.app.agent.running, null, { timeout: 8000 });
    const note = await ev(() => window.__fw.app.agent.note);
    if (!/did not answer/.test(note)) throw new Error(note);
    await ev(() => {
      window.__fw.app.client.stallMs = 70000;
      window.__fw.app.closeAgent();
    });
    return note;
  });

  await step('no console errors', async () => {
    const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource|AudioContext/.test(l.text));
    if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 3)));
    return { messages: logs.length };
  });
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/ui-v2-agent.json`, JSON.stringify({ when: new Date().toISOString(), results }, null, 1));
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} passed (Playwright on the flat page, scripted agent answers)`);
process.exit(passed === results.length ? 0 : 1);
