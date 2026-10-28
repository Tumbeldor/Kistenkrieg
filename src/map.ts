import { Rng } from './rng';
import { Rect, Vec, circleRect, circleRectPush, segCircle, segRect, rectsOverlap, dist2 } from './geom';
import { MapId, PLAYER_RADIUS } from './config';

export type SolidKind = 'wall' | 'crate' | 'steel' | 'barrel' | 'rock';

export interface Solid extends Rect {
  id: number;
  kind: SolidKind;
  hp: number;
  maxHp: number;
  // circle solids (rocks / trees / cacti)
  round: boolean;
  cx: number;
  cy: number;
  r: number;
  q: number; // query stamp (dedupe in spatial hash)
}

export interface Bush { x: number; y: number; r: number; seed: number }
export type PickupKind = 'health' | 'armor' | 'weapon';
export interface PickupSpot { x: number; y: number; kind: PickupKind }

export interface RayHit { t: number; solid: Solid | null }

const CELL = 128;
const NAV = 40;
/** Map dimensions per size: 0 = small (2–3 players), 1 = medium, 2 = large (7+ players). */
export const MAP_SIZES: [number, number][] = [[1700, 1200], [2300, 1600], [2800, 1900]];
export type MapSize = 0 | 1 | 2;
export const mapSizeFor = (players: number): MapSize => (players <= 3 ? 0 : players <= 6 ? 1 : 2);

export class GameMap {
  readonly w: number;
  readonly h: number;
  readonly theme: MapId;
  readonly solids: Solid[] = [];
  readonly bushes: Bush[] = [];
  readonly spawns: Vec[] = [];
  readonly pickupSpots: PickupSpot[] = [];
  readonly decals: { x: number; y: number; r: number; a: number; t: number }[] = [];
  private cols: number;
  private rows: number;
  private buckets: Solid[][];
  private stamp = 1;
  private buf: Solid[] = [];
  readonly nav: NavGrid;

  constructor(seed: number, theme: MapId, size: MapSize) {
    this.theme = theme;
    [this.w, this.h] = MAP_SIZES[size] ?? MAP_SIZES[1];
    this.cols = Math.ceil(this.w / CELL);
    this.rows = Math.ceil(this.h / CELL);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    generate(this, new Rng(seed));
    this.nav = new NavGrid(this);
    this.placeSpawns(new Rng(seed ^ 0x9e3779b9));
  }

  addSolid(s: Omit<Solid, 'id' | 'q'>): Solid {
    const solid: Solid = { ...s, id: this.solids.length, q: 0 };
    this.solids.push(solid);
    const c0 = Math.max(0, Math.floor(solid.x / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((solid.x + solid.w) / CELL));
    const r0 = Math.max(0, Math.floor(solid.y / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((solid.y + solid.h) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.buckets[r * this.cols + c].push(solid);
    return solid;
  }

  /** Alive solids whose bounds touch the given box. Returned array is reused – copy if kept. */
  query(x0: number, y0: number, x1: number, y1: number): Solid[] {
    const out = this.buf;
    out.length = 0;
    const st = ++this.stamp;
    const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor(Math.max(x0, x1) / CELL));
    const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor(Math.max(y0, y1) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const s of this.buckets[r * this.cols + c]) {
          if (s.q === st || s.hp <= 0) continue;
          s.q = st;
          out.push(s);
        }
      }
    }
    return out;
  }

  circleBlocked(x: number, y: number, r: number): boolean {
    if (x - r < 0 || y - r < 0 || x + r > this.w || y + r > this.h) return true;
    for (const s of this.query(x - r, y - r, x + r, y + r)) {
      if (s.round ? dist2(x, y, s.cx, s.cy) < (r + s.r) ** 2 : circleRect(x, y, r, s)) return true;
    }
    return false;
  }

  /** Move a circle with sliding collision. Mutates p. */
  moveCircle(p: Vec, dx: number, dy: number, r: number): void {
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      p.x += sx;
      p.y += sy;
      this.resolveCircle(p, r);
    }
  }

