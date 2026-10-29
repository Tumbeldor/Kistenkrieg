// Keyboard/mouse and twin-stick touch controls.
import type { PlayerInput } from './game';

export interface Stick {
  id: number | null;
  bx: number;
  by: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  mag: number;
  startT: number;
  moved: number;
}
export interface TouchButton { id: 'reload' | 'swap' | 'score' | 'pause' | 'grenade'; x: number; y: number; r: number; touch: number | null }

const newStick = (): Stick => ({ id: null, bx: 0, by: 0, x: 0, y: 0, dx: 0, dy: 0, mag: 0, startT: 0, moved: 0 });

export class Input {
  keys = new Set<string>();
  mouse = { x: 0, y: 0, down: false, seen: false };
  touchMode = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
  moveStick = newStick();
  aimStick = newStick();
  buttons: TouchButton[] = [];
  stickR = 60;
  private reloadEdge = false;
  private nextEdge = false;
  private slotEdge = -1;
  private throwEdge = false;
  pauseEdge = false;
  scoreHeld = false;
  scoreToggle = false;
  private lastAim = 0;
  private tapFireT = 0;
  enabled = false;
  onFirstTouch: (() => void) | null = null;
  private W = 0;

  attach(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if (k === 'tab') { e.preventDefault(); this.scoreHeld = true; }
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'r') this.reloadEdge = true;
      if (k === 'q' || k === 'e') this.nextEdge = true;
      if (k === '1' || k === '2' || k === '3') this.slotEdge = Number(k) - 1;
      if (k === 'escape' || k === 'p') this.pauseEdge = true;
      if (k === 'g') this.throwEdge = true;
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'tab') this.scoreHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.scoreHeld = false; });
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true; });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2 && this.enabled) this.throwEdge = true;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.touchMode = false;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.enabled && Math.abs(e.deltaY) > 2) this.nextEdge = true; }, { passive: true });

    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), opts);
    canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), opts);
    canvas.addEventListener('touchend', (e) => this.onTouchEnd(e), opts);
    canvas.addEventListener('touchcancel', (e) => this.onTouchEnd(e), opts);
  }

  layout(W: number, H: number, safeL: number, safeR: number, safeB = 0) {
    this.W = W;
    const small = Math.min(W, H) < 500;
    const br = small ? 27 : 32;
    this.stickR = small ? 56 : 66;
    const rx = W - safeR - br - 14;
    // right edge column: reload, grenade below it, weapon swap at the very bottom corner
    const gap = 14;
    const swapY = H - Math.max(safeB, 6) - br - 8;
    const midY = Math.min(swapY - br * 2 - gap, H * 0.62);
    const reloadY = midY - br * 2 - gap;
    const prev = new Map(this.buttons.map((b) => [b.id, b.touch]));
    this.buttons = [
      { id: 'pause', x: W - safeR - 30, y: 30, r: 22, touch: null },
      { id: 'score', x: W - safeR - 84, y: 30, r: 22, touch: null },
      { id: 'reload', x: rx, y: reloadY, r: br, touch: null },
      { id: 'swap', x: rx, y: swapY, r: br, touch: null },
      { id: 'grenade', x: rx, y: midY, r: br, touch: null },
    ];
    for (const b of this.buttons) b.touch = prev.get(b.id) ?? null;
    void safeL;
  }

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!this.touchMode) { this.touchMode = true; this.onFirstTouch?.(); }
    if (!this.enabled) return;
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX, y = t.clientY;
      const btn = this.buttons.find((b) => b.touch === null && (x - b.x) ** 2 + (y - b.y) ** 2 < (b.r + 10) ** 2);
      if (btn) {
        btn.touch = t.identifier;
        if (btn.id === 'reload') this.reloadEdge = true;
        if (btn.id === 'swap') this.nextEdge = true;
        if (btn.id === 'grenade') this.throwEdge = true;
        if (btn.id === 'score') this.scoreToggle = !this.scoreToggle;
        if (btn.id === 'pause') this.pauseEdge = true;
        continue;
      }
      const s = x < this.W * 0.5 ? this.moveStick : this.aimStick;
      if (s.id !== null) continue;
      s.id = t.identifier;
      s.bx = x; s.by = y; s.x = x; s.y = y;
      s.dx = s.dy = s.mag = 0;
      s.startT = performance.now();
      s.moved = 0;
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      for (const s of [this.moveStick, this.aimStick]) {
        if (s.id !== t.identifier) continue;
        let dx = t.clientX - s.bx, dy = t.clientY - s.by;
        const d = Math.hypot(dx, dy);
        s.moved = Math.max(s.moved, d);
        const R = this.stickR;
        if (d > R) {
          // drag the base along so the stick never "runs out"
          if (s === this.moveStick) { s.bx += (dx / d) * (d - R); s.by += (dy / d) * (d - R); }
          dx = (dx / d) * R; dy = (dy / d) * R;
        }
        s.x = s.bx + dx; s.y = s.by + dy;
        s.dx = dx / R; s.dy = dy / R;
        s.mag = Math.min(1, d / R);
      }
    }
  }

  private onTouchEnd(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      for (const b of this.buttons) if (b.touch === t.identifier) b.touch = null;
      for (const s of [this.moveStick, this.aimStick]) {
        if (s.id !== t.identifier) continue;
        if (s === this.aimStick && performance.now() - s.startT < 230 && s.moved < 14) this.tapFireT = 0.2;
        s.id = null;
        s.dx = s.dy = s.mag = 0;
      }
    }
  }

  /**
   * Builds the player input. px/py = player screen position.
   * assist(angle) may return a corrected aim angle (touch aim assist / tap auto-aim).
   */
  read(px: number, py: number, dt: number, assist: (a: number | null) => number | null): PlayerInput {
    const inp: PlayerInput = { mx: 0, my: 0, aim: this.lastAim, fire: false, reload: this.reloadEdge, next: this.nextEdge, slot: this.slotEdge, throw: this.throwEdge, throwDist: 0 };
    this.reloadEdge = false;
    this.nextEdge = false;
    this.slotEdge = -1;
    this.throwEdge = false;
    if (this.touchMode) {
      const m = this.moveStick;
      if (m.id !== null && m.mag > 0.12) { inp.mx = m.dx; inp.my = m.dy; }
      const a = this.aimStick;
      if (a.id !== null && a.mag > 0.2) {
        const raw = Math.atan2(a.dy, a.dx);
        inp.fire = a.mag > 0.5;
        inp.aim = inp.fire ? assist(raw) ?? raw : raw;
      } else if (this.tapFireT > 0) {
        this.tapFireT -= dt;
        const auto = assist(null);
        if (auto !== null) inp.aim = auto;
        inp.fire = true;
      } else if (m.id !== null && m.mag > 0.3) {
        inp.aim = Math.atan2(m.dy, m.dx);
      }
    } else {
      const k = this.keys;
      inp.mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      inp.my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
      if (this.mouse.seen) inp.aim = Math.atan2(this.mouse.y - py, this.mouse.x - px);
      inp.fire = this.mouse.down;
    }
    this.lastAim = inp.aim;
    return inp;
  }

  resetState() {
    this.keys.clear();
    this.mouse.down = false;
    this.moveStick = newStick();
    this.aimStick = newStick();
    this.scoreHeld = false;
    this.scoreToggle = false;
    this.tapFireT = 0;
    this.pauseEdge = false;
    for (const b of this.buttons) b.touch = null;
  }
}
