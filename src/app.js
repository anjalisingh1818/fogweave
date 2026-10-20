/**
 * App: glue between the knowledge web (GraphStore), its view, the cards,
 * the keypad, the props and onboarding. All user actions come in here so
 * the hand path, the desktop path and scripted QA share one code path.
 */
import { Vector3, Quaternion, Hovered } from '@iwsdk/core';
import { GraphStore, topicKey, similarity } from './model/graph.js';
import { shortestPath, importanceOf, mostImportant, evidenceReadout } from './model/algorithms.js';
import { GraphView } from './render/graph-view.js';
import { Atmosphere } from './render/atmosphere.js';
import { Card, UI } from './render/card.js';
import { CardManager } from './ui/card-manager.js';
import { nodeCardDraw, locketDraw, coinDraw, messageDraw } from './ui/node-card.js';
import { helpDraw, libraryDraw } from './ui/help.js';
import { Keypad } from './ui/keypad.js';
import { Onboarding } from './ui/onboarding.js';
import { Props } from './props.js';
import { LightField } from './render/lights.js';
import { readerDraw } from './ui/reader-card.js';
import { graphToEvents, EventPlayer, applyEvent } from './research/events.js';
import { settings, loadSettings, setQuality, DEBUG } from './config.js';
import { QualityGovernor } from './quality.js';