  resolveCircle(p: Vec, r: number): void {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const s of this.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
        if (s.round) {
          const dx = p.x - s.cx;
          const dy = p.y - s.cy;
          const d = Math.hypot(dx, dy);
          const min = r + s.r;
          if (d < min) {
            if (d < 1e-4) { p.x += min; continue; }
            p.x += (dx / d) * (min - d);
            p.y += (dy / d) * (min - d);
            moved = true;
          }
        } else {
          const push = circleRectPush(p.x, p.y, r, s);
          if (push) {
            p.x += push.x;
            p.y += push.y;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    p.x = Math.max(r, Math.min(this.w - r, p.x));
    p.y = Math.max(r, Math.min(this.h - r, p.y));
  }

  /** Nearest solid hit along a segment. filter=null → every alive solid blocks. */
  raycast(x0: number, y0: number, x1: number, y1: number, filter: ((s: Solid) => boolean) | null = null): RayHit {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let best = 1;
    let hit: Solid | null = null;
    for (const s of this.query(x0, y0, x1, y1)) {
      if (filter && !filter(s)) continue;
      const t = s.round ? segCircle(x0, y0, dx, dy, s.cx, s.cy, s.r) : segRect(x0, y0, dx, dy, s);
      if (t >= 0 && t < best) {
        best = t;
        hit = s;
      }
    }
    return { t: best, solid: hit };
  }

  los(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.raycast(x0, y0, x1, y1).solid === null;
  }

  /** True if a circle of radius r can travel straight between two points. */
  clearPath(x0: number, y0: number, x1: number, y1: number, r: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * r;
    const ny = (dx / l) * r;
    return this.los(x0, y0, x1, y1) && this.los(x0 + nx, y0 + ny, x1 + nx, y1 + ny) && this.los(x0 - nx, y0 - ny, x1 - nx, y1 - ny);
  }

  bushAt(x: number, y: number): Bush | null {
    for (const b of this.bushes) if (dist2(x, y, b.x, b.y) < (b.r * 0.82) ** 2) return b;
    return null;
  }

  /** Called when a crate/barrel is destroyed. */
  removeSolid(s: Solid): void {
    s.hp = 0;
    this.nav.update(s);
    this.decals.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, r: Math.max(s.w, s.h) * 0.55, a: Math.random() * 6.28, t: s.kind === 'barrel' ? 1 : 0 });
  }

  private placeSpawns(rng: Rng): void {
    const cands: Vec[] = [];
    for (let y = 120; y < this.h - 120; y += 90) {
      for (let x = 120; x < this.w - 120; x += 90) {
        const px = x + rng.range(-20, 20);
        const py = y + rng.range(-20, 20);
        if (!this.circleBlocked(px, py, PLAYER_RADIUS + 22) && this.nav.reachable(px, py)) cands.push({ x: px, y: py });
      }
    }
    const take = (n: number, out: Vec[], avoid: Vec[], minD: number) => {
      const chosen: Vec[] = [];
      for (let k = 0; k < n && cands.length; k++) {
        let bestI = -1;
        let bestD = -1;
        for (let i = 0; i < cands.length; i++) {
          const c = cands[i];
          let d = Infinity;
          for (const o of [...chosen, ...avoid]) d = Math.min(d, dist2(c.x, c.y, o.x, o.y));
          if (chosen.length + avoid.length === 0) d = rng.next();
          if (d > bestD) { bestD = d; bestI = i; }
        }
        if (bestI < 0 || (avoid.length + chosen.length > 0 && bestD < minD * minD)) break;
        chosen.push(cands[bestI]);
        cands.splice(bestI, 1);
      }
      out.push(...chosen);
      return chosen;
    };
    take(16, this.spawns, [], 200);
    const spots: Vec[] = [];
    take(9, spots, this.spawns, 150);
    const kinds: PickupKind[] = ['weapon', 'health', 'weapon', 'armor', 'health', 'weapon', 'health', 'armor', 'weapon'];
    spots.forEach((s, i) => this.pickupSpots.push({ x: s.x, y: s.y, kind: kinds[i % kinds.length] }));
  }
}

// ---------------------------------------------------------------- generation

