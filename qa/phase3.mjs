/**
 * Phase 3 scripted-hands QA: Ask with citations, local reliability, kept
 * answers, notes + pinned workspace, lights panel, briefing, settings,
 * insights, Evidence Pack export (real download, validated), audio/voice
 * availability, and the offline paths. SCRIPTED IWER hands, not a Quest.
 *
 *   node qa/phase3.mjs            live + offline
 *   node qa/phase3.mjs offline
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { launch, open, enterXR, shot, errorsOf, OUT } from './lib.mjs';

const only = process.argv[2];
const results = [];

async function step(page, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS  ${name}${detail ? '  ' + JSON.stringify(detail).slice(0, 220) : ''}`);
  } catch (err) {
    results.push({ name, pass: false, ms: Date.now() - t0, detail: String(err.message || err) });
    console.log(`FAIL  ${name}  ${String(err.message || err).slice(0, 300)}`);
    await shot(page, `p3-fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}

async function helpers(page) {
  await page.evaluate(() => {
    const d = window.IWER_DEVICE;
    const app = window.__fw.app;
    const V = app.anchor.head.constructor;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const rest = () => {
      const h = app.anchor.head;
      return { x: h.x + 0.18, y: h.y - 0.3, z: h.z - 0.25 };
    };
    window.__qa = {
      wait,
      async pinchAt(target, device = 'hand-right') {
        await d.remote.dispatch('set_transform', { device, position: rest() });
        await d.remote.dispatch('look_at', { device, target });
        await wait(120);
        await d.remote.dispatch('set_select_value', { device, value: 1 });
        await wait(150);
        await d.remote.dispatch('set_select_value', { device, value: 0 });
        await wait(150);
      },
      cardOf(key) {
        if (key === 'keypad') return app.keypad.card;
        if (key === 'status') return app.statusCard;
        if (key === 'help-button') return app.helpButton;
        return app.cards.get(key);
      },
      async press(key, id) {
        await wait(500);
        const c = this.cardOf(key);
        const p = c?.buttonWorldPosition(id);
        if (!p) throw new Error(`no button ${key}/${id} (has: ${c?.buttonIds()})`);
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      async type(text) {
        for (const ch of text) await this.press('keypad', ch === ' ' ? 'space' : `key:${ch}`);
      },
      async help() {
        const p = app.helpButton.buttonWorldPosition('help');
        await this.pinchAt({ x: p.x, y: p.y, z: p.z });
      },
      open: () => app.cards.open.map((e) => e.key),
    };
  });
}

async function boot(page, { offline = false } = {}) {
  await open(page);
  await enterXR(page);
  await helpers(page);
  await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__fw.app.onboarding.finish();
    window.__fw.app.cards.closeAll();
  });
  return offline;
}

const ev = (page, fn, a) => page.evaluate(fn, a);

async function liveRun() {
  const { browser, page, logs } = await launch();
  try {
    await boot(page);
    let lightId;

    await step(page, 'live: Ask by pinch (suggestion card) → cited answer or honest no', async () => {
      lightId = await ev(page, () => window.__fw.app.lights.items.find((x) => x.via === 'wikipedia')?.id || window.__fw.app.lights.items[0].id);
      await ev(page, (id) => window.__fw.app.openLight(id), lightId);
      await ev(page, (id) => window.__qa.press(`light:${id}`, 'ask'), lightId);
      if (!(await ev(page, () => window.__fw.app.keypad.isOpen && window.__fw.app.keypadMode === 'ask'))) throw new Error('ask keypad not open');
      const sugg = await ev(page, () => window.__fw.app.keypad.suggestions);
      await ev(page, (i) => window.__qa.press('keypad', `sug:${i}`), sugg.indexOf('Who is affected?'));
      await page.waitForFunction(() => window.__fw.app.lastAnswer, null, { timeout: 120000 });
      const a = await ev(page, () => window.__fw.app.lastAnswer);
      const cited = a.sentences.filter((s) => s.cites.length).length;
      if (!(a.answerable ? cited >= 1 : /doesn't tell us/i.test(a.text))) throw new Error(JSON.stringify(a).slice(0, 300));
      await shot(page, 'p3-01-answer');
      return { answerable: a.answerable, sentences: a.sentences.length, cited, citations: Object.keys(a.citations || {}).length };
    });

    await step(page, 'pinch a citation chip shows where it comes from', async () => {
      const ids = await ev(page, () => window.__qa.cardOf('answer').buttonIds().filter((b) => b.startsWith('cite:')));
      if (!ids.length) return { skipped: 'no citations in this answer' };
      await ev(page, (id) => window.__qa.press('answer', id), ids[0]);
      const open = await ev(page, () => window.__qa.open());
      if (!open.some((k) => k.startsWith('node:') || k === 'citation')) throw new Error(JSON.stringify(open));
      return { open };
    });

    await step(page, '"Is this reliable?" answered locally from the evidence', async () => {
      await ev(page, () => (window.__fw.app.lastAnswer = null));
      await ev(page, (id) => window.__fw.app.ask('Is this reliable?', id), lightId);
      const a = await ev(page, () => window.__fw.app.lastAnswer);
      if (!a.local || !a.sentences.length) throw new Error(JSON.stringify(a));
      return { text: a.text.slice(0, 140) };
    });

    await step(page, 'Keep an answer by pinch → Library', async () => {
      await ev(page, () => window.__qa.press('answer', 'seal'));
      const n = await ev(page, () => window.__fw.app.sealedAnswers.length);
      if (n < 1) throw new Error('not kept');
      return { kept: n };
    });

    await step(page, 'Notes: help → Notes → Add note by typing → Pin', async () => {
      await ev(page, () => window.__fw.app.cards.closeAll());
      await ev(page, () => window.__qa.help());
      await ev(page, () => window.__qa.press('help', 'notes'));
      await ev(page, () => window.__qa.press('notes', 'add'));
      await ev(page, () => window.__qa.type('check port news'));
      await ev(page, () => window.__qa.press('keypad', 'go'));
      await ev(page, () => window.__qa.press('notes', 'pin'));
      const r = await ev(page, () => ({ notes: window.__fw.app.userNotes.map((n) => n.text), layout: JSON.parse(localStorage.getItem('fogweave.workspace.v1') || '{}') }));
      if (!r.notes.includes('check port news') || !('notes' in r.layout)) throw new Error(JSON.stringify(r));
      return r;
    });

    await step(page, 'pinned panel comes back after a reload', async () => {
      await page.reload();
      await page.waitForFunction(() => window.__fw?.app && window.IWER_DEVICE, null, { timeout: 30000 });
      await enterXR(page);
      await helpers(page);
      await page.waitForFunction(() => window.__fw.app.mode !== 'starting', null, { timeout: 120000 });
      const r = await ev(page, () => ({ open: window.__qa.open(), pinned: window.__fw.app.cards.entry('notes')?.pinned }));
      if (!r.open.includes('notes') || !r.pinned) throw new Error(JSON.stringify(r));
      await ev(page, () => window.__qa.press('notes', 'move'));
      return r;
    });

    await step(page, 'Lights panel: pinch a row opens its reader card', async () => {
      await ev(page, () => window.__fw.app.onboarding.finish());
      await ev(page, () => window.__fw.app.openLightsPanel());
      const row = await ev(page, () => window.__qa.cardOf('lights').buttonIds().find((b) => b.startsWith('open:')));
      await ev(page, (b) => window.__qa.press('lights', b), row);
      const open = await ev(page, () => window.__qa.open());
      if (!open.some((k) => k.startsWith('light:'))) throw new Error(JSON.stringify(open));
      return { open };
    });

    await step(page, 'Expand → insights appear as a gentle prompt; pinch one', async () => {
      await ev(page, () => window.__fw.app.cards.closeAll({ keepPinned: true }));
      const id = await ev(page, () => window.__fw.app.lights.items.find((x) => x.live && !x.expanded && x.via === 'wikipedia')?.id);
      await ev(page, (lid) => window.__fw.app.openLight(lid), id);
      await ev(page, (lid) => window.__qa.press(`light:${lid}`, 'expand'), id);
      await page.waitForFunction((lid) => window.__fw.app.lights.get(lid).expanded === true, id, { timeout: 180000 });
      const n = await ev(page, () => window.__fw.app.insightList.length);
      if (!n) return { insights: 0, note: 'nothing notable in this web' };
      await ev(page, () => window.__qa.press('status', 'insights'));
      await ev(page, () => window.__qa.press('insights', 'ins:0'));
      const open = await ev(page, () => window.__qa.open());
      await shot(page, 'p3-02-insights');
      return { insights: n, open };
    });

    await step(page, 'Daily briefing by pinch: keep one, step to the end', async () => {
      await ev(page, () => window.__fw.app.cards.closeAll({ keepPinned: true }));
      await ev(page, () => window.__qa.help());
      await ev(page, () => window.__qa.press('help', 'briefing'));
      const b0 = await ev(page, () => ({ n: window.__fw.app.briefing?.items.length, outside: window.__fw.app.briefing?.items.filter((x) => x.outside).length }));
      if (!b0.n || b0.outside !== 1) throw new Error(JSON.stringify(b0));
      await ev(page, () => window.__qa.press('briefing', 'seal'));
      for (let i = 0; i < b0.n; i++) await ev(page, () => window.__qa.press('briefing', 'next'));
      const r = await ev(page, () => ({ done: window.__fw.app.briefing?.done, kept: window.__fw.app.briefing?.sealedCount }));
      if (!r.done || r.kept < 1) throw new Error(JSON.stringify(r));
      await shot(page, 'p3-03-briefing');
      await ev(page, () => window.__qa.press('briefing', 'close'));
      return { ...b0, ...r };
    });

    await step(page, 'Settings by pinch: gentle motion on, persisted', async () => {
      await ev(page, () => window.__fw.app.openSettings());
      await ev(page, () => window.__qa.press('settings', 't:gentle'));
      const r = await ev(page, () => ({ gentle: window.__fw.settings.comfort.gentle, saved: JSON.parse(localStorage.getItem('fogweave.settings.v1')).comfort.gentle }));
      if (!r.gentle || !r.saved) throw new Error(JSON.stringify(r));
      await ev(page, () => window.__qa.press('settings', 't:gentle'));
      return r;
    });

    await step(page, 'Export pack by pinch: real download, validated (JSON-LD → SHACL + SPARQL)', async () => {
      await ev(page, () => window.__fw.app.cards.closeAll({ keepPinned: true }));
      // seal something from the web so the pack has claims and links
      await ev(page, () => {
        const app = window.__fw.app;
        const claim = [...app.store.nodes.values()].find((n) => n.type === 'Claim');
        if (claim) app.seal(claim.id);
      });
      await ev(page, () => window.__fw.app.openLibrary());
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), ev(page, () => window.__qa.press('library', 'export'))]);
      const path = `${OUT}/evidence-pack-live.zip`;
      await download.saveAs(path);
      const files = unzipSync(new Uint8Array(readFileSync(path)));
      const names = Object.keys(files).sort();
      const r = await ev(page, () => window.__fw.app.lastExport);
      const md = strFromU8(files['README.md']);
      if (!names.includes('pack.jsonld') || !names.includes('claims.jsonl') || !md.includes('Licence and attribution')) throw new Error(JSON.stringify(names));
      if (!r.validation?.shacl?.conforms) throw new Error('SHACL: ' + JSON.stringify(r.validation?.shacl).slice(0, 300));
      if (/ctx:|ContextNode/.test(strFromU8(files['pack.jsonld']))) throw new Error('private context leaked into the pack');
      await shot(page, 'p3-04-export');
      return { names, counts: r.counts, triples: r.validation.triples, shacl: r.validation.shacl.conforms };
    });

    await step(page, 'optional extras: read aloud / voice / ambient availability', async () => {
      const r = await ev(page, () => ({
        speech: 'speechSynthesis' in window,
        voices: window.speechSynthesis?.getVoices?.().length ?? 0,
        recognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        ambient: window.__fw.app.ambient.on,
      }));
      await ev(page, () => {
        window.__fw.settings.voice.enabled = true;
        window.__fw.app.openKeypad('ask');
      });
      r.micKey = await ev(page, () => window.__qa.cardOf('keypad').buttonIds().includes('mic'));
      await ev(page, () => {
        window.__fw.settings.voice.enabled = false;
        window.__fw.app.keypad.close();
      });
      return r;
    });

    await step(page, 'live run: no console errors', async () => {
      const errs = errorsOf(logs);
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 4)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

async function offlineRun() {
  const { browser, context, page, logs } = await launch();
  try {
    await context.route('http://localhost:8787/**', (route) => route.abort());
    await boot(page, { offline: true });

    await step(page, 'offline: recorded answer replays for a suggested question', async () => {
      const id = await ev(page, () => Object.keys(window.__fw.app.snapshot.expansions)[1] || Object.keys(window.__fw.app.snapshot.expansions)[0]);
      await ev(page, (lid) => window.__fw.app.openLight(lid), id);
      await ev(page, (lid) => window.__qa.press(`light:${lid}`, 'expand'), id);
      await page.waitForFunction((lid) => window.__fw.app.lights.get(lid).expanded === true, id, { timeout: 60000 });
      await ev(page, (lid) => window.__fw.app.ask('Who is affected?', lid), id);
      const a = await ev(page, () => window.__fw.app.lastAnswer);
      if (!a.recorded) throw new Error(JSON.stringify(a).slice(0, 300));
      return { recorded: a.recorded, answerable: a.answerable, sentences: a.sentences.length };
    });

    await step(page, 'offline: a typed question says it needs the live engine', async () => {
      const a = await ev(page, () => window.__fw.app.ask('what is the weather in rotterdam'));
      if (!/needs the live engine/.test(a.text)) throw new Error(a.text);
      return { text: a.text.slice(0, 80) };
    });

    await step(page, 'offline: export still works (not validated, says so)', async () => {
      await ev(page, () => {
        const app = window.__fw.app;
        const n = [...app.store.nodes.values()].find((x) => x.type === 'Claim');
        if (n) app.seal(n.id);
        app.openLibrary();
      });
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), ev(page, () => window.__qa.press('library', 'export'))]);
      await download.saveAs(`${OUT}/evidence-pack-offline.zip`);
      const r = await ev(page, () => window.__fw.app.lastExport);
      if (r.validation) throw new Error('expected no validation offline');
      return { counts: r.counts, bytes: r.bytes };
    });

    await step(page, 'offline run: no console errors', async () => {
      const errs = errorsOf(logs).filter((l) => !/ERR_FAILED|net::|Failed to load resource/.test(l.text));
      if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 4)));
      return { messages: logs.length };
    });
  } finally {
    await browser.close();
  }
}

try {
  if (only !== 'offline') await liveRun();
  await offlineRun();
} finally {
  writeFileSync(`${OUT}/phase3-results.json`, JSON.stringify({ when: new Date().toISOString(), scripted: true, results }, null, 1));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed (scripted IWER hands, headless Chromium; not a real Quest)`);
}
