/**
 * App: glue between the news web (GraphStore), its view, the lights, the
 * cards, the keypad, the props, the reader's private context and the
 * research engine. All user actions come in here, so the hand path, the
 * desktop path and scripted QA share one code path.
 *
 * Live when the backend answers; otherwise the bundled, dated snapshot of
 * real pipeline runs (take-it-away test), and the status line says which.
 */
import { Vector3, Quaternion, Ray, Hovered } from '@iwsdk/core';
import { GraphStore, similarity, removeNodes as removeNodesFromStore } from './model/graph.js';
import { shortestPath, importanceOf, mostImportant, evidenceReadout, bestPath, pagerank } from './model/algorithms.js';
import { GraphView } from './render/graph-view.js';
import { Atmosphere } from './render/atmosphere.js';
import { Card } from './render/card.js';
import { CardManager } from './ui/card-manager.js';
import { nodeCardDraw, locketDraw, coinDraw, messageDraw, pathDraw } from './ui/node-card.js';
import { menuDraw, guideDraw, aboutDraw, libraryDraw } from './ui/help.js';
import { welcomeStep, welcomeDone } from './ui/welcome.js';
import { contextDraw } from './ui/context-card.js';
import { Keypad } from './ui/keypad.js';
import { Onboarding } from './ui/onboarding.js';
import { Props } from './props.js';
import { YAW_MAX, LightField } from './render/lights.js';
import { readerDraw, READER_SIZE } from './ui/reader-card.js';
import { EventPlayer, applyEvent } from './research/events.js';
import { ResearchClient } from './research/client.js';
import { ContextStore, SAMPLE_PERSONA, CONTEXT_KINDS } from './context.js';
import { InterestStore } from './interests.js';
import { isMuted, sampleFeed, seedFrom } from './feed.js';
import { checkRequest } from './safety.js';
import { interestsDraw } from './ui/interests-card.js';
import { DEBUG, settings, loadSettings, setQuality, saveSettings } from './config.js';
import { answerDraw, ASK_SUGGESTIONS, settingsDraw, timelineDraw, exportDraw, insightsDraw, patternsDraw } from './ui/panels.js';
import { sharedPatterns } from './patterns.js';
import { insights } from './insights.js';
import { Ambient, speech } from './audio.js';
import { sealedView, buildJsonLd, buildJsonl, buildMarkdown } from './export/pack.js';
import { zipSync, strToU8 } from 'fflate';
import { QualityGovernor } from './quality.js';

const LIBRARY_KEY = 'fogweave.library.v1';
const NOTES_KEY = 'fogweave.notes.v1';
const ANSWERS_KEY = 'fogweave.answers.v1';
const SEALED_LIGHTS_KEY = 'fogweave.sealedLights.v1';
const SNAPSHOT = 'demo/snapshot/index.json';

const _hp = new Vector3();
const _hq = new Quaternion();

export class App {
  constructor(system) {
    this.sys = system;
    this.world = system.world;
    loadSettings();
    // seated anchor: refreshed from the real head pose when XR starts
    this.anchor = { head: new Vector3(0, 1.2, 0), yaw: 0 };
    this.store = new GraphStore();
    this.store.setMeta({ topic: 'News web', topicKey: 'news' });
    this.atmosphere = new Atmosphere(this.world);
    this.view = new GraphView(this.world, this.store, { center: this._bubbleCenter(), radius: settings.bubble.radius });
    this.cards = new CardManager(this.world, this.anchor);
    this.cards.onClose = (key) => this._onCardClosed(key);
    this.keypad = new Keypad(this.world, this.anchor, { onSubmit: (text) => this._onKeypadSubmit(text), onClose: () => {} });
    this.keypadMode = 'find';
    this.props = new Props(this.world, this.anchor, {
      onReveal: (kind, info) => this.reveal(kind, info),
      onBothHeld: () => this.pathFromProps(),
    });
    this.lights = new LightField(this.world, this.anchor);
    this.lights.onSelect = (id) => this.openLight(id);
    this.lightsMeta = null;
    this.sealedLights = readJSON(SEALED_LIGHTS_KEY, {});
    this.lights.sealed = new Set(Object.keys(this.sealedLights));
    this.context = new ContextStore();
    this.interests = new InterestStore();
    this.pool = [];
    this.feedSeed = seedFrom(new Date().toISOString().slice(0, 10));
    this._refreshAt = 0;
    this.client = new ResearchClient();
    this.snapshot = null;
    this.mode = 'starting'; // live | offline
    this.onboarding = new Onboarding(this);
    this.governor = new QualityGovernor((level) => {
      setQuality(level);
      this.view.markLabelsDirty();
    });
    this.selectedId = null;
    this.prevSelectedId = null;
    this.trail = [];
    this.linkFromId = null;
    this.player = null; // replay of a recorded run
    this.expanding = null; // { id, controller } live run
    this.statusText = '';
    this.notes = []; // status notes from the engine
    this.lastStats = null;
    this.userNotes = readJSON(NOTES_KEY, []);
    this.sealedAnswers = readJSON(ANSWERS_KEY, []);
    this.answers = []; // session memory of answers
    this.insightList = [];
    this.ambient = new Ambient();
    this._gestureSeen = false;
    this._buildStatusCard();
    this._buildHelpButton();
    this._wireNodePicking();
    this.store.on((ev) => this._onStoreChange(ev));
    this._restoreLibrary();
    this.context.syncToStore(this.store);
    this.ready = this._start();
  }

  // ---------- startup: live by default; the Demo scene is a separate choice ----------

  async _start() {
    const wantDemo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
    const [health, snap] = await Promise.all([wantDemo ? null : this.client.health(), this._loadSnapshot()]);
    this.snapshot = snap;
    if (wantDemo) return this.enterDemo();
    await this.enterLive(health);
  }

  /** The live scene: today's news from the engine. Never falls back to old data silently. */
  async enterLive(health = null) {
    this._clearFog();
    const scene = (this._scene = (this._scene || 0) + 1); // a later scene choice wins
    this.mode = 'starting';
    this.setStatus('Gathering the latest news…');
    welcomeStep('Gathering today’s news…', { offerDemo: () => this.enterDemo() });
    health ??= await this.client.health();
    if (health?.ok) welcomeStep('Reading the sources and writing short summaries…', { offerDemo: () => this.enterDemo() });
    const pool = health?.ok ? await this.client.pool(this.interests.forServer()) : null;
    if (scene !== this._scene) return; // the Demo scene was opened while this loaded
    if (pool?.items?.length) {
      this.mode = 'live';
      const ok = Object.values(pool.sources || {}).filter((s) => s.ok).length;
      const all = Object.keys(pool.sources || {}).length;
      this.lightsMeta = { kind: 'live', generatedAt: pool.generatedAt, sources: `${ok} of ${all} feeds` };
      this.notes = pool.notes || [];
      this.pool = pool.items.map((it) => ({ ...it, live: true }));
      this._poolCache = new Map([[JSON.stringify(this.interests.forServer()), this.pool]]);
    } else {
      // say so plainly and offer the Demo scene; old data is never shown as live
      this.mode = 'unavailable';
      this.lightsMeta = { kind: 'none' };
      this.pool = [];
    }
    this._afterSceneStart();
  }

  /** The Demo / Offline scene: the bundled dated snapshot of real pipeline runs. */
  enterDemo() {
    this._clearFog();
    this._scene = (this._scene || 0) + 1;
    if (!this.snapshot) {
      this.mode = 'unavailable';
      this.lightsMeta = { kind: 'none' };
      this.pool = [];
      this.setStatus('The demo scene is missing from this build.');
      welcomeDone();
      return;
    }
    this.mode = 'offline';
    this.lightsMeta = { kind: this.snapshot.provenance?.kind, generatedAt: this.snapshot.generatedAt };
    this.notes = [];
    this.pool = this.snapshot.pool || this.snapshot.lights || [];
    this._poolCache = new Map();
    this._afterSceneStart();
  }

  _afterSceneStart() {
    this.drawLights();
    welcomeDone();
    this._shownKey = JSON.stringify(this.interests.forServer());
    this.setStatus('');
    this._renderStatus();
    if (!this._startedOnce) {
      this._startedOnce = true;
      this._restoreWorkspace();
      if (Onboarding.needed()) this.startOnboarding();
    }
    this.cards.get('help')?.redraw();
  }

  /** Switching scenes: the fog empties (the sealed Library stays). */
  _clearFog() {
    this.expanding?.controller?.abort?.();
    this.cards.closeAll({ keepPinned: true });
    const fog = [...this.store.nodes.values()].filter((n) => !n.sealed && n.type !== 'ContextNode').map((n) => n.id);
    if (fog.length) removeNodesFromStore(this.store, fog);
    this.trail = [];
    this.lights.setItems([]);
    this._shownLights = new Map();
    this.extraItems = new Map();
  }

  // ---------- workspace panels (pinned cards come back where you left them) ----------

  _restoreWorkspace() {
    const layout = this.cards.savedLayout();
    const open = { library: () => this.openLibrary(layout.library) }; // the Library is the one panel that is kept
    for (const key of Object.keys(layout)) {
      if (!open[key]) continue;
      open[key]();
      this.cards.entry(key) && (this.cards.entry(key).pinned = true);
      this.cards.get(key)?.redraw();
    }
  }

  get notesList() {
    return this.userNotes;
  }

  openSettings() {
    this.closeCard('help');
    this.cards.show('settings', { width: 0.46, height: 0.42, draw: settingsDraw(this), slot: 1 });
  }