function generate(m: GameMap, rng: Rng): void {
  const T = 40;
  const W = m.w;
  const H = m.h;
  const wall = (x: number, y: number, w: number, h: number) =>
    m.addSolid({ kind: 'wall', x, y, w, h, hp: Infinity, maxHp: Infinity, round: false, cx: 0, cy: 0, r: 0 });
  wall(0, 0, W, T);
  wall(0, H - T, W, T);
  wall(0, T, T, H - 2 * T);
  wall(W - T, T, T, H - 2 * T);

  const theme = m.theme;
  // fewer objects on maps smaller than the medium size
  const k = Math.min(1, (W * H) / (MAP_SIZES[1][0] * MAP_SIZES[1][1]));
  const n = (v: number) => Math.round(v * k);
  const wallRects: Rect[] = [];
  const blockers: Rect[] = []; // everything solid placed so far (for spacing)
  const wt = 28;
  const nStruct = n(theme === 'lager' ? 11 : theme === 'wueste' ? 8 : 4);
  for (let attempt = 0, placed = 0; attempt < 200 && placed < nStruct; attempt++) {
    const cx = rng.range(260, W - 260);
    const cy = rng.range(260, H - 260);
    const type = rng.pick(theme === 'lager' ? ['line', 'line', 'L', 'U', 'room', 'T'] : ['line', 'L', 'U', 'L', 'T']);
    const rects: Rect[] = [];
    const len = rng.range(180, 420);
    const horiz = rng.chance(0.5);
    if (type === 'line') {
      rects.push(horiz ? { x: cx - len / 2, y: cy - wt / 2, w: len, h: wt } : { x: cx - wt / 2, y: cy - len / 2, w: wt, h: len });
    } else if (type === 'L') {
      const a = rng.range(160, 300);
      const b = rng.range(160, 300);
      const sx = rng.chance(0.5) ? 1 : -1;
      const sy = rng.chance(0.5) ? 1 : -1;
      rects.push({ x: sx > 0 ? cx : cx - a, y: cy - wt / 2, w: a, h: wt });
      rects.push({ x: cx - wt / 2, y: sy > 0 ? cy : cy - b, w: wt, h: b });
    } else if (type === 'T') {
      const a = rng.range(240, 380);
      const b = rng.range(130, 220);
      if (horiz) {
        rects.push({ x: cx - a / 2, y: cy - wt / 2, w: a, h: wt });
        rects.push({ x: cx - wt / 2, y: cy + wt / 2, w: wt, h: b });
      } else {
        rects.push({ x: cx - wt / 2, y: cy - a / 2, w: wt, h: a });
        rects.push({ x: cx + wt / 2, y: cy - wt / 2, w: b, h: wt });
      }
    } else if (type === 'U') {
      const s = rng.range(220, 320);
      const side = rng.int(0, 3);
      const x = cx - s / 2;
      const y = cy - s / 2;
      if (side !== 0) rects.push({ x, y, w: s, h: wt });
      if (side !== 1) rects.push({ x, y: y + s - wt, w: s, h: wt });
      if (side !== 2) rects.push({ x, y, w: wt, h: s });
      if (side !== 3) rects.push({ x: x + s - wt, y, w: wt, h: s });
    } else {
      // room with two door gaps
      const s = rng.range(360, 460);
      const door = 110;
      const x = cx - s / 2;
      const y = cy - s / 2;
      const half = (s - door) / 2;
      rects.push({ x, y, w: half, h: wt }, { x: x + half + door, y, w: half, h: wt });
      rects.push({ x, y: y + s - wt, w: half, h: wt }, { x: x + half + door, y: y + s - wt, w: half, h: wt });
      rects.push({ x, y, w: wt, h: s });
      rects.push({ x: x + s - wt, y, w: wt, h: s });
    }
    const ok = rects.every((r) => r.x > T + 60 && r.y > T + 60 && r.x + r.w < W - T - 60 && r.y + r.h < H - T - 60 &&
      wallRects.every((o) => !rectsOverlap(r, o, 120)));
    if (!ok) continue;
    for (const r of rects) {
      wall(r.x, r.y, r.w, r.h);
      wallRects.push(r);
      blockers.push(r);
    }
    placed++;
  }

  // Round solids: trees / rocks / cacti
  const nRocks = n(theme === 'wald' ? 26 : theme === 'wueste' ? 10 : 0);
  for (let i = 0, a = 0; i < nRocks && a < 400; a++) {
    const r = theme === 'wald' ? rng.range(24, 40) : rng.range(20, 32);
    const x = rng.range(T + 90, W - T - 90);
    const y = rng.range(T + 90, H - T - 90);
    const box = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
    if (blockers.some((o) => rectsOverlap(box, o, 80))) continue;
    m.addSolid({ kind: 'rock', x: box.x, y: box.y, w: box.w, h: box.h, hp: Infinity, maxHp: Infinity, round: true, cx: x, cy: y, r });
    blockers.push(box);
    i++;
  }

  // Crate clusters
  const CS = 54;
  const patterns: [number, number][][] = [
    [[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[0, 0], [1, 1]],
  ];
  const nClusters = n(theme === 'lager' ? 22 : theme === 'wueste' ? 14 : 11);
  for (let i = 0, a = 0; i < nClusters && a < 500; a++) {
    const pat = rng.pick(patterns);
    const ox = rng.range(T + 80, W - T - 200);
    const oy = rng.range(T + 80, H - T - 200);
    const rects = pat.map(([gx, gy]) => ({ x: ox + gx * CS, y: oy + gy * CS, w: CS, h: CS }));
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const r of rects) { bx0 = Math.min(bx0, r.x); by0 = Math.min(by0, r.y); bx1 = Math.max(bx1, r.x + r.w); by1 = Math.max(by1, r.y + r.h); }
    const box = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
    if (box.x + box.w > W - T - 80 || box.y + box.h > H - T - 80) continue;
    if (blockers.some((o) => rectsOverlap(box, o, 70))) continue;
    for (const r of rects) {
      const steel = theme === 'lager' ? rng.chance(0.2) : theme === 'wueste' ? rng.chance(0.1) : false;
      const hp = steel ? Infinity : 110;
      m.addSolid({ kind: steel ? 'steel' : 'crate', ...r, hp, maxHp: hp, round: false, cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: 0 });
    }
    blockers.push(box);
    i++;
  }

  // Explosive barrels
  const nBarrels = n(theme === 'wueste' ? 9 : theme === 'lager' ? 7 : 4);
  for (let i = 0, a = 0; i < nBarrels && a < 300; a++) {
    const s = 38;
    const box = { x: rng.range(T + 80, W - T - 120), y: rng.range(T + 80, H - T - 120), w: s, h: s };
    if (blockers.some((o) => rectsOverlap(box, o, 64))) continue;
    m.addSolid({ kind: 'barrel', ...box, hp: 35, maxHp: 35, round: false, cx: box.x + s / 2, cy: box.y + s / 2, r: s / 2 });
    blockers.push(box);
    i++;
  }

  // Bushes (hiding spots, not solid)
  const nBush = n(theme === 'wald' ? 24 : theme === 'wueste' ? 10 : 9);
  for (let i = 0, a = 0; i < nBush && a < 400; a++) {
    const r = rng.range(50, 78);
    const x = rng.range(T + r, W - T - r);
    const y = rng.range(T + r, H - T - r);
    const core = { x: x - r * 0.5, y: y - r * 0.5, w: r, h: r };
    if (wallRects.some((o) => rectsOverlap(core, o, 10))) continue;
    if (m.bushes.some((b) => dist2(b.x, b.y, x, y) < (b.r + r) ** 2 * 0.8)) continue;
    m.bushes.push({ x, y, r, seed: rng.next() * 1000 });
    i++;
  }
}

