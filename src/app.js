/**
 * App: glue between the news web (GraphStore), its view, the lights, the
 * cards, the keypad, the props, the reader's private context and the
 * research engine. All user actions come in here, so the hand path, the
 * desktop path and scripted QA share one code path.
 *
 * Live when the backend answers; otherwise the bundled, dated snapshot of
 * real pipeline runs (take-it-away test), and the status line says which.
 */
import { Vector3, Quaternion, Hovered } from '@iwsdk/core';
import { GraphStore, similarity } from './model/graph.js';
import { shortestPath, importanceOf, mostImportant, evidenceReadout, bestPath, pagerank } from './model/algorithms.js';
import { GraphView } from './render/graph-view.js';
import { Atmosphere } from './render/atmosphere.js';
import { Card } from './render/card.js';
import { CardManager } from './ui/card-manager.js';
import { nodeCardDraw, locketDraw, coinDraw, messageDraw, pathDraw } from './ui/node-card.js';
import { helpDraw, libraryDraw } from './ui/help.js';
import { contextDraw } from './ui/context-card.js';
import { Keypad } from './ui/keypad.js';
import { Onboarding } from './ui/onboarding.js';
import { Props } from './props.js';
import { LightField } from './render/lights.js';
import { readerDraw } from './ui/reader-card.js';
import { EventPlayer, applyEvent } from './research/events.js';
import { ResearchClient } from './research/client.js';
import { ContextStore, SAMPLE_PERSONA, CONTEXT_KINDS } from './context.js';
import { settings, loadSettings, setQuality } from './config.js';
import { QualityGovernor } from './quality.js';