const SEALED_KEY = 'fogweave.sealed.v1';
const RECENT_KEY = 'fogweave.recent.v1';
const LAST_KEY = 'fogweave.last.v1';
const SEALED_LIGHTS_KEY = 'fogweave.sealedLights.v1';

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
    this.atmosphere = new Atmosphere(this.world);
    this.view = new GraphView(this.world, this.store, { center: this._bubbleCenter(), radius: settings.bubble.radius });
    this.cards = new CardManager(this.world, this.anchor);
    this.cards.onClose = (key) => this._onCardClosed(key);
    this.keypad = new Keypad(this.world, this.anchor, {
      onSubmit: (text) => this.submitTopic(text),
      onClose: () => {},
    });
    this.props = new Props(this.world, this.anchor, {
      onReveal: (kind, info) => this.reveal(kind, info),
      onBothHeld: () => this.pathFromProps(),
    });
    this.lights = new LightField(this.world, this.anchor);
    this.lights.onSelect = (id) => this.openLight(id);
    this.lightsMeta = null;
    this.sealedLights = readJSON(SEALED_LIGHTS_KEY, {}); // id -> item copy (Library)
    this.lights.sealed = new Set(Object.keys(this.sealedLights));
    this.onboarding = new Onboarding(this);
    this.governor = new QualityGovernor((level) => {
      setQuality(level);
      this.view.markLabelsDirty();
    });
    this.selectedId = null;
    this.prevSelectedId = null;
    this.linkFromId = null;
    this.player = null;
    this.statusText = '';
    this.demos = [];
    this._pathTimer = null;
    this._buildStatusCard();
    this._buildHelpButton();
    this._wireNodePicking();
    this.store.on((ev) => this._onStoreChange(ev));
    this.ready = this._start();
  }

  // ---------- startup ----------

  async _start() {
    this._loadLights();
    try {
      const res = await fetch('demo/index.json');
      this.demos = res.ok ? await res.json() : [];
    } catch {
      this.demos = [];
    }
    const last = readJSON(LAST_KEY, null);
    const first = Onboarding.needed();
    const key = (!first && last && this.demos.find((d) => d.topicKey === last)?.topicKey) || this.demos[0]?.topicKey;
    if (key) await this.loadDemo(key, { replay: true });
    if (first) this.startOnboarding();
  }

  /** Bundled light snapshot (dated); the news engine will stream fresh ones. */
  async _loadLights() {
    try {
      const res = await fetch('demo/lights.json');
      if (!res.ok) return;
      const doc = await res.json();
      this.lightsMeta = { kind: doc.provenance?.kind, generatedAt: doc.generatedAt };
      this.lights.setItems(doc.items || []);
    } catch (err) {
      console.warn('[fogweave] no bundled lights', err);
    }
  }

  openLight(id) {
    if (!this.lights.get(id)) return;
    for (const e of [...this.cards.open]) if (e.key.startsWith('light:') && e.key !== `light:${id}`) this.cards.close(e.key);
    this.lights.openId = id;
    this.cards.show(`light:${id}`, { width: 0.46, height: 0.46, draw: readerDraw(this, id), prefer: this.lights.worldPositionOf(id) });
    this.onboarding.notify('light-opened');
  }

  sealLight(id) {
    const it = this.lights.get(id);
    if (!it) return;
    const { claims, ...rest } = it;
    this.sealedLights[id] = { ...rest, claims: (claims || []).slice(0, 3), sealedAt: new Date().toISOString() };
    this.lights.sealed.add(id);
    writeJSON(SEALED_LIGHTS_KEY, this.sealedLights);
    this.cards.get(`light:${id}`)?.redraw();
    this.onboarding.notify('sealed');
  }

  unsealLight(id) {
    delete this.sealedLights[id];
    this.lights.sealed.delete(id);
    writeJSON(SEALED_LIGHTS_KEY, this.sealedLights);
    this.cards.get(`light:${id}`)?.redraw();
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
    this.statusCard = new Card(this.world, { width: 0.46, height: 0.075, name: 'status' });
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

  _renderStatus() {
    const running = this.player && !this.player.done && !this.player.stopped;
    const fixture = this.store.meta.provenance?.kind === 'fixture';
    this.statusCard.setContent((ctx, ui, w, h) => {
      const pad = 36;
      const label = running ? `Fog is looking · ${this.statusText}` : this.statusText || this.store.meta.topic || 'Pinch empty space to name a topic';
      if (running) ui.ringIcon(pad + 14, h / 2 - 2, 14, '#d9dee6', this.player.paused ? 'dotted' : 'dashed');
      ui.text(label, pad + (running ? 44 : 0), h / 2 + 12, { size: 32, maxWidth: w - pad * 2 - (running ? 360 : fixture ? 250 : 0) });
      if (running) {
        ui.button('pause', this.player.paused ? 'Resume' : 'Pause', w - pad - 330, 14, 160, h - 28, () => this.togglePause(), { size: 26 });
        ui.button('stop', 'Stop', w - pad - 160, 14, 160, h - 28, () => this.stopResearch(), { size: 26 });
      } else if (fixture) {
        ui.text('TEST FIXTURE', w - pad, h / 2 + 10, { size: 26, color: '#f0c987', weight: 700, align: 'right' });
      }
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
    else this.cards.show('help', { width: 0.44, height: 0.42, draw: helpDraw(this), slot: 1 });
  }

  openLibrary() {
    this.closeCard('help');
    this.cards.show('library', { width: 0.44, height: 0.36, draw: libraryDraw(this), slot: 1 });
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
    // one node card at a time keeps the arc readable
    for (const e of [...this.cards.open]) if (e.key.startsWith('node:') && e.key !== `node:${id}`) this.cards.close(e.key);
    this.cards.show(`node:${id}`, { width: 0.44, height: 0.36, draw: nodeCardDraw(this, id), prefer });
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

  // ---------- seal / unseal ----------

  seal(id) {
    const changed = this.store.seal(id);
    this._saveSealed();
    for (const c of changed) this.view.flash(c, 1.2);
    this._refreshCards();
    this.onboarding.notify('sealed');
    return changed;
  }

  unseal(id) {
    const changed = this.store.unseal(id);
    this._saveSealed();
    this._refreshCards();
    return changed;
  }

  _saveSealed() {
    const key = this.store.meta.topicKey;
    if (!key) return;
    const all = readJSON(SEALED_KEY, {});
    all[key] = this.store.sealedIds();
    writeJSON(SEALED_KEY, all);
  }

  _restoreSealed() {
    const ids = readJSON(SEALED_KEY, {})[this.store.meta.topicKey];
    if (ids?.length) this.store.restoreSealed(ids.filter((id) => this.store.nodes.has(id) || this.store.edges.has(id)));
  }

  // ---------- link / path ----------

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
    const la = this.store.nodes.get(a)?.label;
    const lb = this.store.nodes.get(b)?.label;
    if (!path) {
      this.view.clearPath();
      this.cards.show('path', { width: 0.42, height: 0.24, draw: messageDraw(this, 'path', 'No connection found', `“${la}” and “${lb}” are not connected in this web.`) });
      return null;
    }
    this.view.showPath(path);
    for (const id of path.nodes) this.view.flash(id, 2);
    const steps = path.nodes.map((id) => this.store.nodes.get(id)?.label).join(' → ');
    this.cards.show('path', {
      width: 0.44,
      height: 0.3,
      draw: messageDraw(this, 'path', `Path: ${path.edges.length} step${path.edges.length === 1 ? '' : 's'}`, `${steps}\n${note}`),
    });
    this.setStatus('');
    this._refreshCards();
    return path;
  }

  // ---------- props ----------

  reveal(kind, { via, worldPos }) {
    let id = worldPos ? this.view.nearestNode(worldPos, settings.props.lockRadius) : this.selectedId;
    const openAir = !id;
    if (openAir) {
      const top = mostImportant(this.store.view(this._layerFor(null)));
      if (!top) {
        this.cards.show('reveal', { width: 0.4, height: 0.22, draw: messageDraw(this, 'reveal', 'Nothing to read yet', 'Name a topic first: pinch empty space.') });
        return null;
      }
      id = top.id;
    }
    this.view.flash(id, settings.props.revealSeconds);
    const prefer = this.view.worldPositionOf(id);
    let result;
    if (kind === 'locket' || (kind === 'coin' && openAir)) {
      const layer = this._layerFor(id);
      result = importanceOf(this.store.view(layer), id);
      const scope = layer === 'sealed' ? 'in your sealed web' : 'in the whole web';
      const label = openAir ? `${scope} · most central` : scope;
      this.cards.show('reveal', { width: 0.4, height: 0.3, draw: locketDraw(this, id, result, label), prefer });
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

  // ---------- topics ----------

  openKeypad() {
    if (this.keypad.isOpen) return;
    this.keypad.open({ prompt: 'Name a topic', suggestions: this.topicSuggestions() });
  }

  topicSuggestions() {
    const out = [];
    const add = (s) => {
      if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    };
    for (const r of readJSON(RECENT_KEY, [])) add(r);
    for (const d of this.demos) if (d.topicKey !== this.store.meta.topicKey) add(d.topic);
    // related: named areas in the current web
    for (const n of this.store.nodes.values()) if (n.type === 'Entity' && out.length < 8) add(n.label);
    return out.slice(0, 4);
  }

  async submitTopic(text) {
    const recent = [text, ...readJSON(RECENT_KEY, []).filter((t) => t.toLowerCase() !== text.toLowerCase())].slice(0, 6);
    writeJSON(RECENT_KEY, recent);
    const demo = this.demos
      .map((d) => ({ d, s: Math.max(similarity(text.toLowerCase(), d.topic.toLowerCase()), topicKey(text) === d.topicKey ? 1 : 0) }))
      .sort((a, b) => b.s - a.s)[0];
    if (demo && demo.s >= 0.5) return this.loadDemo(demo.d.topicKey, { replay: true });
    return this.startResearch(text);
  }

  /**
   * Live research arrives in Phase 2. Until then (and whenever the
   * backend is off) the topic is planted unresearched and we say so.
   */
  startResearch(text) {
    this.stopResearch();
    this.store.clear();
    applyEvent(this.store, { type: 'plan', node: { id: `topic:${topicKey(text)}`, type: 'Topic', label: text }, topicKey: topicKey(text), provenance: { kind: 'unresearched' } });
    this.setStatus('Research backend is off: only the bundled webs can grow right now.');
    this.cards.show('research', {
      width: 0.42,
      height: 0.26,
      draw: messageDraw(this, 'research', 'Backend offline', `“${text}” was planted but not researched. Bundled webs still work fully.`, [
        { id: 'demos', label: 'Bundled', onPress: () => this.openKeypad(), primary: true },
      ]),
    });
  }

  async loadDemo(key, { replay = true } = {}) {
    const entry = this.demos.find((d) => d.topicKey === key);
    if (!entry) return false;
    let doc;
    try {
      const res = await fetch(`demo/${entry.file}`);
      doc = await res.json();
    } catch (err) {
      console.warn('[fogweave] could not load bundled web', key, err);
      return false;
    }
    this.stopResearch();
    this.cards.closeAll();
    this.store.clear();
    writeJSON(LAST_KEY, key);
    const events = graphToEvents(doc);
    this.player = new EventPlayer(this.store, events, {
      durationMs: replay ? 9000 : 0,
      onStatus: (s) => this.setStatus(s),
      onDone: () => {
        this.store.insights = doc.insights || [];
        this._restoreSealed();
        this.setStatus('');
        this._renderStatus();
      },
    });
    if (!replay) this.player.finish();
    this._renderStatus();
    return true;
  }

  togglePause() {
    if (!this.player) return;
    if (this.player.paused) this.player.resume();
    else this.player.pause();
    this._renderStatus();
  }

  stopResearch() {
    if (this.player && !this.player.done) {
      this.player.stop();
      this.setStatus('Stopped. What grew so far stays.');
    }
  }

  _onStoreChange(ev) {
    if (ev.kind === 'sealed' || ev.kind === 'unsealed' || ev.kind === 'node-updated') {
      for (const e of this.cards.open) if (e.key.startsWith('node:') || e.key === 'library') e.card.redraw();
    }
  }

  // ---------- empty-space pinch & flick ----------

  onEmptyPinch() {
    if (this.keypad.isOpen) return;
    this.openKeypad();
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
  }

  _followWrist() {
    const grip = this.sys.player.gripSpaces?.left;
    const o = this.helpButton.object3D;
    if (this.world.session && grip) {
      grip.getWorldPosition(o.position);
      o.position.y += 0.09;
      o.lookAt(_hp);
    } else {
      // no hands (flat page): park it at the lower left of the arc
      const { head, yaw } = this.anchor;
      o.position.set(head.x + Math.sin(yaw - 0.5) * 0.6, head.y - 0.3, head.z - Math.cos(yaw - 0.5) * 0.6);
      o.lookAt(head);
    }
  }
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

export { UI, DEBUG };
