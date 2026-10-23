/**
 * FogSystem: the single per-frame driver. Owns the raw input glue that
 * IWSDK's pointer system does not cover:
 *  - pinch in empty space -> keypad (deferred so grabs/presses win)
 *  - recentering on the seated head when a session starts
 *  - flick a hand while pointing at a card -> dismiss it
 */
import { createSystem, Vector3, Quaternion, Hovered } from '@iwsdk/core';
import { App } from '../app.js';
import { settings, DEBUG } from '../config.js';

export class FogSystem extends createSystem({}) {
  init() {
    this.app = new App(this);
    this._pending = null;
    this._session = null;
    this._wrist = { left: [], right: [] };
    this._lastRayHit = { left: null, right: null }; // { object, t } per hand
    this._flickCooldown = 0;
    this._recenterAt = performance.now(); // anchor to wherever the head is now
    this._onSelectStart = this._onSelectStart.bind(this);

    const onStart = () => {
      this._attachSession();
      this._recenterAt = performance.now() + 400; // let the head pose settle
      this.app.governor.setTargetHz(this.world.session?.frameRate || 72);
    };
    this.xrManager.addEventListener('sessionstart', onStart);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionstart', onStart));

    // flat page (mouse): a click on the fog offers a small "Ask about a topic"
    // option where you clicked; pressing it opens Ask the fog (in VR a pinch on
    // the fog opens it). Not on a star, node or card: those open as before.
    const canvas = this.world.renderer?.domElement;
    if (canvas) {
      let down = null;
      const onDown = (e) => {
        // a press that starts on a card, star or node is theirs, even if the card
        // is gone a moment later (Close)
        down = { x: e.clientX, y: e.clientY, t: performance.now(), onSomething: this.app.anythingHovered() };
        this.app.hideAskOption();
      };
      const onUp = (e) => {
        const d = down;
        down = null;
        if (!d || d.onSomething || this.world.session || e.button !== 0) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return; // a drag, not a click
        const { clientX: x, clientY: y } = e;
        // like a pinch: give a card, star or node the first chance to claim it
        setTimeout(() => {
          if (this.app.isEmptyAt(x, y, canvas)) this.app.offerAsk(x, y);
        }, settings.gestures.spawnDeferMs);
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      this.cleanupFuncs.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
      });
    }

    if (DEBUG) {
      window.__fw = { app: this.app, world: this.world, settings, system: this, Hovered };
      this._debugOverlay();
    }
  }

  _attachSession() {
    const session = this.world.session;
    if (!session || session === this._session) return;
    this._session = session;
    session.addEventListener('selectstart', this._onSelectStart);
  }

  _onSelectStart(event) {
    // decided a few frames later: if a prop got grabbed or this hand's
    // ray/poke was on a card, node or prop, the pinch belonged to them
    const hand = event.inputSource?.handedness;
    this._pending = { at: performance.now(), held: this._heldCount(), hand, hovered: this._handTargetsSomething(hand) };
  }

  _rayHit(hand) {
    try {
      const hit = this.input?.xr?.multiPointers?.[hand]?.getPointer('ray')?.getIntersection?.();
      return hit && hit.object && !hit.object.isVoidObject ? hit.object : null;
    } catch {
      return null;
    }
  }

  /** Is this hand's ray, grab or poke pointer on one of our objects (not the void)? */
  _handTargetsSomething(hand) {
    const mp = this.input?.xr?.multiPointers?.[hand];
    if (!mp) return this.app.anythingHovered();
    for (const kind of ['ray', 'grab', 'touch']) {
      let hit = null;
      try {
        hit = mp.getPointer(kind)?.getIntersection?.();
      } catch {
        continue; // pointer kind not enabled
      }
      if (hit && hit.object && !hit.object.isVoidObject) return true;
    }
    return false;
  }

  _heldCount() {
    return (this.app.props.isHeld('locket') ? 1 : 0) + (this.app.props.isHeld('coin') ? 1 : 0);
  }

  update(delta) {
    const now = performance.now();
    if (this._recenterAt && now >= this._recenterAt) {
      this._recenterAt = 0;
      const pos = new Vector3();
      const quat = new Quaternion();
      this.app.headPose(pos, quat);
      this.app.recenter(pos, quat);
    }
    if (this.world.session !== this._session) this._attachSession(); // session is set after 'sessionstart'
    this.app.update(delta);
    this._resolvePendingPinch(now);
    if (this.world.session) this._detectFlick(now);
    if (this._overlay && (this._overlayAt = (this._overlayAt || 0) + delta) > 0.5) {
      this._overlayAt = 0;
      const s = this.app.governor.stats;
      this._overlay.textContent = `${s.fps.toFixed(0)} fps · ${s.avgMs.toFixed(1)} ms avg · p95 ${s.p95Ms?.toFixed(1)} · q${s.level} · ${this.app.view.visibleIds.length} nodes`;
    }
  }

  _resolvePendingPinch(now) {
    const p = this._pending;
    if (!p) return;
    const busy = p.hand ? this._handTargetsSomething(p.hand) : this.app.anythingHovered();
    if (p.hovered || this._heldCount() > p.held || busy) {
      this._pending = null;
      return;
    }
    if (now - p.at < settings.gestures.spawnDeferMs) return;
    this._pending = null;
    this.app.onEmptyPinch();
  }

  _detectFlick(now) {
    if (now < this._flickCooldown) return;
    for (const side of ['left', 'right']) {
      const grip = this.player.gripSpaces?.[side];
      if (!grip) continue;
      const hist = this._wrist[side];
      hist.push({ t: now, p: grip.getWorldPosition(new Vector3()) });
      // remember what this hand's ray was on: a flick sweeps the ray off it
      const hit = this._rayHit(side);
      if (hit) this._lastRayHit[side] = { object: hit, t: now };
      while (hist.length && now - hist[0].t > settings.gestures.flickWindowMs) hist.shift();
      if (hist.length < 3) continue;
      // every step must be humanly fast but plausible (tracking jumps and
      // teleports are not flicks) and keep heading the same way
      const g = settings.gestures;
      let ok = true;
      let prevDir = null;
      for (let i = 1; i < hist.length && ok; i++) {
        const dt = (hist[i].t - hist[i - 1].t) / 1000;
        if (dt <= 0) continue;
        const dx = hist[i].p.x - hist[i - 1].p.x;
        const dy = hist[i].p.y - hist[i - 1].p.y;
        const v = Math.hypot(dx, dy) / dt;
        if (v > g.flickMaxSpeed) ok = false;
        const dir = Math.atan2(dy, dx);
        if (prevDir !== null && v > 0.3 && Math.abs(angleDiff(dir, prevDir)) > Math.PI / 3) ok = false;
        if (v > 0.3) prevDir = dir;
      }
      const a = hist[0];
      const b = hist[hist.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (!ok || dt <= 0) continue;
      // sideways speed only: reaching forward to pinch is not a flick
      const speed = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) / dt;
      const recent = this._lastRayHit[side];
      const target = recent && now - recent.t <= 300 ? recent.object : null;
      if (speed >= settings.gestures.flickMinSpeed && target && this.app.dismissCardByObject(target)) {
        this._flickCooldown = now + 800;
        hist.length = 0;
      }
    }
  }

  _debugOverlay() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;font:12px monospace;color:#dfe;background:rgba(0,0,0,.6);padding:4px 6px;border-radius:4px;pointer-events:none';
    document.body.appendChild(el);
    this._overlay = el;
  }
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