  saveSettings() {
    saveSettings();
    this.setAmbient(settings.audio.enabled, { persist: false });
  }

  setAmbient(on, { persist = true } = {}) {
    settings.audio.enabled = on;
    if (persist) saveSettings();
    if (on && this._gestureSeen) this.ambient.start();
    if (!on) this.ambient.stop();
  }

  /** Browsers only allow sound after a gesture: the first pinch/click. */
  userGesture() {
    if (this._gestureSeen) return;
    this._gestureSeen = true;
    if (settings.audio.enabled) this.ambient.start();
  }

  voiceAvailable() {
    // an `in` check: nothing speech-related is touched until the reader turns voice on
    return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  }

  addNote(text) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return;
    this.userNotes.push({ text: t, at: new Date().toISOString() });
    writeJSON(NOTES_KEY, this.userNotes);
    this.cards.get('library')?.redraw();
  }

  removeNote(i) {
    this.userNotes.splice(i, 1);
    writeJSON(NOTES_KEY, this.userNotes);
    this.cards.get('library')?.redraw();
  }

  // ---------- Ask (GraphRAG on the server; reliability answered locally) ----------

  openAsk(focusId) {
    this.askFocus = focusId;
    this.openKeypad('ask');
  }

  async ask(question, focusId = this.askFocus) {
    const q = String(question || '').trim();
    if (!q) return null;
    this.setStatus('Thinking about your question…');
    let a;
    if (/^is this reliable\??$/i.test(q)) a = this._localReliability(q, focusId);
    else if (this.mode === 'live') {
      const r = await this.client.ask(q, this.compactGraph(focusId));
      a = r ? { ...r, question: q } : { question: q, refused: false, answerable: false, text: 'The engine did not answer; try again.', sentences: [], citations: {} };
    } else {
      const rec = this._recordedAnswer(q, focusId);
      a = rec || { question: q, refused: false, answerable: false, text: 'Asking needs the live engine. Offline, recorded answers exist for the suggested questions on expanded items.', sentences: [], citations: {} };
    }
    a.focus = focusId;
    this.answers.push(a);
    this.lastAnswer = a;
    this.setStatus('');
    this.cards.show('answer', { width: 0.48, height: 0.46, draw: answerDraw(this, a), slot: 2 });
    this.onboarding.notify('asked');
    return a;
  }

  _recordedAnswer(q, focusId) {
    const recs = this._recordedAnswers?.[focusId] || {};
    const hit = Object.entries(recs).find(([k]) => k.toLowerCase() === q.toLowerCase());
    return hit ? { ...hit[1], question: q, recorded: hit[1].recordedAt || this.snapshot?.generatedAt } : null;
  }

  /** "Is this reliable?" from the evidence breakdown: deterministic, no LLM. */
  _localReliability(q, focusId) {
    const id = focusId && this.store.nodes.has(focusId) ? focusId : null;
    const light = this.lights.get(focusId);
    const citations = {};
    const sentences = [];
    if (!id) {
      const n = (light?.claims || []).length;
      sentences.push({ text: `${n} key claim${n === 1 ? '' : 's'} were read from ${light?.source || 'the source'}; none is checked against other sources until you expand it.`, cites: ['F1'], kind: 'supported' });
      citations.F1 = { text: light?.headline || '', source: light?.url || '', quote: light?.claims?.[0]?.quote || '' };
      return { question: q, local: true, answerable: true, refused: false, sentences, citations, text: sentences[0].text };
    }
    const node = this.store.nodes.get(id);
    const claims = [...this.store.edges.values()].filter((e) => e.from === id && e.type === 'reports').map((e) => this.store.nodes.get(e.to)).filter(Boolean);
    const list = node.type === 'Claim' ? [node] : claims;
    const count = (v) => list.filter((c) => (c.verdict || 'unverified') === v).length;
    const s1 = `Of ${list.length} key claim${list.length === 1 ? '' : 's'}, ${count('supported')} ${count('supported') === 1 ? 'is' : 'are'} well supported by independent sources, ${count('mixed')} mixed, ${count('contradicted')} contradicted and ${count('unverified')} unverified.`;
    sentences.push({ text: s1, cites: list.slice(0, 3).map((c, i) => `F${i + 1}`), kind: 'supported' });
    list.slice(0, 3).forEach((c, i) => (citations[`F${i + 1}`] = { node: c.id, text: c.label, quote: c.quote || '', source: c.url || '' }));
    const weak = list.filter((c) => (c.evidence?.independentDomains ?? 1) <= 1).length;
    if (weak) sentences.push({ text: `${weak} rest${weak === 1 ? 's' : ''} on a single source, which is a weak spot.`, cites: list.slice(0, 1).map(() => 'F1'), kind: 'supported' });
    if (node.outlet) sentences.push({ text: `The outlet is ${node.outlet}${node.sourceClass ? ` (${node.sourceClass})` : ''}.`, cites: ['F1'], kind: 'supported' });
    return { question: q, local: true, answerable: true, refused: false, sentences, citations, text: sentences.map((s) => s.text).join(' ') };
  }

  /** The part of the web around a focus, without private context. */
  compactGraph(focusId, limit = 60) {
    const keep = new Set();
    const queue = [];
    if (focusId && this.store.nodes.has(focusId)) {
      keep.add(focusId);
      queue.push([focusId, 0]);
    }
    while (queue.length && keep.size < limit) {
      const [id, d] = queue.shift();
      if (d >= 2) continue;
      for (const { id: nb } of this.store.neighbors(id)) {
        const n = this.store.nodes.get(nb);
        if (!n || n.private || n.type === 'ContextNode' || keep.has(nb)) continue;
        keep.add(nb);
        queue.push([nb, d + 1]);
      }
    }
    const nodes = [...keep].map((id) => {
      const n = this.store.nodes.get(id);
      return { id: n.id, type: n.type, label: n.label, quote: n.quote, verdict: n.verdict, evidence: n.evidence && { independentDomains: n.evidence.independentDomains }, outlet: n.outlet, date: n.date, url: n.url };
    });
    // an unexpanded light: send what its reader card shows
    const light = this.lights.get(focusId);
    if (light && !keep.has(focusId)) {
      nodes.push({ id: light.id, type: 'NewsItem', label: light.headline, outlet: light.source, date: light.date, url: light.url });
      (light.claims || []).forEach((c, i) => nodes.push({ id: `${light.id}:rc${i}`, type: 'Claim', label: c.text, quote: c.quote, verdict: 'unverified', url: light.url }));
    }
    const edges = [...this.store.edges.values()]
      .filter((e) => keep.has(e.from) && keep.has(e.to))
      .map((e) => ({ id: e.id, type: e.type, from: e.from, to: e.to, label: e.label, reasoning: e.reasoning, evidence: (e.evidence || []).slice(0, 1) }));
    return { nodes, edges };
  }

  showCitation(a, cid) {
    const c = a.citations?.[cid];
    if (!c) return;
    if (c.node && this.store.nodes.has(c.node)) {
      this.view.flash(c.node, 3);
      return this.pinchNode(c.node);
    }
    if (c.edge && this.store.edges.has(c.edge)) {
      const e = this.store.edges.get(c.edge);
      this.view.showPath({ nodes: [e.from, e.to], edges: [e] });
      this.view.flash(e.from, 3);
      this.view.flash(e.to, 3);
      return this.pinchNode(e.from);
    }
    this.cards.show('citation', {
      width: 0.44,
      height: 0.3,
      draw: messageDraw(this, 'citation', `Source ${cid.slice(1)}`, `${c.text}${c.quote ? `\n“${c.quote}”` : ''}\n${c.source || ''}`),
    });
  }

  keepAnswer(a) {
    if (a.refused) return;
    this.sealedAnswers.push({ question: a.question, text: a.text, citations: Object.values(a.citations || {}).map((c) => ({ text: c.text, quote: c.quote, source: c.source })), keptAt: new Date().toISOString() });
    writeJSON(ANSWERS_KEY, this.sealedAnswers);
    this.cards.get('answer')?.redraw();
    this.onboarding.notify('sealed');
  }

  // ---------- stories / timeline ----------

  storyMates(id, { includeSelf = false } = {}) {
    const it = this.lights.get(id);
    if (!it || it.story === undefined || it.story === null) return includeSelf && it ? [it] : [];
    return this.lights.items
      .filter((x) => x.story === it.story && (includeSelf || x.id !== id))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  openTimeline(id) {
    this.lights.pull(this.storyMates(id, { includeSelf: true }).map((x) => x.id));
    this.cards.show('timeline', { width: 0.46, height: 0.42, draw: timelineDraw(this, id), slot: 2 });
  }

  // ---------- Evidence Pack export ----------

  async exportPack() {
    const generatedAt = new Date().toISOString();
    const view = sealedView(this.store, this.sealedLights);
    const notes = this.userNotes;
    const answers = this.sealedAnswers;
    const jsonld = buildJsonLd(view, { generatedAt, notes, answers });
    const validation = this.mode === 'live' ? await this.client.pack(jsonld) : null;
    const files = {
      'pack.jsonld': strToU8(JSON.stringify(jsonld, null, 1)),
      'claims.jsonl': strToU8(buildJsonl(view)),
      'README.md': strToU8(buildMarkdown(view, { generatedAt, notes, answers, validation })),
    };
    if (validation) files['validation.json'] = strToU8(JSON.stringify(validation, null, 1));
    const zip = zipSync(files);
    const filename = `fogweave-evidence-pack-${generatedAt.slice(0, 10)}.zip`;
    let downloaded = false;
    try {
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      downloaded = true;
    } catch (err) {
      console.warn('[fogweave] download failed', err);
    }
    const r = {
      filename,
      bytes: zip.length,
      downloaded,
      validation,
      counts: {
        news: view.nodes.filter((n) => n.type === 'NewsItem').length,
        claims: view.nodes.filter((n) => n.type === 'Claim').length,
        links: view.edges.length,
        answers: answers.length,
        notes: notes.length,
      },
    };
    this.lastExport = r;
    this.cards.show('export', { width: 0.46, height: 0.36, draw: exportDraw(this, r), slot: 2 });
    return r;
  }

  // ---------- insights ----------

  refreshInsights() {
    this.insightList = insights(this.store);
    this._renderStatus();
    return this.insightList;
  }

  openInsights() {
    this.cards.show('insights', { width: 0.46, height: 0.5, draw: insightsDraw(this, this.insightList), slot: 2 });
  }

  showInsight(ins) {
    for (const id of ins.ids) this.view.flash(id, 3);
    const first = ins.ids.find((id) => this.store.nodes.has(id));
    if (first) this.pinchNode(first);
  }

  // ---------- feed: good news, random but curated ----------

  /** Draw the lights from the pool (seeded weighted random sampling). */
  drawLights({ keep = true } = {}) {
    const busy = keep ? this.lights.busyIds() : new Set();
    const kept = this.lights.items.filter((it) => busy.has(it.id));
    const picks = sampleFeed(this.pool, this.interests, { n: 16 - kept.length, seed: this.feedSeed, exclude: new Set(kept.map((k) => k.id)) });
    this.lights.setItems([...kept, ...picks]);
    this._applyRelevance();
    this._refreshAt = performance.now() + nextStarDelay();
    return picks;
  }

  /** "New lights": a new seed, same quality rules. */
  reshuffle() {
    this.feedSeed = (this.feedSeed * 1103515245 + 12345) >>> 0;
    this.drawLights();
    this.onboarding.notify('reshuffle');
  }

  /**
   * Interests changed: live pools are re-fetched (queries depend on them).
   * Going back to an earlier set of interests brings back the lights it showed.
   * Several quick changes: only the latest one draws.
   */
  async interestsChanged() {
    this.cards.get('interests')?.redraw();
    const gen = (this._interestGen = (this._interestGen || 0) + 1);
    const key = JSON.stringify(this.interests.forServer());
    this._shownLights ??= new Map();
    if (this._shownKey) this._shownLights.set(this._shownKey, [...this.lights.items]);
    const earlier = this._shownLights.get(key);
    const show = () => {
      if (earlier) this._restoreLights(earlier);
      else this.drawLights();
      this._shownKey = key;
    };
    if (this.mode === 'live') {
      this._poolCache ??= new Map();
      const cached = this._poolCache.get(key);
      if (cached) {
        this.pool = cached;
        // an older fetch may still be running for interests no longer wanted
        if (this.statusText.startsWith('Looking for more lights')) this.setStatus('');
      }
      else {
        // at once: the current pool, re-weighted by the new interests (a fresh
        // pool takes 30-60 s live: paced news searches and summaries)
        show();
        this.setStatus('Looking for more lights that match…');
        const res = await this.client.pool(this.interests.forServer());
        if (gen !== this._interestGen) return; // a newer change is on its way
        if (this.statusText.startsWith('Looking for more lights')) this.setStatus('');
        if (res?.items?.length) {
          this.pool = res.items.map((it) => ({ ...it, live: true }));
          this._poolCache.set(key, this.pool);
          this.drawLights();
        }
        return;
      }
    }
    show();
  }

  /** Show these lights again, topped up by the sampler. */
  _restoreLights(earlier) {
    const busy = this.lights.busyIds();
    const kept = this.lights.items.filter((it) => busy.has(it.id));
    const back = earlier.filter((it) => !busy.has(it.id) && !isMuted(it, this.interests));
    const items = [...kept, ...back].slice(0, 16);
    const fill = sampleFeed(this.pool, this.interests, { n: 16 - items.length, seed: this.feedSeed, exclude: new Set(items.map((k) => k.id)) });
    this.lights.setItems([...items, ...fill]);
    this._applyRelevance();
    this._refreshAt = performance.now() + nextStarDelay();
  }

  async likeLight(id, more = true) {
    const it = this.getItem(id);
    if (!it) return;
    const types = this.interests.likeItem(it, more);
    this.cards.get(`light:${id}`)?.redraw();
    if (!types.length) {
      this.showNotice('Nothing to learn from this light: it has no topic tags.');
      return;
    }
    const text = `${more ? 'More' : 'Less'} like this: ${types.join(', ')}`;
    const undo = () => this.undoInterests();
    this.showNotice(text, { undo });
    await this.interestsChanged();
    // keep Undo in reach until a while after the lights have settled
    if (this.notice?.undo === undo) this.showNotice(text, { undo });
  }

  /** Interests back to before the last change; the lights follow. */
  undoInterests() {
    if (!this.interests.undo()) return;
    this.showNotice('Interests restored.');
    this.interestsChanged();
  }

  /** A short line on the status bar (with an optional Undo) for a few seconds. */
  showNotice(text, { undo = null, seconds = 12 } = {}) {
    this.notice = { text, undo, until: performance.now() + seconds * 1000 };
    this._renderStatus();
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => this._renderStatus(), seconds * 1000 + 50);
  }

  openInterests() {
    this.closeCard('help');
    this.cards.show('interests', { width: 0.5, height: 0.5, draw: interestsDraw(this), slot: 1 });
  }

  /**
   * A new star every 20-40 s: it takes the place of the oldest idle one, never
   * one you look at, have open, sealed, grew, or are reaching toward.
   */
  _slowRefresh(now) {
    if (!this._refreshAt || now < this._refreshAt || !this.pool.length) return;
    this._refreshAt = now + nextStarDelay();
    const busy = this.lights.busyIds();
    const shown = new Set(this.lights.items.map((x) => x.id));
    const reaching = (x) => {
      const p = this.lights.worldPositionOf(x.id, _rp);
      return !!p && (this.lights.hands || []).some((h) => h.distanceTo(p) < 0.4);
    };
    const idle = this.lights.items.filter((x) => !busy.has(x.id) && !this.lights.sealed.has(x.id) && !x.expanded && !x.search && !reaching(x));
    const victim = idle.sort((a, b) => this.lights.ageDays(b) - this.lights.ageDays(a))[0];
    if (!victim) return;
    this.feedSeed = (this.feedSeed + 7919) >>> 0;
    const [fresh] = sampleFeed(this.pool, this.interests, { n: 1, seed: this.feedSeed, exclude: shown });
    if (fresh) this.lights.replaceItem(victim.id, fresh);
  }

  async _loadSnapshot() {
    try {
      const res = await fetch(SNAPSHOT);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /**
   * Light glow = relevance to the reader. With a context, items mentioning
   * it glow brighter; expanded items use personalized PageRank in the web.
   */
  _applyRelevance() {
    const labels = this.context.labels().map((l) => l.toLowerCase());
    const pr = labels.length ? importanceSeeds(this) : null;
    for (const it of this.lights.items) {
      let rel = it.relevance ?? 0.35;
      if (labels.length) {
        const text = `${it.headline} ${it.summary || ''}`.toLowerCase();
        const lex = Math.max(0, ...labels.map((l) => (text.includes(l) ? 1 : similarity(l, text))));
        rel = Math.max(rel * 0.6, 0.15 + 0.85 * lex);
      }
      if (pr?.has(it.id)) rel = Math.max(rel, Math.min(1, pr.get(it.id) * 12));
      it.glow = rel;
    }
    this.lights.items.forEach((it) => (it.relevance = it.glow));
  }

  _bubbleCenter() {
    const { head, yaw } = this.anchor;
    const b = settings.bubble;
    // a growing web moves out as it grows, so its near side never reaches the
    // status bar (nodes in front of the bar used to catch pinches meant for Back)
    const forward = b.forward + Math.max(0, (this.view?.radius ?? b.radius) - b.radius);
    return new Vector3(head.x + Math.sin(yaw) * forward, head.y - b.down, head.z - Math.cos(yaw) * forward);
  }

  /** Re-anchor everything to where the seated user's head actually is. */
  recenter(headPos, headQuat) {
    this.anchor.head.copy(headPos);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(headQuat);
    this.anchor.yaw = Math.atan2(fwd.x, -fwd.z);
    this.view.root.position.copy(this._bubbleCenter());
    this.props.resetHome();
    this.statusCard.placeFacing(this._statusPosition(), this.anchor.head);
    for (const e of this.cards.open) e.target = this.cards._slotPosition(e.slot);
    if (this.keypad.card) this.keypad._place();
  }

  // ---------- status line ----------

  _buildStatusCard() {
    this.statusCard = new Card(this.world, { width: 0.5, height: 0.075, name: 'status' });
    this.statusCard.placeFacing(this._statusPosition(), this.anchor.head);
    this._renderStatus();
  }

  _statusPosition() {
    const { head, yaw } = this.anchor;
    // in front of the web, low and close, like a desk edge (outside the web's bubble)
    return new Vector3(head.x + Math.sin(yaw) * 0.5, head.y - 0.45, head.z - Math.cos(yaw) * 0.5);
  }

  setStatus(text) {
    this.statusText = text;
    this._renderStatus();
  }

  get researching() {
    return !!this.expanding || (this.player && !this.player.done && !this.player.stopped);
  }

  modeLine() {
    const m = this.lightsMeta || {};
    if (this.mode === 'live') return `Live · ${m.sources || ''}`;
    if (this.mode === 'offline' && m.kind === 'pipeline') return `Demo scene · snapshot of ${String(m.generatedAt || '').slice(0, 10)}`;
    if (m.kind === 'fixture') return 'Demo scene · test fixture';
    if (this.mode === 'unavailable') return 'Live news is unreachable right now.';
    return this.mode === 'starting' ? 'Starting…' : 'Demo scene';
  }

  _renderStatus() {
    const running = this.researching;
    this.statusCard.setContent((ctx, ui, w, h) => {
      const pad = 34;
      const crumbs = this.trail.slice(-3).map((t) => shortLabel(this.store.nodes.get(t)?.label)).join(' › ');
      const notice = this.notice && performance.now() < this.notice.until ? this.notice : null;
      const label = running ? (notice ? notice.text : `Fog is looking · ${this.statusText}`) : notice?.text || this.statusText || (crumbs && this.trail.length >= 2 ? crumbs : '') || this.notes[0] || this.modeLine();
      if (running) ui.ringIcon(pad + 14, h / 2 - 2, 14, '#d9dee6', this.player?.paused ? 'dotted' : 'dashed');
      ui.text(label, pad + (running ? 44 : 0), h / 2 + 11, { size: 28, maxWidth: w - pad * 2 - (running ? (notice?.undo ? 470 : 240) : (this.insightList.length ? 240 : 0) + (this.trail.length >= 2 ? 250 : 0)) });
      if (running) {
        ui.button('stop', 'Stop', w - pad - 180, 14, 180, h - 28, () => this.stopResearch(), { size: 26 });
        // Undo stays reachable while something grows
        if (notice?.undo) ui.button('undo', 'Undo', w - pad - 410, 14, 210, h - 28, () => notice.undo(), { size: 24, primary: true });
      }
      else {
        if (this.trail.length >= 2) ui.button('back', '‹ Back', w - pad - 470, 14, 200, h - 28, () => this.back(), { size: 24 });
        if (this.mode === 'unavailable') ui.button('demo', 'Open demo', w - pad - 220, 14, 220, h - 28, () => this.enterDemo(), { size: 24, primary: true });
        // a short notice with Undo takes the right-hand slot for a few seconds
        else if (notice?.undo) ui.button('undo', 'Undo', w - pad - 220, 14, 220, h - 28, () => notice.undo(), { size: 24, primary: true });
        else if (this.insightList.length) ui.button('insights', `Noticed ${this.insightList.length}`, w - pad - 220, 14, 220, h - 28, () => this.openInsights(), { size: 24 });
      }
    });
  }

  // ---------- help button on the left wrist ----------

  _buildHelpButton() {
    // ray only: a poke target this close to its own hand's fingertip would always be hovered
    this.helpButton = new Card(this.world, { width: 0.06, height: 0.06, name: 'help-button' });
    this.helpButton.setContent((ctx, ui, w, h) => {
      ui.button('help', 'Menu', 6, 6, w - 12, h - 12, () => this.toggleHelp(), { size: 34 });
    });
  }

  toggleHelp() {
    if (this.cards.get('help')) this.closeCard('help');
    else this.cards.show('help', { width: 0.46, height: 0.32, draw: menuDraw(this), slot: 1 });
  }

  /** Help: how to read the fog (colours, rings, link styles, gestures). */
  openGuide() {
    this.closeCard('help');
    this.cards.show('guide', { width: 0.44, height: 0.52, draw: guideDraw(this), slot: 1 });
  }

  openAbout() {
    this.closeCard('help');
    this.cards.show('about', { width: 0.44, height: 0.42, draw: aboutDraw(this), slot: 1 });
  }

  /** Calm: gentler motion, fewer motes, softer glow. */
  toggleCalm() {
    settings.comfort.gentle = !settings.comfort.gentle;
    saveSettings();
    this.cards.get('help')?.redraw();
  }

  openLibrary(slot = 1) {
    this.closeCard('help');
    this.cards.show('library', { width: 0.44, height: 0.48, draw: libraryDraw(this), slot });
  }

  // ---------- Connect the dots: patterns across the Library ----------

  /** Everything sealed, as short texts (news, claims, things). */
  libraryItems() {
    const out = new Map();
    for (const it of Object.values(this.sealedLights || {})) out.set(it.id, { id: it.id, type: 'NewsItem', label: it.headline, date: it.date || '', text: it.summary || '' });
    for (const n of this.store.nodes.values()) {
      if (!n.sealed || out.has(n.id) || ['Source', 'ContextNode'].includes(n.type)) continue;
      out.set(n.id, { id: n.id, type: n.type, label: n.label, date: n.date || '', text: n.summary || n.quote || n.dossier?.overview || n.description || '' });
    }
    return [...out.values()];
  }

  async findPatterns() {
    const items = this.libraryItems();
    const show = (r) => {
      this.lastPatterns = r;
      this.cards.show('patterns', { width: 0.5, height: 0.56, draw: patternsDraw(this, r), slot: 2 });
      return r;
    };
    if (items.length < 2) return show({ patterns: [], note: 'Seal two or more items, then look for patterns.' });
    const shared = sharedPatterns(this.store, items);
    const live = this.mode === 'live';
    show({ patterns: shared, running: live, note: live ? 'Reading your items together for other patterns…' : 'Demo scene: shared names only. Other patterns need the live engine.' });
    if (!live) return this.lastPatterns;
    const res = await this.client.patterns(items.slice(0, 24));
    const more = res?.patterns || [];
    const note = !res ? 'The engine did not answer; shared names are shown.' : res.note || (more.length || shared.length ? '' : 'No pattern the items themselves can show.');
    return show({ patterns: [...shared, ...more].slice(0, 6), note });
  }

  /** Light up a pattern's items in the fog and open the first. */
  showPattern(p) {
    for (const id of p.items) if (this.store.nodes.has(id)) this.view.flash(id, 3);
    const first = p.items.find((id) => this.store.nodes.has(id));
    if (first) this.pinchNode(first);
    else if (p.items.some((id) => this.lights.get(id))) this.openLight(p.items.find((id) => this.lights.get(id)));
  }

  itemLabel(id) {
    return this.store.nodes.get(id)?.label || this.sealedLights?.[id]?.headline || this.lights.get(id)?.headline || id;
  }

  openContext() {
    this.closeCard('help');
    this.cards.show('context', { width: 0.46, height: 0.42, draw: contextDraw(this), slot: 1 });
  }

  startOnboarding(fromHelp = false) {
    if (fromHelp) this.closeCard('help');
    this.onboarding.start();
  }

  // ---------- node picking ----------

  _wireNodePicking() {
    const hit = this.view.hitMesh;
    // aimed picking: the node closest to the ray, not the first enlarged sphere
    const aim = new Ray();
    const pick = (e) => {
      // the real line of aim runs from the pointer through the point it hit
      // (the library's own e.ray uses the pointer's orientation, which for the
      // mouse's screen ray does not follow the cursor)
      const o = e.pointerPosition;
      const pt = e.point;
      const ray = o && pt ? aim.set(o, pt.clone().sub(o).normalize()) : null;
      return this.view.pickAlongRay(ray, this.view.nodeIdFromHit(e.instanceId));
    };
    hit.addEventListener('click', (e) => {
      const id = pick(e);
      if (id) this.pinchNode(id);
    });
    hit.addEventListener('pointermove', (e) => this.view.setHovered(pick(e)));
    hit.addEventListener('pointerleave', () => this.view.setHovered(null));
  }

  /** True while any of our interactive things is under a pointer. */
  /** Flat page: a small "Ask about a topic" option at the click; pressing it opens Ask the fog. */
  offerAsk(x, y) {
    if (typeof document === 'undefined' || this.keypad.isOpen) return;
    let b = this._askOption;
    if (!b) {
      b = this._askOption = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Ask about a topic…';
      b.style.cssText =
        'position:fixed;z-index:20;transform:translate(-50%,-130%);padding:9px 18px;border-radius:20px;cursor:pointer;white-space:nowrap;' +
        'font:500 15px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef1f6;background:rgba(10,14,26,0.86);' +
        'border:1px solid rgba(233,217,166,0.55);box-shadow:0 4px 18px rgba(0,0,0,0.35);transition:opacity .2s;opacity:0';
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideAskOption();
        this.onEmptyPinch();
      });
      document.body.appendChild(b);
    }
    // whole on screen, near where you clicked
    b.style.left = `${Math.min(Math.max(x, 110), innerWidth - 110)}px`;
    b.style.top = `${Math.max(y, 70)}px`;
    b.style.display = 'block';
    requestAnimationFrame(() => (b.style.opacity = '1'));
    clearTimeout(this._askOptionTimer);
    this._askOptionTimer = setTimeout(() => this.hideAskOption(), 5000);
  }

  hideAskOption() {
    clearTimeout(this._askOptionTimer);
    if (this._askOption) this._askOption.style.display = 'none';
  }

  /** Flat page: is this screen point empty fog, well away from every star, node and card? */
  isEmptyAt(cx, cy, canvas, radius = 70) {
    if (this.keypad.isOpen || this.anythingHovered()) return false;
    const cam = this.world.camera;
    const r = canvas.getBoundingClientRect();
    const near = (p) => {
      if (!p) return false;
      const v = p.project(cam);
      if (v.z > 1) return false; // behind the camera
      return Math.hypot(r.left + ((v.x + 1) / 2) * r.width - cx, r.top + ((1 - v.y) / 2) * r.height - cy) < radius;
    };
    for (const it of this.lights.items) if (near(this.lights.worldPositionOf(it.id, new Vector3()))) return false;
    for (const id of this.view.visibleIds) if (near(this.view.worldPositionOf(id, new Vector3()))) return false;
    return true;
  }

  anythingHovered() {
    const entities = [this.view.hitEntity, this.lights.hitEntity, this.statusCard.entity, this.helpButton.entity, ...this.props.items.map((p) => p.entity)];
    for (const e of this.cards.open) entities.push(e.card.entity);
    if (this.keypad.card) entities.push(this.keypad.card.entity);
    return entities.some((e) => e?.hasComponent?.(Hovered));
  }

  // ---------- explore: touch a node and the world around it opens ----------

  /** Focus a node: it moves to the middle, joins the trail, and is explored once. */
  focusNode(id, { explore = true } = {}) {
    const n = this.store.nodes.get(id);
    if (!n) return;
    if (this.trail.at(-1) !== id) this.trail.push(id);
    if (this.trail.length > 12) this.trail.shift();
    this.view.setFocus(id);
    if (explore && !n.explored && this.canExplore(id)) this.exploreNode(id);
    this._renderStatus();
  }

  canExplore(id) {
    const n = this.store.nodes.get(id);
    if (!n || ['Claim', 'Source', 'ContextNode'].includes(n.type)) return false;
    if (n.type === 'NewsItem') return false; // news items grow with Expand
    return this.mode === 'live' || !!this.snapshot?.explores?.[id];
  }

  async exploreNode(id) {
    const n = this.store.nodes.get(id);
    if (!n) return;
    if (this.researching) {
      // one growth at a time: this node opens as soon as the current one finishes
      this._pendingExplore = id;
      this.showNotice(`Opening ${shortLabel(n.label)} next, when the current growth finishes.`, { seconds: 8 });
      return;
    }
    n.explored = 'running';
    const added = [];
    const before = new Set(this.store.nodes.keys());
    const onEvent = (ev) => {
      if (ev.type === 'node' && !before.has(ev.node.id) && !added.includes(ev.node.id)) {
        added.push(ev.node.id);
        ev.node.addedBy = id;
        ev.node.group = ev.group || ev.node.group;
        ev.node.hidden = added.length > 8; // about 8 new nodes per expansion; the rest wait for "show more"
      }
      this._onResearchEvent(ev);
    };
    if (this.mode === 'live') {
      const controller = new AbortController();
      this.expanding = { id, controller };
      await this.client.explore({ id: n.id, type: n.type, label: n.label, qid: n.qid }, {
        context: this.context.labels(),
        paperTypes: this.interests.data.paperTypes,
        signal: controller.signal,
        onEvent,
      });
      this.expanding = null;
    } else {
      const rec = await this._recorded(this.snapshot.explores[id]);
      for (const ev of rec?.events || []) onEvent(ev);
    }
    n.explored = true;
    n.addedIds = added;
    this.fillDossiers([id, ...added]);
    this.context.syncToStore(this.store);
    this.refreshInsights();
    this.setStatus('');
    this.view.markLabelsDirty();
    this.cards.get(`node:${id}`)?.redraw();
    this.onboarding.notify('explored');
  }

  async _recorded(file) {
    if (!file) return null;
    const res = await fetch(`demo/snapshot/${file}`).catch(() => null);
    return res?.ok ? res.json() : null;
  }

  /**
   * The closest few around a grown star stay in view: related news first (up
   * to two), then its direct claims and the people, places and organisations
   * it names. Everything else waits, grouped, behind the card's buttons.
   */
  _showClosest(id, added) {
    const direct = new Set(this.store.neighbors(id).map((x) => x.id));
    const degree = (x) => this.store.neighbors(x).length;
    const score = (n) => {
      if (n.type === 'NewsItem' && n.group === 'related') return 3;
      if (!direct.has(n.id)) return 0;
      if (n.type === 'Claim') return n.verdict === 'supported' ? 2.5 : 2;
      // a node that can open up further comes first among equals
      return (['PublicFigure', 'Place', 'Organisation', 'Event'].includes(n.type) ? 2.2 : 1.5) + (this.canExplore(n.id) ? 0.4 : 0);
    };
    const nodes = added.map((x) => this.store.nodes.get(x)).filter(Boolean);
    const news = nodes.filter((n) => score(n) === 3).slice(0, 2);
    const rest = nodes.filter((n) => score(n) < 3 && score(n) > 0).sort((a, b) => score(b) - score(a) || degree(b.id) - degree(a.id));
    const shown = new Set([...news, ...rest].slice(0, FIRST_NODES).map((n) => n.id));
    for (const n of nodes) n.hidden = !shown.has(n.id) && !n.sealed && !n.pinned;
    this.store._emit('node-updated', added);
  }

  /** Hidden nodes around a node, by kind: what its card can bring into view. */
  hiddenGroups(id) {
    const groups = new Map();
    for (const x of this.store.nodes.get(id)?.addedIds || []) {
      const n = this.store.nodes.get(x);
      if (!n?.hidden) continue;
      const g = groupOf(n);
      if (!groups.has(g.key)) groups.set(g.key, { ...g, ids: [] });
      groups.get(g.key).ids.push(x);
    }
    return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length);
  }

  showGroup(id, key) {
    const g = this.hiddenGroups(id).filter((x) => key === 'all' || x.key === key);
    const ids = g.flatMap((x) => x.ids);
    for (const x of ids) this.store.nodes.get(x).hidden = false;
    this.store._emit('node-added', ids);
    this.cards.get(`node:${id}`)?.redraw();
    return ids.length;
  }

  hiddenCount(id) {
    return (this.store.nodes.get(id)?.addedIds || []).filter((x) => this.store.nodes.get(x)?.hidden).length;
  }

  showMore(id) {
    const ids = (this.store.nodes.get(id)?.addedIds || []).filter((x) => this.store.nodes.get(x)?.hidden).slice(0, 8);
    for (const x of ids) this.store.nodes.get(x).hidden = false;
    this.store._emit('node-added', ids);
    this.cards.get(`node:${id}`)?.redraw();
    return ids.length;
  }

  back() {
    if (this.trail.length < 2) return null;
    this.trail.pop();
    const prev = this.trail.at(-1);
    this.view.setFocus(prev);
    this.pinchNode(prev, { fromTrail: true });
    return prev;
  }

  togglePin(id) {
    const n = this.store.nodes.get(id);
    if (!n) return;
    n.pinned = !n.pinned;
    this.view.markLabelsDirty();
    this.view._dirty = true;
    this.cards.get(`node:${id}`)?.redraw();
  }

  /** Fold an explored branch back into the fog (sealed and pinned nodes stay). */
  collapse(id) {
    const n = this.store.nodes.get(id);
    if (!n?.addedIds?.length) return 0;
    const remove = [];
    const walk = (nid) => {
      for (const x of this.store.nodes.get(nid)?.addedIds || []) {
        const c = this.store.nodes.get(x);
        if (!c || c.sealed || c.pinned || this.lights.get(x)?.expanded) continue;
        walk(x);
        remove.push(x);
      }
    };
    walk(id);
    removeNodesFromStore(this.store, remove);
    n.addedIds = [];
    n.explored = false;
    const it = this.lights.get(id);
    if (it?.expanded === true) it.expanded = false; // a star can grow again
    this.cards.get(`node:${id}`)?.redraw();
    return remove.length;
  }

  /**
   * Real information about the nodes in the web (what it is, key facts with
   * sources): fetched in one batch, cached; the Demo scene reads it from the
   * snapshot. Nodes that already have one are skipped.
   */
  async fillDossiers(ids = null) {
    const TYPES = ['Place', 'Organisation', 'PublicFigure', 'Topic', 'Technology', 'Event', 'Concept'];
    const all = (ids ? ids.map((x) => this.store.nodes.get(x)) : [...this.store.nodes.values()]).filter((n) => n && TYPES.includes(n.type) && !n.dossier && !n.dossierLoading);
    // an effect named by the analysis is not a thing with an encyclopedia entry: its link explains it
    for (const n of all.filter((x) => x.derived)) n.dossier = { kind: 'effect', found: false };
    const want = all.filter((n) => !n.derived);
    if (!want.length) return 0;
    for (const n of want) n.dossierLoading = true;
    let got = {};
    if (this.mode === 'live') {
      for (let i = 0; i < want.length; i += 30) {
        // the story's places tell same-named bodies apart ("Ministry of Foreign Affairs" of which country?)
        const places = [...this.store.nodes.values()].filter((x) => ['Place', 'Organisation', 'Event'].includes(x.type) && !x.derived).map((x) => x.label).slice(0, 20);
        const res = await this.client.dossiers(want.slice(i, i + 30).map((n) => ({ id: n.id, type: n.type, label: n.label, qid: n.qid })), places);
        Object.assign(got, res?.dossiers || {});
      }
    } else {
      got = this.snapshot?.dossiers || {};
    }
    let filled = 0;
    for (const n of want) {
      n.dossierLoading = false;
      let d = got[n.id];
      // the story's own event: what the reporting says about it
      if ((!d || !d.found) && n.type === 'Event') d = this._eventDossier(n) || d;
      if (!d) continue;
      n.dossier = d;
      if (!n.definition && d.overview) {
        n.definition = d.overview;
        n.definitionUrl = d.overviewSource?.url || '';
        n.definitionLicence = d.overviewSource?.licence || '';
      }
      if (!n.qid && d.qid) n.qid = d.qid;
      filled++;
    }
    for (const e of this.cards.open) if (e.key.startsWith('node:')) e.card.redraw();
    return filled;
  }

  /** An event without its own encyclopedia entry, described by the news that reports it. */
  _eventDossier(ev) {
    const news = [...this.store.edges.values()].filter((e) => e.to === ev.id && e.type === 'about').map((e) => this.store.nodes.get(e.from)).filter((x) => x?.type === 'NewsItem');
    if (!news.length) return null;
    const item = this.getItem(news[0].id) || news[0];
    const claims = [...this.store.edges.values()].filter((e) => e.type === 'reports' && news.some((x) => x.id === e.from)).map((e) => this.store.nodes.get(e.to)).filter((c) => c?.type === 'Claim');
    const outlet = item.source || news[0].outlet || 'the report';
    return {
      kind: 'event',
      found: true,
      overview: item.summary || news[0].summary || news[0].label,
      overviewSource: { url: item.url || news[0].url, licence: `as reported by ${outlet}` },
      facts: claims.slice(0, 4).map((c) => ({ label: outlet, value: c.label, date: String(item.date || '').slice(0, 10), quote: c.quote || '', url: item.url || news[0].url, kind: 'news' })),
    };
  }

  pinchNode(id, { fromTrail = false } = {}) {
    const node = this.store.nodes.get(id);
    if (node && !node.dossier && !node.dossierLoading) this.fillDossiers([id]); // fast first answer for this one
    if (!this.store.nodes.has(id)) return;
    if (!fromTrail) this.focusNode(id);
    if (this.selectedId !== id) this.prevSelectedId = this.selectedId;
    this.selectedId = id;
    this.view.setSelected(id);
    this.view.markLabelsDirty();
    const prefer = this.view.worldPositionOf(id);
    for (const e of [...this.cards.open]) if (e.key.startsWith('node:') && e.key !== `node:${id}`) this.cards.close(e.key);
    const tall = ['Place', 'Organisation', 'PublicFigure', 'Topic', 'Technology', 'Event', 'Concept'].includes(this.store.nodes.get(id)?.type);
    this.cards.show(`node:${id}`, { width: 0.46, height: tall ? 0.56 : 0.5, draw: nodeCardDraw(this, id), prefer });
    this.onboarding.notify('card-opened');
  }

  closeCard(key) {
    this.cards.close(key);
  }

  /**
   * Close on a star's news card: its web leaves the fog and it is a star again
   * (touch it to grow it again). Sealed and pinned items stay.
   */
  closeStar(id) {
    if (this.expanding?.id === id) this.stopResearch();
    else if (this.player && !this.player.done && this.getItem(id)?.expanded === 'running') this.stopResearch();
    const before = new Set(this.store.nodes.keys());
    this.collapse(id);
    const n = this.store.nodes.get(id);
    if (n && !n.sealed && !n.pinned && !this.store.neighbors(id).length) removeNodesFromStore(this.store, [id]);
    const gone = [...before].filter((x) => !this.store.nodes.has(x));
    for (const x of gone) this.closeCard(`node:${x}`);
    this.trail = this.trail.filter((x) => this.store.nodes.has(x));
    const it = this.lights.get(id);
    if (it && it.expanded) it.expanded = false;
    this.closeCard(`light:${id}`);
    this.view.markLabelsDirty();
    this._renderStatus();
    return gone.length;
  }

  _onCardClosed(key) {
    if (key.startsWith('node:') && this.selectedId === key.slice(5)) {
      this.selectedId = null;
      this.view.setSelected(null);
    }
    if (key === 'path') this.view.clearPath();
    if (key.startsWith('light:') && this.lights.openId === key.slice(6)) this.lights.openId = null;
  }

  _refreshCards() {
    for (const e of this.cards.open) e.card.redraw();
    this.view.markLabelsDirty();
  }

  // ---------- lights + reader card ----------

  openLight(id) {
    const it = this.lights.get(id);
    if (!it) return;
    for (const e of [...this.cards.open]) if (e.key.startsWith('light:') && e.key !== `light:${id}`) this.cards.close(e.key);
    this.lights.openId = id;
    const size = this.readerDetails?.has(id) ? READER_SIZE.details : READER_SIZE.compact;
    this.cards.show(`light:${id}`, { ...size, draw: readerDraw(this, id), prefer: this.lights.worldPositionOf(id) });
    this.onboarding.notify('light-opened');
    if (it.live && !it.claims?.length && !it.claimsLoading && this.mode === 'live') this._loadClaims(it);
    // touching a light also grows it into the web (one at a time)
    if (settings.feed.autoExpand && !it.expanded && this.canExpand(id)) {
      if (!this.researching) this.expandLight(id);
      else this._pendingExpand = id; // grows when the current growth finishes
    }
  }

  /** Reader card: compact (default) or with claims, quotes and the link. */
  toggleReaderDetails(id) {
    this.readerDetails ??= new Set();
    if (this.readerDetails.has(id)) this.readerDetails.delete(id);
    else this.readerDetails.add(id);
    const size = this.readerDetails.has(id) ? READER_SIZE.details : READER_SIZE.compact;
    this.cards.resize(`light:${id}`, size.width, size.height);
  }

  async _loadClaims(it) {
    it.claimsLoading = true;
    this.cards.get(`light:${it.id}`)?.redraw();
    const r = await this.client.read(it.id);
    it.claimsLoading = false;
    if (r?.claims) it.claims = r.claims;
    it.claimsNote = r?.note || (r ? '' : 'Could not load key claims right now.');
    this.cards.get(`light:${it.id}`)?.redraw();
  }

  /** A light, or a news node found while exploring (it can be expanded too). */
  getItem(id) {
    const light = this.lights.get(id);
    if (light) return light;
    const n = this.store.nodes.get(id);
    if (n?.type !== 'NewsItem') return null;
    this.extraItems ??= new Map();
    if (!this.extraItems.has(id)) {
      this.extraItems.set(id, { id, kind: n.kind || 'breaking', sourceType: n.sourceType, headline: n.label, source: n.outlet, url: n.url, date: n.date, summary: n.summary || '', live: this.mode === 'live', claims: [] });
    }
    return this.extraItems.get(id);
  }

  canExpand(id) {
    const it = this.getItem(id);
    if (!it) return false;
    if (it.live && this.mode === 'live') return true;
    return !!this.snapshot?.expansions?.[id];
  }

  async expandLight(id) {
    const it = this.getItem(id);
    if (!it || this.researching || it.expanded) return;
    it.expanded = 'running';
    this.notes = [];
    this.cards.get(`light:${id}`)?.redraw();
    // about 5 nodes first (the closest), the rest wait behind group buttons on the card
    const before = new Set(this.store.nodes.keys());
    const added = [];
    const mark = (ev) => {
      if (ev.type === 'node' && ev.node.id !== id && !before.has(ev.node.id) && !added.includes(ev.node.id)) {
        added.push(ev.node.id);
        ev.node.hidden = added.length > FIRST_NODES;
      }
    };
    if (it.live && this.mode === 'live') {
      const controller = new AbortController();
      this.expanding = { id, controller };
      this.setStatus(`Reading ${it.source}`);
      const stats = await this.client.expand(id, {
        context: this.context.labels(),
        signal: controller.signal,
        onEvent: (ev) => {
          mark(ev);
          this._onResearchEvent(ev);
        },
      });
      this.expanding = null;
      this.lastStats = stats;
      if (!stats) this.notes.unshift('The research stream stopped early; what arrived stays.');
    } else if (this.snapshot?.expansions?.[id]) {
      const res = await fetch(`demo/snapshot/${this.snapshot.expansions[id]}`).catch(() => null);
      const rec = res?.ok ? await res.json() : null;
      if (!rec) {
        it.expanded = false;
        this.setStatus('That recorded run is missing from the snapshot.');
        return;
      }
      for (const ev of rec.events || []) mark(ev);
      this._recordedAnswers ??= {};
      if (rec.answers) this._recordedAnswers[id] = rec.answers;
      await new Promise((resolve) => {
        this.player = new EventPlayer(this.store, rec.events, {
          durationMs: 9000,
          onStatus: (s) => this.setStatus(`${s} (recorded ${String(rec.recordedAt || '').slice(0, 10)})`),
          onNote: (n) => this.notes.unshift(n.text),
          onStats: (s) => (this.lastStats = s),
          onDone: resolve,
        });
        this._renderStatus();
      });
    }
    it.expanded = true;
    if (this.store.nodes.has(id)) {
      this.store.nodes.get(id).addedIds = added;
      this._showClosest(id, added);
    }
    this.fillDossiers(); // every node around it: what it is, key facts, sources
    if (this.store.nodes.has(id)) this.focusNode(id, { explore: false });
    this.context.syncToStore(this.store);
    this._applyRelevance();
    this.refreshInsights();
    this.setStatus('');
    this._refreshCards();
    this.onboarding.notify('expanded');
  }

  _onResearchEvent(ev) {
    const phrase = applyEvent(this.store, ev);
    if (ev.type === 'note' && ev.text) this.notes.unshift(ev.text);
    if (ev.type === 'status' && phrase) this.setStatus(phrase);
    if (ev.type === 'verified') for (const e of this.cards.open) if (e.key === `node:${ev.id}`) e.card.redraw();
  }

  stopResearch() {
    if (this.expanding) {
      this.expanding.controller.abort();
      this.setStatus('Stopped. What grew so far stays.');
    } else if (this.player && !this.player.done) {
      this.player.stop();
      this.player.onDone?.();
      this.setStatus('Stopped. What grew so far stays.');
    }
  }

  sealLight(id) {
    const it = this.getItem(id);
    if (!it) return;
    const { claims, live, claimsLoading, glow, ...rest } = it;
    this.sealedLights[id] = { ...rest, claims: (claims || []).slice(0, 3), sealedAt: new Date().toISOString() };
    this.lights.sealed.add(id);
    writeJSON(SEALED_LIGHTS_KEY, this.sealedLights);
    if (this.store.nodes.has(id)) this.seal(id);
    this.cards.get(`light:${id}`)?.redraw();
    this.onboarding.notify('sealed');
  }

  unsealLight(id) {
    delete this.sealedLights[id];
    this.lights.sealed.delete(id);
    writeJSON(SEALED_LIGHTS_KEY, this.sealedLights);
    if (this.store.nodes.get(id)?.sealed) this.unseal(id);
    this.cards.get(`light:${id}`)?.redraw();
  }

  // ---------- seal / unseal (the Library persists; the fog does not) ----------

  seal(id) {
    const changed = this.store.seal(id);
    this._saveLibrary();
    for (const c of changed) this.view.flash(c, 1.2);
    this._refreshCards();
    this.onboarding.notify('sealed');
    return changed;
  }

  unseal(id) {
    const changed = this.store.unseal(id);
    this._saveLibrary();
    this._refreshCards();
    return changed;
  }

  _saveLibrary() {
    const doc = this.store.toDocument(); // private context already filtered out
    writeJSON(LIBRARY_KEY, {
      savedAt: new Date().toISOString(),
      nodes: doc.nodes.filter((n) => n.sealed),
      edges: doc.edges.filter((e) => e.sealed),
    });
  }

  _restoreLibrary() {
    const lib = readJSON(LIBRARY_KEY, null);
    if (!lib) return;
    for (const n of lib.nodes || []) this.store.addNode({ ...n, sealed: true }, { silent: true });
    for (const e of lib.edges || []) this.store.addEdge({ ...e, sealed: true }, { silent: true });
    this.store._emit('loaded');
  }

  // ---------- link / path / "how does this touch me" ----------

  link(id) {
    if (!this.linkFromId || this.linkFromId === id) {
      this.linkFromId = this.linkFromId === id ? null : id;
      this.view.linkFromId = this.linkFromId;
      this.setStatus(this.linkFromId ? 'Pinch another node, then press Path here' : '');
      this._refreshCards();
      return;
    }
    const from = this.linkFromId;
    this.linkFromId = null;
    this.view.linkFromId = null;
    this.findPath(from, id);
  }

  pathFromProps() {
    const a = this.linkFromId || this.prevSelectedId;
    const b = this.selectedId;
    if (a && b && a !== b) return this.findPath(a, b);
    this.cards.show('path', {
      width: 0.42,
      height: 0.22,
      draw: messageDraw(this, 'path', 'Path between two nodes', 'Pinch one node, then another, then hold both props (or press Link on each card).'),
    });
  }

  findPath(a, b) {
    let layer = settings.layers.includeFog ? 'all' : 'sealed';
    let path = shortestPath(this.store.view(layer), a, b);
    let note = layer === 'sealed' ? 'Through your sealed web.' : 'Through the whole web (fog included).';
    if (!path && layer === 'sealed') {
      path = shortestPath(this.store.view('all'), a, b);
      note = 'No path in your sealed web yet. Shown through the fog instead.';
      layer = 'all';
    }
    if (!path) {
      this.view.clearPath();
      const la = this.store.nodes.get(a)?.label;
      const lb = this.store.nodes.get(b)?.label;
      this.cards.show('path', { width: 0.42, height: 0.24, draw: messageDraw(this, 'path', 'No connection found', `“${la}” and “${lb}” are not connected by reported or inferred links.`) });
      return null;
    }
    this._showPath(path, `Path: ${path.edges.length} step${path.edges.length === 1 ? '' : 's'}`, note);
    return path;
  }

  /** Grounded path from a news item to the reader's context, or an honest "no". */
  touchesMe(id) {
    const ctx = this.context.ids().filter((c) => this.store.nodes.has(c));
    if (!ctx.length) {
      this.cards.show('path', {
        width: 0.42,
        height: 0.26,
        draw: messageDraw(this, 'path', 'Add your context first', 'Add a few coarse things (city, field, tools you use) so FogWeave can look for a connection.', [
          { id: 'ctx', label: 'My context', onPress: () => this.openContext(), primary: true },
        ]),
      });
      return null;
    }
    const path = bestPath(this.store.view('all'), id, ctx);
    if (!path) {
      this.view.clearPath();
      this.cards.show('path', { width: 0.42, height: 0.24, draw: messageDraw(this, 'path', 'No clear connection found', 'Nothing reported or inferred links this to your context. FogWeave does not guess one.') });
      this.lastTouch = null;
      return null;
    }
    this.lastTouch = path;
    this._showPath(path, 'How this may touch you', 'Possible effects, not predictions. Check the sources.');
    return path;
  }

  _showPath(path, title, note) {
    this.view.showPath(path);
    for (const id of path.nodes) this.view.flash(id, 2);
    this.cards.show('path', { width: 0.46, height: 0.4, draw: pathDraw(this, path, title, note) });
    this.setStatus('');
    this._refreshCards();
  }

  // ---------- props ----------

  reveal(kind, { via, worldPos }) {
    const seeds = this.context.ids().filter((c) => this.store.nodes.has(c));
    let id = worldPos ? this.view.nearestNode(worldPos, settings.props.lockRadius) : this.selectedId;
    const openAir = !id;
    if (openAir) {
      const top = mostImportant(this.store.view(this._layerFor(null)), { seeds, exclude: (n) => n.type === 'ContextNode' });
      if (!top) {
        this.cards.show('reveal', { width: 0.4, height: 0.22, draw: messageDraw(this, 'reveal', 'Nothing to read yet', 'Touch a light and press Expand first.') });
        return null;
      }
      id = top.id;
    }
    this.view.flash(id, settings.props.revealSeconds);
    const prefer = this.view.worldPositionOf(id);
    let result;
    if (kind === 'locket' || (kind === 'coin' && openAir)) {
      const layer = this._layerFor(id);
      result = importanceOf(this.store.view(layer), id, { seeds });
      const scope = `${layer === 'sealed' ? 'in your sealed web' : 'in the whole web'}${seeds.length ? ' · for you' : ''}`;
      this.cards.show('reveal', { width: 0.4, height: 0.3, draw: locketDraw(this, id, result, openAir ? `${scope} · most relevant` : scope), prefer });
    } else {
      result = evidenceReadout(this.store, id);
      this.cards.show('reveal', { width: 0.4, height: 0.32, draw: coinDraw(this, id, result), prefer });
    }
    this.onboarding.notify(kind);
    this.lastReveal = { kind, id, via, openAir, result };
    return this.lastReveal;
  }

  /** Sealed layer by default; whole web when fog is included or nothing usable is sealed. */
  _layerFor(id) {
    if (settings.layers.includeFog) return 'all';
    const sealed = this.store.view('sealed');
    if (sealed.nodes.length < 2) return 'all';
    if (id && !this.store.nodes.get(id)?.sealed) return 'all';
    return 'sealed';
  }

  // ---------- keypad: find a light, or add context ----------

  openKeypad(mode = 'find') {
    this.keypadMode = mode;
    if (this.keypad.isOpen) this.keypad.close();
    const mic = settings.voice.enabled && this.voiceAvailable() ? () => this.voiceInto() : null;
    if (mode === 'context') {
      const have = new Set(this.context.labels().map((l) => l.toLowerCase()));
      const sugg = SAMPLE_PERSONA.map((p) => p.label).filter((l) => !have.has(l.toLowerCase()));
      this.keypad.open({ prompt: 'Add to your context (coarse, no personal details)', suggestions: sugg, mic });
    } else if (mode === 'ask') {
      this.keypad.open({ prompt: 'Ask about this', suggestions: ASK_SUGGESTIONS, mic });
    } else if (mode === 'note') {
      this.keypad.open({ prompt: 'Add a note', suggestions: [], mic });
    } else if (mode === 'interest') {
      this.keypad.open({ prompt: 'Add a topic you are interested in', suggestions: ['electric vehicles', 'quantum computing', 'public health', 'renewable energy'], mic });
    } else {
      // Ask the fog: any topic, any past news (also finds a star drifting here)
      this.keypadMode = 'fog';
      const sugg = [...this.lights.items].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 2).map((it) => shortHeadline(it.headline));
      this.keypad.open({ prompt: 'Ask the fog: any topic or past news', suggestions: [...sugg, 'What happened this week in science?', 'What changed in climate policy this year?'], mic });
    }
  }

  /** Optional voice: fills the keypad; the reader confirms with Go (or edits). */
  async voiceInto() {
    if (!this.keypad.isOpen) return;
    const prompt = this.keypad.prompt;
    this.keypad.prompt = 'Listening…';
    this.keypad.card?.redraw();
    const { listenOnce } = await import('./voice-input.js'); // loaded only when voice is used
    const heard = await listenOnce({ timeoutMs: 7000 });
    this.keypad.prompt = heard ? `I heard: "${heard}". Go to confirm, or edit` : `${prompt} (didn't catch that)`;
    if (heard) this.keypad.text = heard.slice(0, 80);
    this.keypad.card?.redraw();
  }

  async _onKeypadSubmit(text) {
    if (this.keypadMode === 'context') return this.addContext(text);
    if (this.keypadMode === 'ask') return this.ask(text);
    if (this.keypadMode === 'note') return this.addNote(text);
    if (this.keypadMode === 'interest') {
      if (this.interests.addTopic(text, 1.5)) await this.interestsChanged();
      return null;
    }
    return this.askFog(text);
  }

  /**
   * Ask the fog (touch empty fog): a star drifting here that matches opens;
   * anything else gets a cited answer from fresh search. Refusals first.
   */
  async askFog(text) {
    const q = String(text || '').trim();
    if (!q) return null;
    const refusal = checkRequest(q);
    if (refusal) {
      const a = { question: q, refused: true, answerable: false, text: refusal, sentences: [], citations: {} };
      this.lastAnswer = a;
      this.cards.show('answer', { width: 0.48, height: 0.3, draw: answerDraw(this, a), slot: 2 });
      return a;
    }
    // a cited answer, news about it arriving as stars in front of you, and
    // drifting stars that already name it come closer
    const needle = q.toLowerCase();
    const near = this.lights.items.filter((it) => `${it.headline} ${it.summary || ''}`.toLowerCase().includes(needle)).map((it) => it.id);
    if (near.length) this.lights.pull(near, 30);
    const [a] = await Promise.all([this.ask(q, null), this.searchStars(q)]);
    return a;
  }

  /**
   * Ask the fog, as stars: news about the topic (recent and older) gathers in
   * front of the reader as one Search group. Seal keeps one; Clear removes the
   * rest. Live: from the engine's search. Demo: from the recorded pool.
   */
  async searchStars(q) {
    let items = [];
    if (this.mode === 'live') {
      const res = await this.client.search(q);
      items = (res?.items || []).map((it) => ({ ...it, live: true }));
    } else if (this.mode === 'offline') {
      const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const shown = new Set(this.lights.items.map((x) => x.id));
      items = this.pool.filter((it) => !shown.has(it.id) && words.length && words.every((w) => `${it.headline} ${it.summary || ''}`.toLowerCase().includes(w))).slice(0, 5);
    }
    if (!items.length) {
      this.searchGroup = { q, ids: [] };
      this.cards.get('answer')?.redraw();
      return [];
    }
    this.clearSearch(); // one Search group at a time
    const ids = this.lights.addItems(items.map((it) => ({ ...it, search: q })));
    this.searchGroup = { q, ids };
    this._applyRelevance();
    this.showNotice(`${ids.length} star${ids.length === 1 ? '' : 's'} about “${shortLabel(q)}” came in front of you.`, { seconds: 10 });
    this.cards.get('answer')?.redraw();
    return ids;
  }

  /** The Search group leaves the fog; sealed, grown or open stars stay. */
  clearSearch() {
    const g = this.searchGroup;
    this.searchGroup = null;
    if (!g?.ids?.length) return 0;
    const keep = (id) => this.lights.sealed.has(id) || this.getItem(id)?.expanded || this.lights.openId === id;
    const drop = g.ids.filter((id) => !keep(id));
    for (const id of drop) this.closeCard(`light:${id}`);
    this.lights.removeItems(drop);
    for (const id of g.ids) if (keep(id)) delete this.lights.get(id)?.search;
    this.cards.get('answer')?.redraw();
    return drop.length;
  }

  findLight(text, { quiet = false, min = 0.3 } = {}) {
    const needle = text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const it of this.lights.items) {
      const hay = `${it.headline} ${it.summary || ''}`.toLowerCase();
      const s = hay.includes(needle) ? 1 : Math.max(similarity(needle, it.headline.toLowerCase()), similarity(needle, hay));
      if (s > bestScore) {
        bestScore = s;
        best = it;
      }
    }
    if (best && bestScore >= min) {
      this.openLight(best.id);
      return best.id;
    }
    if (quiet) return null;
    this.cards.show('find', { width: 0.42, height: 0.24, draw: messageDraw(this, 'find', 'No light matches', `Nothing drifting here matches “${text}”. Asking about any topic comes with Ask.`) });
    return null;
  }

  addContext(label, kind = 'interest') {
    const r = this.context.add(label, kind);
    if (!r.ok) {
      this.cards.show('context-error', { width: 0.4, height: 0.22, draw: messageDraw(this, 'context-error', 'Not added', r.problem) });
      return r;
    }
    this.context.syncToStore(this.store);
    this._applyRelevance();
    this.cards.get('context')?.redraw();
    this.onboarding.notify('context');
    return r;
  }

  removeContext(id) {
    this.context.remove(id);
    this.context.syncToStore(this.store);
    this._applyRelevance();
    this.cards.get('context')?.redraw();
  }

  useSamplePersona() {
    this.context.useSamplePersona();
    this.context.syncToStore(this.store);
    this._applyRelevance();
    this.cards.get('context')?.redraw();
    this.onboarding.notify('context');
  }

  clearContext() {
    this.context.clear();
    this.context.syncToStore(this.store);
    this._applyRelevance();
    this.cards.get('context')?.redraw();
  }

  _onStoreChange(ev) {
    if (ev.kind === 'sealed' || ev.kind === 'unsealed' || ev.kind === 'node-updated') {
      for (const e of this.cards.open) if (e.key.startsWith('node:') || e.key === 'library') e.card.redraw();
    }
  }

  // ---------- empty-space pinch & flick ----------

  onEmptyPinch() {
    if (this.keypad.isOpen) return;
    this.openKeypad('find');
  }

  /** Flick-to-dismiss: close the card whose mesh the flicking hand's ray was on. */
  dismissCardByObject(object) {
    const entry = this.cards.open.find((e) => e.card.mesh === object);
    if (entry) {
      this.closeCard(entry.key);
      return entry.key;
    }
    if (this.keypad.card?.mesh === object) {
      this.keypad.close();
      return 'keypad';
    }
    return null;
  }

  // ---------- frame ----------

  /** Head pose: the tracked head in XR, the page camera otherwise. */
  headPose(outPos, outQuat) {
    const head = this.world.session ? this.sys.player.head : this.world.camera;
    head.getWorldPosition(outPos);
    head.getWorldQuaternion(outQuat);
  }

  update(delta) {
    if (!this._gestureSeen && (this.world.session || this.keypad.isOpen)) this.userGesture();
    this.headPose(_hp, _hq);
    const now = performance.now();
    this.player?.update(delta * 1000);
    this.view.update(delta, _hp, _hq);
    if (Math.abs((this._placedRadius ?? 0) - this.view.radius) > 0.005) {
      this._placedRadius = this.view.radius;
      this.view.root.position.copy(this._bubbleCenter());
    }
    this._handPoints ??= [new Vector3(), new Vector3()];
    const tips = this.world.session ? ['left', 'right'].map((s, i) => this.sys.player.indexTipSpaces?.[s]?.getWorldPosition(this._handPoints[i])).filter(Boolean) : [];
    this.lights.setHands(tips);
    // flat page (no headset): fit the light arc into the window's view
    const cam = this.world.camera;
    if (!this.world.session && cam?.isPerspectiveCamera) {
      const halfV = (cam.fov * Math.PI) / 360;
      const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
      this.lights.fit = { k: (halfH * 0.86) / YAW_MAX, e0: halfV * 0.3, e1: halfV * 0.82 };
    } else this.lights.fit = null;
    this.lights.update(delta, _hq);
    this.cards.update(delta);
    this.atmosphere.update(delta);
    this.props.update(delta, now);
    this._followWrist();
    this._slowRefresh(now);
    this.governor.sample(delta);
    if (this._wasResearching !== this.researching) {
      this._wasResearching = this.researching;
      this._renderStatus();
      if (!this.researching && this._pendingExpand) {
        const next = this._pendingExpand;
        this._pendingExpand = null;
        if (!this.getItem(next)?.expanded) this.expandLight(next);
      } else if (!this.researching && this._pendingExplore) {
        const next = this._pendingExplore;
        this._pendingExplore = null;
        const n = this.store.nodes.get(next);
        if (n && !n.explored) this.exploreNode(next);
      }
    }
  }

  _followWrist() {
    const grip = this.sys.player.gripSpaces?.left;
    const o = this.helpButton.object3D;
    if (this.world.session && grip) {
      grip.getWorldPosition(o.position);
      o.position.y += 0.09;
      o.lookAt(_hp);
    } else {
      const { head, yaw } = this.anchor;
      o.position.set(head.x + Math.sin(yaw - 0.5) * 0.6, head.y - 0.3, head.z - Math.cos(yaw - 0.5) * 0.6);
      o.lookAt(head);
    }
  }
}

/** Personalized PageRank over the web, seeded at the reader's context. */
function importanceSeeds(app) {
  const seeds = app.context.ids().filter((c) => app.store.nodes.has(c));
  if (!seeds.length) return null;
  const pr = pagerank(app.store.view('all'), { seeds });
  return new Map([...pr].filter(([id]) => app.store.nodes.get(id)?.type === 'NewsItem'));
}

/** 20-40 s until the next new star appears. */
const FIRST_NODES = 5; // nodes shown when a star grows; the rest wait in groups

const GROUPS = { NewsItem: ['news', 'News'], PublicFigure: ['people', 'People'], Place: ['places', 'Places'], Organisation: ['orgs', 'Organisations'], Claim: ['claims', 'Claims'], Source: ['claims', 'Claims'] };

function groupOf(n) {
  const [key, label] = GROUPS[n.type] || ['topics', 'Topics'];
  return { key, label };
}

function nextStarDelay() {
  return 20000 + Math.random() * 20000;
}

const _rp = new Vector3();

function shortLabel(s, n = 22) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function shortHeadline(h) {
  const words = h.split(/\s+/).slice(0, 5).join(' ');
  return words.length < h.length ? words : h;
}

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; the session still works
  }
}

export { CONTEXT_KINDS };