// ---------------------------------------------------------------- navigation

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  clear() { this.ids.length = 0; this.keys.length = 0; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  private comp: Int32Array;
  private mainComp = -1;
  private g: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap = new MinHeap();

  constructor(private map: GameMap) {
    this.cols = Math.ceil(map.w / NAV);
    this.rows = Math.ceil(map.h / NAV);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.comp = new Int32Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.blocked[i] = this.cellBlocked(i) ? 1 : 0;
    this.components();
  }

  private cellBlocked(i: number): boolean {
    const cx = (i % this.cols) * NAV + NAV / 2;
    const cy = Math.floor(i / this.cols) * NAV + NAV / 2;
    return this.map.circleBlocked(cx, cy, PLAYER_RADIUS + 3);
  }

  private components() {
    this.comp.fill(-1);
    let best = 0;
    let id = 0;
    const stack: number[] = [];
    for (let s = 0; s < this.blocked.length; s++) {
      if (this.blocked[s] || this.comp[s] >= 0) continue;
      let size = 0;
      stack.push(s);
      this.comp[s] = id;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        const x = c % this.cols;
        const y = (c / this.cols) | 0;
        const nb = [x > 0 ? c - 1 : -1, x < this.cols - 1 ? c + 1 : -1, y > 0 ? c - this.cols : -1, y < this.rows - 1 ? c + this.cols : -1];
        for (const n of nb) {
          if (n >= 0 && !this.blocked[n] && this.comp[n] < 0) { this.comp[n] = id; stack.push(n); }
        }
      }
      if (size > best) { best = size; this.mainComp = id; }
      id++;
    }
  }

  cellOf(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(x / NAV)));
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(y / NAV)));
    return cy * this.cols + cx;
  }
  center(i: number): Vec {
    return { x: (i % this.cols) * NAV + NAV / 2, y: Math.floor(i / this.cols) * NAV + NAV / 2 };
  }
  reachable(x: number, y: number): boolean {
    const c = this.cellOf(x, y);
    return !this.blocked[c] && this.comp[c] === this.mainComp;
  }

  update(s: Solid) {
    const c0 = Math.max(0, Math.floor((s.x - NAV) / NAV));
    const c1 = Math.min(this.cols - 1, Math.floor((s.x + s.w + NAV) / NAV));
    const r0 = Math.max(0, Math.floor((s.y - NAV) / NAV));
    const r1 = Math.min(this.rows - 1, Math.floor((s.y + s.h + NAV) / NAV));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * this.cols + c;
      this.blocked[i] = this.cellBlocked(i) ? 1 : 0;
      if (!this.blocked[i]) this.comp[i] = this.mainComp;
    }
  }

  nearestFree(i: number): number {
    if (!this.blocked[i]) return i;
    const x0 = i % this.cols;
    const y0 = (i / this.cols) | 0;
    for (let rad = 1; rad < 8; rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const j = y * this.cols + x;
        if (!this.blocked[j]) return j;
      }
    }
    return -1;
  }

  findPath(sx: number, sy: number, tx: number, ty: number, maxIter = 4000): Vec[] | null {
    const start = this.nearestFree(this.cellOf(sx, sy));
    const goal = this.nearestFree(this.cellOf(tx, ty));
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, y: ty }];
    const gen = ++this.gen;
    const cols = this.cols;
    const gx = goal % cols, gy = (goal / cols) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % cols) - gx);
      const dy = Math.abs(((i / cols) | 0) - gy);
      return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * NAV;
    };
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.seen[start] = gen;
    this.from[start] = -1;
    heap.push(start, h(start));
    let iter = 0;
    let found = false;
    while (heap.size && iter++ < maxIter) {
      const c = heap.pop();
      if (this.closed[c] === gen) continue;
      this.closed[c] = gen;
      if (c === goal) { found = true; break; }
      const x = c % cols, y = (c / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= this.rows) continue;
        const n = ny * cols + nx;
        if (this.blocked[n] || this.closed[n] === gen) continue;
        if (dx && dy && (this.blocked[y * cols + nx] || this.blocked[ny * cols + x])) continue;
        const ng = this.g[c] + (dx && dy ? NAV * Math.SQRT2 : NAV);
        if (this.seen[n] !== gen || ng < this.g[n]) {
          this.seen[n] = gen;
          this.g[n] = ng;
          this.from[n] = c;
          heap.push(n, ng + h(n));
        }
      }
    }
    if (!found) return null;
    const path: Vec[] = [];
    for (let c = goal; c !== -1 && c !== start; c = this.from[c]) path.push(this.center(c));
    path.reverse();
    if (path.length) path[path.length - 1] = { x: tx, y: ty };
    if (this.map.circleBlocked(tx, ty, PLAYER_RADIUS)) path[path.length - 1] = this.center(goal);
    return path;
  }
}