const LIBRARY_KEY = 'fogweave.library.v1';
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
    this.linkFromId = null;
    this.player = null; // replay of a recorded run
    this.expanding = null; // { id, controller } live run
    this.statusText = '';
    this.notes = [];
    this.lastStats = null;
    this._buildStatusCard();
    this._buildHelpButton();
    this._wireNodePicking();
    this.store.on((ev) => this._onStoreChange(ev));
    this._restoreLibrary();
    this.context.syncToStore(this.store);
    this.ready = this._start();
  }

  // ---------- startup: live or snapshot ----------

  async _start() {
    const [health, snap] = await Promise.all([this.client.health(), this._loadSnapshot()]);
    this.snapshot = snap;
    let lights = null;
    if (health?.ok) {
      this.setStatus('Gathering the latest news…');
      lights = await this.client.lights(this.context.labels());
    }
    if (lights?.items?.length) {
      this.mode = 'live';
      const ok = Object.values(lights.sources || {}).filter((s) => s.ok).length;
      const all = Object.keys(lights.sources || {}).length;
      this.lightsMeta = { kind: 'live', generatedAt: lights.generatedAt, sources: `${ok} of ${all} feeds` };
      this.notes = lights.notes || [];
      this.lights.setItems(lights.items.map((it) => ({ ...it, live: true })));
    } else if (snap) {
      this.mode = 'offline';
      this.lightsMeta = { kind: snap.provenance?.kind, generatedAt: snap.generatedAt };
      this.lights.setItems(snap.lights || []);
    } else {
      this.mode = 'offline';
      this.lightsMeta = { kind: 'none' };
    }
    this._applyRelevance();
    this.setStatus('');
    if (Onboarding.needed()) this.startOnboarding();
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
    return new Vector3(head.x + Math.sin(yaw) * b.forward, head.y - b.down, head.z - Math.cos(yaw) * b.forward);
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
    return new Vector3(head.x + Math.sin(yaw) * 0.75, head.y - 0.36, head.z - Math.cos(yaw) * 0.75);
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
    if (m.kind === 'pipeline') return `Offline · snapshot of ${String(m.generatedAt || '').slice(0, 10)}`;
    if (m.kind === 'fixture') return 'Offline · test fixture';
    return this.mode === 'starting' ? 'Starting…' : 'Offline';
  }

  _renderStatus() {
    const running = this.researching;
    this.statusCard.setContent((ctx, ui, w, h) => {
      const pad = 34;
      const label = running ? `Fog is looking · ${this.statusText}` : this.statusText || this.notes[0] || this.modeLine();
      if (running) ui.ringIcon(pad + 14, h / 2 - 2, 14, '#d9dee6', this.player?.paused ? 'dotted' : 'dashed');
      ui.text(label, pad + (running ? 44 : 0), h / 2 + 11, { size: 30, maxWidth: w - pad * 2 - (running ? 230 : 0) });
      if (running) ui.button('stop', 'Stop', w - pad - 180, 14, 180, h - 28, () => this.stopResearch(), { size: 26 });
    });
  }

  // ---------- help button on the left wrist ----------

  _buildHelpButton() {
    // ray only: a poke target this close to its own hand's fingertip would always be hovered
    this.helpButton = new Card(this.world, { width: 0.06, height: 0.06, name: 'help-button' });
    this.helpButton.setContent((ctx, ui, w, h) => {
      ui.button('help', '?', 6, 6, w - 12, h - 12, () => this.toggleHelp(), { size: 80 });
    });
  }

  toggleHelp() {
    if (this.cards.get('help')) this.closeCard('help');
    else this.cards.show('help', { width: 0.44, height: 0.46, draw: helpDraw(this), slot: 1 });
  }

  openLibrary() {
    this.closeCard('help');
    this.cards.show('library', { width: 0.44, height: 0.38, draw: libraryDraw(this), slot: 1 });
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
    hit.addEventListener('click', (e) => {
      const id = this.view.nodeIdFromHit(e.instanceId);
      if (id) this.pinchNode(id);
    });
    hit.addEventListener('pointermove', (e) => this.view.setHovered(this.view.nodeIdFromHit(e.instanceId)));
    hit.addEventListener('pointerleave', () => this.view.setHovered(null));
  }

  /** True while any of our interactive things is under a pointer. */
  anythingHovered() {
    const entities = [this.view.hitEntity, this.lights.hitEntity, this.statusCard.entity, this.helpButton.entity, ...this.props.items.map((p) => p.entity)];
    for (const e of this.cards.open) entities.push(e.card.entity);
    if (this.keypad.card) entities.push(this.keypad.card.entity);
    return entities.some((e) => e?.hasComponent?.(Hovered));
  }

  pinchNode(id) {
    if (!this.store.nodes.has(id)) return;
    if (this.selectedId !== id) this.prevSelectedId = this.selectedId;
    this.selectedId = id;
    this.view.setSelected(id);
    this.view.markLabelsDirty();
    const prefer = this.view.worldPositionOf(id);
    for (const e of [...this.cards.open]) if (e.key.startsWith('node:') && e.key !== `node:${id}`) this.cards.close(e.key);
    this.cards.show(`node:${id}`, { width: 0.44, height: 0.4, draw: nodeCardDraw(this, id), prefer });
    this.onboarding.notify('card-opened');
  }

  closeCard(key) {
    this.cards.close(key);
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
    this.cards.show(`light:${id}`, { width: 0.46, height: 0.48, draw: readerDraw(this, id), prefer: this.lights.worldPositionOf(id) });
    this.onboarding.notify('light-opened');
    if (it.live && !it.claims?.length && !it.claimsLoading && this.mode === 'live') this._loadClaims(it);
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

  canExpand(id) {
    const it = this.lights.get(id);
    if (!it) return false;
    if (it.live && this.mode === 'live') return true;
    return !!this.snapshot?.expansions?.[id];
  }

  async expandLight(id) {
    const it = this.lights.get(id);
    if (!it || this.researching || it.expanded) return;
    it.expanded = 'running';
    this.notes = [];
    this.cards.get(`light:${id}`)?.redraw();
    if (it.live && this.mode === 'live') {
      const controller = new AbortController();
      this.expanding = { id, controller };
      this.setStatus(`Reading ${it.source}`);
      const stats = await this.client.expand(id, {
        context: this.context.labels(),
        signal: controller.signal,
        onEvent: (ev) => this._onResearchEvent(ev),
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
    this.context.syncToStore(this.store);
    this._applyRelevance();
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
    const it = this.lights.get(id);
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
    if (mode === 'context') {
      const have = new Set(this.context.labels().map((l) => l.toLowerCase()));
      const sugg = SAMPLE_PERSONA.map((p) => p.label).filter((l) => !have.has(l.toLowerCase()));
      this.keypad.open({ prompt: 'Add to your context (coarse, no personal details)', suggestions: sugg });
    } else {
      const sugg = [...this.lights.items].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 4).map((it) => shortHeadline(it.headline));
      this.keypad.open({ prompt: 'Find a light', suggestions: sugg });
    }
  }

  async _onKeypadSubmit(text) {
    if (this.keypadMode === 'context') return this.addContext(text);
    return this.findLight(text);
  }

  findLight(text) {
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
    if (best && bestScore >= 0.3) {
      this.openLight(best.id);
      return best.id;
    }
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
    this.headPose(_hp, _hq);
    const now = performance.now();
    this.player?.update(delta * 1000);
    this.view.update(delta, _hp, _hq);
    this.lights.update(delta, _hq);
    this.cards.update(delta);
    this.atmosphere.update(delta);
    this.props.update(delta, now);
    this._followWrist();
    this.governor.sample(delta);
    if (this._wasResearching !== this.researching) {
      this._wasResearching = this.researching;
      this._renderStatus();
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
