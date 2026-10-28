// Canvas renderer: world, entities, effects and HUD.
import { MapId, TEAM_COLORS, TEAM_NAMES, WEAPONS, WeaponId, skinDef } from './config';
import type { Fx } from './fx';
import type { Game, Player } from './game';
import { sameTeam } from './game';
import type { Input } from './input';
import { GameMap, Solid } from './map';
import { dist } from './geom';

interface Theme {
  bg: string; floor: string; floor2: string; line: string; wall: string; wallTop: string; wallEdge: string;
  bush: string; bush2: string; bushEdge: string; rock: string; rock2: string; shadow: string;
}
const THEMES: Record<MapId, Theme> = {
  lager: { bg: '#14171d', floor: '#4b515a', floor2: '#454b54', line: '#3d424a', wall: '#2c313a', wallTop: '#5e6676', wallEdge: '#1b1f26',
    bush: '#566b3c', bush2: '#677f48', bushEdge: '#3c4d2a', rock: '#666', rock2: '#888', shadow: 'rgba(0,0,0,0.32)' },
  wald: { bg: '#0f1a0d', floor: '#4f8a3c', floor2: '#4a8338', line: '#447a33', wall: '#5b5f55', wallTop: '#8e9384', wallEdge: '#3a3d35',
    bush: '#2f7d33', bush2: '#3f9a43', bushEdge: '#225c25', rock: '#2a5f25', rock2: '#3c7d32', shadow: 'rgba(0,20,0,0.3)' },
  wueste: { bg: '#2a2013', floor: '#d6b57a', floor2: '#cfae70', line: '#c4a063', wall: '#9a7444', wallTop: '#d1a86a', wallEdge: '#6b4f2c',
    bush: '#8b9440', bush2: '#a5ad52', bushEdge: '#6b7330', rock: '#8d7a62', rock2: '#a8957b', shadow: 'rgba(60,30,0,0.25)' },
};

export function shade(hex: string, amt: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; } else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function skinColor(skin: string, t: number): string {
  const c = skinDef(skin).color;
  if (c === 'rainbow') return `hsl(${(t * 90) % 360},85%,58%)`;
  if (c === 'chrome') return `hsl(210,12%,${70 + Math.sin(t * 3) * 12}%)`;
  return c;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const fmtTime = (s: number) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface ViewState {
  input: Input;
  showScores: boolean;
  ping: number | null;
  fps: number;
  showFps: boolean;
  online: boolean;
  hud?: boolean;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  W = 0;
  H = 0;
  zoom = 1;
  cam = { x: 0, y: 0 };
  safe = { l: 0, r: 0, t: 0, b: 0 };
  private pattern: CanvasPattern | null = null;
  private mini: HTMLCanvasElement | null = null;
  private miniScale = 0.1;
  private map: GameMap | null = null;
  private theme: Theme = THEMES.lager;
  private time = 0;
  private camTarget: Player | null = null;
  private zoomCur = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize() {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    const probe = document.getElementById('safe-probe');
    if (probe) {
      const cs = getComputedStyle(probe);
      this.safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    }
  }

  get small() {
    return Math.min(this.W, this.H) < 500;
  }

  setMap(map: GameMap) {
    this.map = map;
    this.theme = THEMES[map.theme];
    this.pattern = this.makePattern(map.theme);
    // minimap base
    const mw = this.small ? 132 : 190;
    this.miniScale = mw / map.w;
    const c = document.createElement('canvas');
    c.width = Math.round(map.w * this.miniScale * 2);
    c.height = Math.round(map.h * this.miniScale * 2);
    const x = c.getContext('2d')!;
    x.scale(this.miniScale * 2, this.miniScale * 2);
    x.fillStyle = this.theme.floor2;
    x.fillRect(0, 0, map.w, map.h);
    x.fillStyle = shade(this.theme.bush, -0.1);
    x.globalAlpha = 0.6;
    for (const b of map.bushes) { x.beginPath(); x.arc(b.x, b.y, b.r, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    for (const s of map.solids) {
      if (s.kind === 'wall') { x.fillStyle = this.theme.wallEdge; x.fillRect(s.x, s.y, s.w, s.h); }
      else if (s.kind === 'rock') { x.fillStyle = this.theme.rock; x.beginPath(); x.arc(s.cx, s.cy, s.r, 0, 7); x.fill(); }
    }
    this.mini = c;
    this.camTarget = null;
  }

  private makePattern(theme: MapId): CanvasPattern | null {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d')!;
    const t = THEMES[theme];
    x.fillStyle = t.floor;
    x.fillRect(0, 0, S, S);
    if (theme === 'lager') {
      x.fillStyle = t.floor2;
      x.fillRect(0, 0, 128, 128);
      x.fillRect(128, 128, 128, 128);
      x.strokeStyle = t.line;
      x.lineWidth = 3;
      x.strokeRect(1.5, 1.5, 125, 125);
      x.strokeRect(129.5, 129.5, 125, 125);
      x.strokeRect(129.5, 1.5, 125, 125);
      x.strokeRect(1.5, 129.5, 125, 125);
      for (let i = 0; i < 260; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
        x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
      x.fillStyle = 'rgba(0,0,0,0.07)';
      x.beginPath(); x.ellipse(180, 60, 26, 14, 0.5, 0, 7); x.fill();
    } else if (theme === 'wald') {
      for (let i = 0; i < 6; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(0,40,0,0.08)' : 'rgba(255,255,160,0.05)';
        x.beginPath(); x.arc(Math.random() * S, Math.random() * S, 20 + Math.random() * 40, 0, 7); x.fill();
      }
      x.lineWidth = 2;
      for (let i = 0; i < 420; i++) {
        const px = Math.random() * S, py = Math.random() * S;
        x.strokeStyle = Math.random() < 0.6 ? 'rgba(20,60,15,0.35)' : 'rgba(150,210,100,0.25)';
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.random() * 4 - 2, py - 4 - Math.random() * 4); x.stroke();
      }
      for (let i = 0; i < 6; i++) {
        x.fillStyle = ['#f5e663', '#ffffff', '#e86fb0'][i % 3];
        x.beginPath(); x.arc(Math.random() * S, Math.random() * S, 1.8, 0, 7); x.fill();
      }
    } else {
      x.strokeStyle = t.line;
      x.lineWidth = 2;
      for (let row = 0; row < 9; row++) {
        x.beginPath();
        for (let px = 0; px <= S; px += 8) {
          const py = row * 30 + 10 + Math.sin((px / S) * Math.PI * 2 * 2 + row) * 5;
          if (px === 0) x.moveTo(px, py); else x.lineTo(px, py);
        }
        x.stroke();
      }
      for (let i = 0; i < 160; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(120,80,30,0.12)' : 'rgba(255,255,230,0.12)';
        x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  /** Screen position of a world point. */
  toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.zoom + this.W / 2, y: (y - this.cam.y) * this.zoom + this.H / 2 };
  }

  private baseZoom(w: WeaponId | null) {
    const W = this.W, H = this.H;
    const portrait = H > W;
    const tw = portrait ? 760 : 1400;
    const th = portrait ? 1350 : H < 500 ? 640 : 790;
    let z = Math.min(W / tw, H / th);
    if (w === 'sniper' || w === 'rail') z *= 0.8;
    return z;
  }

  updateCamera(g: Game, dt: number, input: Input, follow?: Player) {
    const me = g.local;
    let target: Player | null = follow ?? me ?? null;
    if (me && !me.alive) {
      // spectate a team mate in coop modes, otherwise stay where we died
      if (g.settings.mode === 'survival') target = g.list.find((p) => !p.bot && p.alive) ?? me;
      else if (me.killedBy && me.respawnT < 2.2) target = g.players.get(me.killedBy) ?? me;
    }
    if (!target) return;
    const zt = this.baseZoom(me?.alive ? me.wid : null);
    this.zoomCur += (zt - this.zoomCur) * Math.min(1, dt * 4);
    this.zoom = this.zoomCur;
    let lx = 0, ly = 0;
    if (target === me && me.alive) {
      if (!input.touchMode && input.mouse.seen) {
        lx = (input.mouse.x - this.W / 2) / this.zoom * 0.22;
        ly = (input.mouse.y - this.H / 2) / this.zoom * 0.22;
      } else if (input.aimStick.id !== null) {
        lx = Math.cos(me.aim) * 110;
        ly = Math.sin(me.aim) * 110;
      }
    }
    const tx = target.x + lx, ty = target.y + ly;
    if (this.camTarget !== target || dist(this.cam.x, this.cam.y, tx, ty) > 1500) {
      this.cam.x = tx; this.cam.y = ty;
    } else {
      const k = Math.min(1, dt * 9);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    this.camTarget = target;
  }

  render(g: Game, fx: Fx, view: ViewState, dt: number) {
    this.time += dt;
    const ctx = this.ctx;
    const map = g.map;
    if (map !== this.map) this.setMap(map);
    const th = this.theme;
    const { W, H, dpr } = this;
    const z = this.zoom;
    const shake = fx.shake;
    const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    const camX = this.cam.x + sx / z, camY = this.cam.y + sy / z;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - camX * z), dpr * (H / 2 - camY * z));
    const vx0 = camX - W / 2 / z - 60, vy0 = camY - H / 2 / z - 60;
    const vx1 = camX + W / 2 / z + 60, vy1 = camY + H / 2 / z + 60;
    const inView = (x: number, y: number, r: number) => x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;

    // floor
    ctx.fillStyle = this.pattern ?? th.floor;
    const fx0 = Math.max(0, vx0), fy0 = Math.max(0, vy0);
    ctx.fillRect(fx0, fy0, Math.min(map.w, vx1) - fx0, Math.min(map.h, vy1) - fy0);

    // decals (scorch marks)
    for (const d of map.decals) {
      if (!inView(d.x, d.y, d.r)) continue;
      ctx.fillStyle = d.t ? 'rgba(20,10,5,0.35)' : 'rgba(60,35,10,0.22)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r, d.r * 0.8, d.a, 0, 7);
      ctx.fill();
    }

    // pickups
    for (const pk of g.pickups) {
      if (!inView(pk.x, pk.y, 40)) continue;
      this.drawPickup(pk.x, pk.y, pk.kind, pk.w, pk.on);
    }

    // solids: shadows then bodies
    const visibleSolids = map.query(vx0, vy0, vx1, vy1).slice();
    ctx.fillStyle = th.shadow;
    for (const s of visibleSolids) {
      if (s.round) { ctx.beginPath(); ctx.arc(s.cx + 6, s.cy + 8, s.r, 0, 7); ctx.fill(); }
      else if (s.kind === 'barrel') { ctx.beginPath(); ctx.arc(s.cx + 5, s.cy + 7, s.w / 2, 0, 7); ctx.fill(); }
      else ctx.fillRect(s.x + 6, s.y + 8, s.w, s.h);
    }
    for (const s of visibleSolids) this.drawSolid(s);

    // bullets (under players)
    for (const b of g.bullets) {
      if (!inView(b.x, b.y, 40)) continue;
      const def = WEAPONS[b.w];
      if (def.kind === 'flame') {
        const k = b.travelled / b.range;
        const r = 7 + k * 26;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, 0.55 * (1 - k));
        ctx.fillStyle = k < 0.3 ? '#ffd76a' : k < 0.6 ? '#ff8a1e' : '#d6341c';
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else if (def.kind === 'rocket') {
        const a = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillStyle = Math.random() < 0.5 ? '#ffd76a' : '#ff8a1e';
        ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-22 - Math.random() * 8, 0); ctx.lineTo(-10, 4); ctx.fill();
        ctx.fillStyle = '#d9d9d9';
        ctx.fillRect(-11, -4, 16, 8);
        ctx.fillStyle = '#c33';
        ctx.beginPath(); ctx.moveTo(5, -4); ctx.lineTo(11, 0); ctx.lineTo(5, 4); ctx.fill();
        ctx.restore();
      } else {
        const len = def.id === 'sniper' ? 0.03 : 0.02;
        const tx = b.x - b.vx * Math.min(len, b.age + 0.004), ty = b.y - b.vy * Math.min(len, b.age + 0.004);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,200,90,0.35)';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }

    // players
    const me = g.local;
    const viewer = me;
    const drawn: Player[] = [];
    for (const p of g.list) {
      if (!p.alive || !inView(p.x, p.y, 60)) continue;
      if (!g.visibleTo(viewer, p)) continue;
      const hidden = !!map.bushAt(p.x, p.y);
      this.drawPlayer(p, hidden ? 0.55 : 1, g, p === me);
      drawn.push(p);
    }

    // bushes on top of players
    const meInBush = me && me.alive ? map.bushAt(me.x, me.y) : null;
    for (const b of map.bushes) {
      if (!inView(b.x, b.y, b.r + 20)) continue;
      this.drawBush(b.x, b.y, b.r, b.seed, b === meInBush ? 0.45 : 0.94);
    }

    // muzzle flashes
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fx.flashes) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.a);
      ctx.globalAlpha = f.life / 0.06;
      ctx.fillStyle = '#ffe9a0';
      const s = 14 * f.size;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.35); ctx.lineTo(s * 1.6, 0); ctx.lineTo(0, s * 0.35); ctx.fill();
      ctx.fillStyle = 'rgba(255,170,60,0.6)';
      ctx.beginPath(); ctx.arc(2, 0, s * 0.55, 0, 7); ctx.fill();
      ctx.restore();
    }
    // beams
    for (const bm of fx.beams) {
      const k = bm.life / 0.3;
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#3fe9ff';
      ctx.lineWidth = 10 * k;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bm.x, bm.y); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.moveTo(bm.x, bm.y); ctx.lineTo(bm.x2, bm.y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // particles
    this.drawParticles(fx, inView);

    // sniper laser for the local player
    if (me && me.alive && (me.wid === 'sniper' || me.wid === 'rail')) {
      const L = 1400;
      const ex = me.x + Math.cos(me.aim) * L, ey = me.y + Math.sin(me.aim) * L;
      const hit = map.raycast(me.x, me.y, ex, ey, me.wid === 'rail' ? (s) => s.kind !== 'crate' && s.kind !== 'barrel' : null);
      ctx.strokeStyle = me.wid === 'rail' ? 'rgba(63,233,255,0.35)' : 'rgba(255,60,60,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(me.x + Math.cos(me.aim) * 30, me.y + Math.sin(me.aim) * 30);
      ctx.lineTo(me.x + (ex - me.x) * hit.t, me.y + (ey - me.y) * hit.t);
      ctx.stroke();
    }

    // ------------------------------------------------------------ screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawNameTags(g, drawn);
    for (const t of fx.texts) {
      const p = this.toScreen(t.x, t.y);
      ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
      ctx.font = `800 ${t.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(t.text, p.x, p.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    if (view.hud !== false) this.drawHud(g, fx, view);
  }

  // ------------------------------------------------------------ menu previews

  private withCanvas(c: HTMLCanvasElement, fn: (x: CanvasRenderingContext2D) => void) {
    const saved = this.ctx;
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    this.ctx = x;
    try {
      fn(x);
    } finally {
      this.ctx = saved;
      x.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  avatar(c: HTMLCanvasElement, skin: string, hat: string, wid: WeaponId, aim = 0.55, t = 0) {
    this.withCanvas(c, (x) => {
      const s = c.width / 78;
      x.setTransform(s, 0, 0, s, c.width / 2 - 4 * s, c.height / 2);
      const fake = {
        x: 0, y: 0, r: 18, aim, skin, hat, wid, team: -1, boss: false, lastHurtAt: -9, protectT: 0, reloading: false,
        slots: [], cur: 0,
      } as unknown as Player;
      const saveT = this.time;
      this.time = t;
      this.drawPlayer(fake, 1, { time: 0 } as Game, false);
      this.time = saveT;
    });
  }

  gunIcon(c: HTMLCanvasElement, w: WeaponId) {
    this.withCanvas(c, (x) => {
      const s = c.height / 22;
      const L = (WEAPONS[w].len + 10) * 1.0;
      x.setTransform(s, 0, 0, s, c.width / 2 - (L * s) / 2, c.height / 2);
      this.drawGun(w, 0, 1, true);
    });
  }

  // ------------------------------------------------------------ world pieces

  private drawSolid(s: Solid) {
    const ctx = this.ctx;
    const th = this.theme;
    if (s.kind === 'wall') {
      ctx.fillStyle = th.wallEdge;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = th.wall;
      ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
      ctx.fillStyle = th.wallTop;
      ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, Math.min(5, s.h - 6));
      if (this.map?.theme === 'lager' && s.w > 40 && s.h > 20 && s.h < 40) {
        ctx.fillStyle = 'rgba(255,200,0,0.25)';
        for (let x = s.x + 10; x < s.x + s.w - 20; x += 40) ctx.fillRect(x, s.y + s.h / 2 - 2, 18, 4);
      }
      return;
    }
    if (s.kind === 'rock') {
      if (this.map?.theme === 'wald') {
        ctx.fillStyle = shade(th.rock, -0.25);
        ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, 7); ctx.fill();
        ctx.fillStyle = th.rock;
        ctx.beginPath(); ctx.arc(s.cx - s.r * 0.12, s.cy - s.r * 0.12, s.r * 0.86, 0, 7); ctx.fill();
        ctx.fillStyle = th.rock2;
        ctx.beginPath(); ctx.arc(s.cx - s.r * 0.3, s.cy - s.r * 0.3, s.r * 0.45, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(s.cx - s.r * 0.38, s.cy - s.r * 0.4, s.r * 0.2, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = shade(th.rock, -0.3);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + s.id;
          const rr2 = s.r * (0.85 + ((s.id * 7 + i * 13) % 10) / 50);
          ctx.lineTo(s.cx + Math.cos(a) * rr2, s.cy + Math.sin(a) * rr2);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = th.rock2;
        ctx.beginPath(); ctx.arc(s.cx - s.r * 0.2, s.cy - s.r * 0.25, s.r * 0.55, 0, 7); ctx.fill();
      }
      return;
    }
    if (s.kind === 'barrel') {
      const r = s.w / 2;
      ctx.fillStyle = '#8f1f14';
      ctx.beginPath(); ctx.arc(s.cx, s.cy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#d9412b';
      ctx.beginPath(); ctx.arc(s.cx, s.cy, r - 3, 0, 7); ctx.fill();
      ctx.strokeStyle = '#8f1f14';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.cx, s.cy, r * 0.62, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.moveTo(s.cx, s.cy - 7); ctx.lineTo(s.cx + 7, s.cy + 5); ctx.lineTo(s.cx - 7, s.cy + 5); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(s.cx - 1, s.cy - 3, 2, 5);
      if (s.hp < s.maxHp) { ctx.fillStyle = 'rgba(255,150,0,0.35)'; ctx.beginPath(); ctx.arc(s.cx, s.cy, r * (1 - s.hp / s.maxHp), 0, 7); ctx.fill(); }
      return;
    }
    if (s.kind === 'steel') {
      ctx.fillStyle = '#3e4652';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#7b8794';
      ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
      ctx.fillStyle = '#95a1ad';
      ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, 4);
      ctx.strokeStyle = '#5b6573';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 9, s.y + 9, s.w - 18, s.h - 18);
      ctx.fillStyle = '#4b5563';
      for (const [dx, dy] of [[7, 7], [s.w - 7, 7], [7, s.h - 7], [s.w - 7, s.h - 7]]) { ctx.beginPath(); ctx.arc(s.x + dx, s.y + dy, 2, 0, 7); ctx.fill(); }
      return;
    }
    // wooden crate
    const dmg = 1 - s.hp / s.maxHp;
    ctx.fillStyle = '#6b431c';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = dmg > 0.5 ? '#9a6735' : '#b07a3f';
    ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
    ctx.strokeStyle = '#7a4f22';
    ctx.lineWidth = 4;
    ctx.strokeRect(s.x + 5, s.y + 5, s.w - 10, s.h - 10);
    ctx.beginPath();
    ctx.moveTo(s.x + 7, s.y + 7); ctx.lineTo(s.x + s.w - 7, s.y + s.h - 7);
    ctx.moveTo(s.x + s.w - 7, s.y + 7); ctx.lineTo(s.x + 7, s.y + s.h - 7);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,230,180,0.18)';
    ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, 3);
    if (dmg > 0.25) {
      ctx.strokeStyle = 'rgba(40,20,5,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x + s.w * 0.2, s.y + s.h * 0.1); ctx.lineTo(s.x + s.w * 0.35, s.y + s.h * 0.4); ctx.lineTo(s.x + s.w * 0.3, s.y + s.h * 0.6);
      if (dmg > 0.6) { ctx.moveTo(s.x + s.w * 0.85, s.y + s.h * 0.7); ctx.lineTo(s.x + s.w * 0.6, s.y + s.h * 0.75); ctx.lineTo(s.x + s.w * 0.55, s.y + s.h * 0.95); }
      ctx.stroke();
    }
  }

  private drawBush(x: number, y: number, r: number, seed: number, alpha: number) {
    const ctx = this.ctx;
    const th = this.theme;
    ctx.globalAlpha = alpha;
    const n = 7;
    const blob = (rad: number, color: string, ox = 0, oy = 0) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, rad * 0.78, 0, 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + seed;
        const d = rad * 0.55;
        ctx.moveTo(x + ox + Math.cos(a) * d + rad * 0.42, y + oy + Math.sin(a) * d);
        ctx.arc(x + ox + Math.cos(a) * d, y + oy + Math.sin(a) * d, rad * 0.42, 0, 7);
      }
      ctx.fill();
    };
    blob(r + 3, th.bushEdge);
    blob(r - 2, th.bush);
    blob(r * 0.55, th.bush2, -r * 0.18, -r * 0.2);
    if (this.map?.theme === 'lager') {
      // camouflage net pattern, clipped to the net
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.92, 0, 7);
      ctx.clip();
      ctx.strokeStyle = 'rgba(30,40,20,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = -4; i <= 4; i++) {
        ctx.moveTo(x + i * r * 0.28 - r, y - r); ctx.lineTo(x + i * r * 0.28 + r, y + r);
        ctx.moveTo(x + i * r * 0.28 + r, y - r); ctx.lineTo(x + i * r * 0.28 - r, y + r);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.2, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawPickup(x: number, y: number, kind: string, w: WeaponId | null, on: boolean) {
    const ctx = this.ctx;
    const t = this.time;
    const col = kind === 'health' ? '#3ddc84' : kind === 'armor' ? '#4aa3ff' : '#ffc94a';
    ctx.globalAlpha = on ? 1 : 0.25;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -t * 12;
    ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    if (!on) { ctx.globalAlpha = 1; return; }
    const bob = Math.sin(t * 3 + x) * 3;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.18 + Math.sin(t * 4) * 0.06;
    ctx.beginPath(); ctx.arc(x, y + bob, 22, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const cy = y + bob;
    if (kind === 'health') {
      ctx.fillStyle = '#fff';
      rr(ctx, x - 12, cy - 12, 24, 24, 5); ctx.fill();
      ctx.fillStyle = '#e53935';
      ctx.fillRect(x - 3.5, cy - 8, 7, 16);
      ctx.fillRect(x - 8, cy - 3.5, 16, 7);
    } else if (kind === 'armor') {
      ctx.fillStyle = '#2f7fd8';
      ctx.beginPath();
      ctx.moveTo(x, cy - 13); ctx.lineTo(x + 11, cy - 8); ctx.lineTo(x + 9, cy + 5); ctx.lineTo(x, cy + 13); ctx.lineTo(x - 9, cy + 5); ctx.lineTo(x - 11, cy - 8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 2; ctx.stroke();
    } else if (w) {
      ctx.save();
      ctx.translate(x - 14, cy);
      this.drawGun(w, 0, 0.9, true);
      ctx.restore();
    }
  }

  /** Gun in local coords: x forward. */
  /** Gun in local coords (x forward). outline=true adds a light rim for icons on dark backgrounds. */
  private drawGun(w: WeaponId, x0: number, scale = 1, outline = false) {
    if (outline) {
      const ctx = this.ctx;
      for (const [dx, dy] of [[-1.3, 0], [1.3, 0], [0, -1.3], [0, 1.3]]) {
        ctx.translate(dx, dy);
        this.gunShape(w, x0, scale, 'rgba(225,232,242,0.6)');
        ctx.translate(-dx, -dy);
      }
    }
    this.gunShape(w, x0, scale);
  }

  private gunShape(w: WeaponId, x0: number, scale: number, mono?: string) {
    const ctx = this.ctx;
    const c = (col: string) => mono ?? col;
    const def = WEAPONS[w];
    const L = (def.len + 10) * scale, T = def.thick * scale;
    switch (w) {
      case 'rocket':
        ctx.fillStyle = c('#4f5d33'); rr(ctx, x0, -T / 2, L, T, 3); ctx.fill();
        ctx.fillStyle = c('#2f3820'); ctx.fillRect(x0 + L - 5 * scale, -T / 2 - 1, 5 * scale, T + 2);
        break;
      case 'rail':
        ctx.fillStyle = c('#20262e'); rr(ctx, x0, -T / 2, L, T, 2); ctx.fill();
        ctx.fillStyle = c('#3fe9ff'); ctx.fillRect(x0 + 4 * scale, -1.5, L - 8 * scale, 3);
        break;
      case 'flamer':
        ctx.fillStyle = c('#b3261e'); rr(ctx, x0, -T / 2, L * 0.5, T, 4); ctx.fill();
        ctx.fillStyle = c('#2b2f36'); ctx.fillRect(x0 + L * 0.45, -3 * scale, L * 0.55, 6 * scale);
        break;
      case 'minigun':
        ctx.fillStyle = c('#2b2f36'); rr(ctx, x0, -T / 2, L * 0.45, T, 3); ctx.fill();
        ctx.fillStyle = c('#4b525c');
        for (const o of [-T * 0.3, 0, T * 0.3]) ctx.fillRect(x0 + L * 0.4, o - 1.5 * scale, L * 0.6, 3 * scale);
        break;
      case 'shotgun':
        ctx.fillStyle = c('#7a4f22'); ctx.fillRect(x0, -T / 2, L * 0.4, T);
        ctx.fillStyle = c('#2b2f36'); ctx.fillRect(x0 + L * 0.35, -T * 0.35, L * 0.65, T * 0.7);
        break;
      case 'sniper':
        ctx.fillStyle = c('#2b2f36'); ctx.fillRect(x0, -T / 2, L, T);
        ctx.fillStyle = c('#111'); ctx.fillRect(x0 + L * 0.25, -T / 2 - 2, L * 0.3, T + 4);
        break;
      default:
        ctx.fillStyle = c('#2b2f36'); rr(ctx, x0, -T / 2, L, T, 2); ctx.fill();
        ctx.fillStyle = c('#4b525c'); ctx.fillRect(x0 + 2, -T / 2, L - 4, 2);
    }
  }

  private drawPlayer(p: Player, alpha: number, g: Game, isMe: boolean) {
    const ctx = this.ctx;
    const t = this.time;
    const r = p.r;
    const color = skinColor(p.skin, t);
    const hurt = g.time - p.lastHurtAt < 0.09;
    ctx.globalAlpha = alpha;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 7, r, r * 0.9, 0, 0, 7); ctx.fill();
    if (p.boss) {
      ctx.fillStyle = 'rgba(255,40,40,0.18)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 10 + Math.sin(t * 6) * 3, 0, 7); ctx.fill();
    }
    // gun + hands
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);
    this.drawGun(p.wid, r * 0.35, p.boss ? 1.3 : 1);
    const handC = shade(color, -0.25);
    ctx.fillStyle = handC;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    const def = WEAPONS[p.wid];
    ctx.beginPath(); ctx.arc(r * 0.78, def.thick * 0.35 + 2, r * 0.3, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 0.78 + def.len * 0.5, -def.thick * 0.2, r * 0.28, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
    // body
    const outline = p.team === 0 || p.team === 1 ? TEAM_COLORS[p.team] : shade(color, -0.45);
    ctx.fillStyle = outline;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = hurt ? '#ffffff' : color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.35, r * 0.42, 0, 7); ctx.fill();
    // hat (back layer)
    const back = ['cap', 'band', 'horns', 'tophat', 'viking', 'crown', 'ninja', 'fire'];
    if (back.includes(p.hat)) this.drawHat(p, color);
    // eyes
    const ea = p.aim;
    for (const side of [-1, 1]) {
      const a = ea + side * 0.5;
      const ex = p.x + Math.cos(a) * r * 0.5, ey = p.y + Math.sin(a) * r * 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.22, 0, 7); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(ex + Math.cos(ea) * r * 0.08, ey + Math.sin(ea) * r * 0.08, r * 0.11, 0, 7); ctx.fill();
    }
    if (!back.includes(p.hat)) this.drawHat(p, color);
    // spawn protection bubble
    if (p.protectT > 0) {
      ctx.strokeStyle = `rgba(150,230,255,${0.5 + Math.sin(t * 14) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 8, 0, 7); ctx.stroke();
    }
    // reload ring for me
    if (isMe && p.reloading) {
      const slot = p.slots[p.cur];
      if (slot && slot.reloadTotal > 0) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - slot.reloadT / slot.reloadTotal));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawHat(p: Player, color: string) {
    const ctx = this.ctx;
    const r = p.r;
    const t = this.time;
    const a = p.aim;
    const bx = p.x - Math.cos(a) * r * 0.22, by = p.y - Math.sin(a) * r * 0.22;
    switch (p.hat) {
      case 'cap': {
        ctx.fillStyle = '#e63946';
        ctx.beginPath(); ctx.arc(bx, by, r * 0.72, 0, 7); ctx.fill();
        ctx.fillStyle = '#b71c2b';
        ctx.beginPath(); ctx.ellipse(p.x + Math.cos(a) * r * 0.42, p.y + Math.sin(a) * r * 0.42, r * 0.28, r * 0.62, a, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 2, 0, 7); ctx.fill();
        break;
      }
      case 'band':
      case 'ninja': {
        const c = p.hat === 'band' ? '#e63946' : '#15171c';
        ctx.strokeStyle = c;
        ctx.lineWidth = r * 0.28;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.84, 0, 7); ctx.stroke();
        ctx.lineWidth = r * 0.16;
        const tx = p.x - Math.cos(a) * r, ty = p.y - Math.sin(a) * r;
        for (const s of [-1, 1]) {
          const wv = Math.sin(t * 8 + s) * 4;
          ctx.beginPath(); ctx.moveTo(tx, ty);
          ctx.lineTo(tx - Math.cos(a + s * 0.4) * r * 0.8 + wv, ty - Math.sin(a + s * 0.4) * r * 0.8 + wv);
          ctx.stroke();
        }
        break;
      }
      case 'horns':
      case 'viking': {
        if (p.hat === 'viking') {
          ctx.fillStyle = '#8d939c';
          ctx.beginPath(); ctx.arc(bx, by, r * 0.75, 0, 7); ctx.fill();
          ctx.fillStyle = '#b0b6bf';
          ctx.fillRect(bx - 2, by - r * 0.7, 4, r * 1.4);
        }
        ctx.fillStyle = p.hat === 'viking' ? '#f3ead2' : '#c62828';
        for (const s of [-1, 1]) {
          const ha = a + s * Math.PI / 2;
          const hx = p.x + Math.cos(ha) * r * 0.75, hy = p.y + Math.sin(ha) * r * 0.75;
          ctx.beginPath();
          ctx.moveTo(hx + Math.cos(a) * 5, hy + Math.sin(a) * 5);
          ctx.lineTo(hx + Math.cos(ha) * r * 0.75 - Math.cos(a) * 4, hy + Math.sin(ha) * r * 0.75 - Math.sin(a) * 4);
          ctx.lineTo(hx - Math.cos(a) * 5, hy - Math.sin(a) * 5);
          ctx.fill();
        }
        break;
      }
      case 'tophat': {
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(bx, by, r * 0.82, 0, 7); ctx.fill();
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath(); ctx.arc(bx, by, r * 0.52, 0, 7); ctx.fill();
        ctx.strokeStyle = '#c62828'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(bx, by, r * 0.56, 0, 7); ctx.stroke();
        break;
      }
      case 'crown': {
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const an = (i / 10) * Math.PI * 2 + t * 0.5;
          const rad = i % 2 ? r * 0.38 : r * 0.68;
          ctx.lineTo(bx + Math.cos(an) * rad, by + Math.sin(an) * rad);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(bx, by, 3, 0, 7); ctx.fill();
        break;
      }
      case 'fire': {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 6; i++) {
          const an = a + Math.PI + (i - 2.5) * 0.35;
          const fl = r * (0.7 + Math.sin(t * 15 + i * 2) * 0.2);
          ctx.fillStyle = i % 2 ? 'rgba(255,140,30,0.75)' : 'rgba(255,220,80,0.7)';
          ctx.beginPath(); ctx.arc(p.x + Math.cos(an) * fl, p.y + Math.sin(an) * fl, r * 0.35, 0, 7); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'party': {
        const cx = p.x, cy = p.y - r * 0.2;
        ctx.fillStyle = '#7b2ff7';
        ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy); ctx.lineTo(cx, cy - r * 1.35); ctx.lineTo(cx + r * 0.45, cy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx - r * 0.3, cy - r * 0.35); ctx.lineTo(cx + r * 0.3, cy - r * 0.35); ctx.moveTo(cx - r * 0.15, cy - r * 0.8); ctx.lineTo(cx + r * 0.15, cy - r * 0.8); ctx.stroke();
        ctx.fillStyle = '#ff4d8d'; ctx.beginPath(); ctx.arc(cx, cy - r * 1.35, 4, 0, 7); ctx.fill();
        break;
      }
      case 'antenna': {
        const cx = p.x, cy = p.y;
        const bob = Math.sin(t * 5) * 3;
        ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.3); ctx.quadraticCurveTo(cx + 6, cy - r, cx + bob, cy - r * 1.5); ctx.stroke();
        ctx.fillStyle = `hsl(${(t * 200) % 360},90%,60%)`;
        ctx.beginPath(); ctx.arc(cx + bob, cy - r * 1.5, 4.5, 0, 7); ctx.fill();
        break;
      }
      case 'halo': {
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = 3.5;
        ctx.globalAlpha *= 0.9;
        ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 1.05 + Math.sin(t * 3) * 2, r * 0.7, r * 0.25, 0, 0, 7); ctx.stroke();
        break;
      }
      default:
        void color;
    }
  }

  private drawParticles(fx: Fx, inView: (x: number, y: number, r: number) => boolean) {
    const ctx = this.ctx;
    for (const p of fx.particles) {
      if (!inView(p.x, p.y, p.size + 10)) continue;
      const k = p.life / p.max;
      switch (p.kind) {
        case 'spark':
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = k;
          ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          break;
        case 'fire':
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = k * 0.8;
          ctx.fillStyle = k > 0.6 ? '#ffe28a' : k > 0.3 ? '#ff9a3c' : '#c8401c';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        case 'glow': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = k * 0.7;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'smoke':
          ctx.globalAlpha = k * 0.35;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
          break;
        case 'ring':
          ctx.globalAlpha = k * 0.8;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.stroke();
          break;
        case 'debris':
        case 'shell':
        case 'chip':
          ctx.globalAlpha = Math.min(1, k * 2);
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        default:
          ctx.globalAlpha = Math.min(1, k * 1.5);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ screen-space

  private drawNameTags(g: Game, drawn: Player[]) {
    const ctx = this.ctx;
    const me = g.local;
    ctx.textAlign = 'center';
    const fs = this.small ? 11 : 12;
    for (const p of drawn) {
      const s = this.toScreen(p.x, p.y);
      const top = s.y - (p.r + 16) * this.zoom - 8;
      const isMe = p === me;
      const friendly = isMe || (me && sameTeam(p, me));
      // hp bar
      const bw = p.boss ? 70 : 42;
      const ratio = Math.max(0, p.hp / p.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(s.x - bw / 2 - 1, top + 3, bw + 2, 6);
      ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#facc15' : '#ef4444';
      if (!friendly && g.settings.mode !== 'survival') ctx.fillStyle = ratio > 0.25 ? '#f87171' : '#ef4444';
      ctx.fillRect(s.x - bw / 2, top + 4, bw * ratio, 4);
      if (p.armor > 0) {
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(s.x - bw / 2, top + 9, (bw * Math.min(100, p.armor)) / 100, 2);
      }
      if (isMe) continue;
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      const label = p.level > 0 ? `${p.name}  ${p.level}` : p.name;
      ctx.strokeText(label, s.x, top - 1);
      ctx.fillStyle = p.team === 0 ? '#9fd2ff' : p.team === 1 ? '#ffadad' : p.bot ? '#e5e7eb' : '#ffe08a';
      ctx.fillText(label, s.x, top - 1);
    }
  }

  private panel(x: number, y: number, w: number, h: number, r = 10) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,14,24,0.62)';
    rr(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawHud(g: Game, fx: Fx, view: ViewState) {
    const ctx = this.ctx;
    const { W, H } = this;
    const me = g.local;
    const small = this.small;
    const touch = view.input.touchMode;
    const sl = this.safe.l + 10, sr = this.safe.r + 10;

    // hurt vignette
    if (fx.hurt > 0.02 || (me && me.alive && me.hp / me.maxHp < 0.3)) {
      const low = me && me.alive && me.hp / me.maxHp < 0.3 ? 0.25 + Math.sin(this.time * 6) * 0.1 : 0;
      const a = Math.min(0.75, fx.hurt * 0.6 + low);
      const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      grd.addColorStop(0, 'rgba(200,0,0,0)');
      grd.addColorStop(1, `rgba(200,0,0,${a})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }

    // minimap
    if (this.mini) {
      const mw = this.mini.width / 2, mh = this.mini.height / 2;
      const mx = sl, my = 10 + this.safe.t;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.mini, mx, my, mw, mh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mx, my, mw, mh);
      const s = this.miniScale;
      ctx.fillStyle = '#8a6136';
      for (const so of g.map.solids) if ((so.kind === 'crate' || so.kind === 'steel') && so.hp > 0) ctx.fillRect(mx + so.x * s, my + so.y * s, Math.max(1.5, so.w * s), Math.max(1.5, so.h * s));
      for (const pk of g.pickups) {
        if (!pk.on) continue;
        ctx.fillStyle = pk.kind === 'health' ? '#3ddc84' : pk.kind === 'armor' ? '#4aa3ff' : '#ffc94a';
        ctx.fillRect(mx + pk.x * s - 1.5, my + pk.y * s - 1.5, 3, 3);
      }
      for (const p of g.list) {
        if (!p.alive || p === me) continue;
        const friendly = me && sameTeam(p, me);
        if (!friendly) {
          const recent = g.time - p.lastShotAt < 1.5;
          const near = me ? dist(p.x, p.y, me.x, me.y) < 650 && g.visibleTo(me, p) : false;
          if (!recent && !near) continue;
        }
        ctx.fillStyle = friendly ? '#7cc4ff' : p.boss ? '#ff2d2d' : '#ff6b6b';
        ctx.beginPath(); ctx.arc(mx + p.x * s, my + p.y * s, p.boss ? 4 : 2.6, 0, 7); ctx.fill();
      }
      if (me) {
        const px = mx + me.x * s, py = my + me.y * s;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(me.aim) * 8, py + Math.sin(me.aim) * 8); ctx.stroke();
        const vw = (W / this.zoom) * s, vh = (H / this.zoom) * s;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.strokeRect(mx + this.cam.x * s - vw / 2, my + this.cam.y * s - vh / 2, vw, vh);
      }
    }

    // mode info (top centre)
    this.drawModeBar(g);

    // kill feed (top right)
    {
      let y = 12 + this.safe.t + (touch ? 50 : 0);
      ctx.textAlign = 'right';
      ctx.font = `600 ${small ? 11 : 13}px system-ui, sans-serif`;
      for (const f of fx.feed) {
        const alpha = Math.min(1, f.t * 2);
        ctx.globalAlpha = alpha;
        let text = '';
        if (f.info) text = `${f.vn} ${f.info}`;
        else text = f.kn ? `${f.kn}  [${f.w}]  ${f.vn}` : `${f.vn} ist gestorben`;
        const w = ctx.measureText(text).width + 16;
        const x = W - sr;
        ctx.fillStyle = f.mine ? 'rgba(120,80,0,0.55)' : 'rgba(10,14,24,0.55)';
        rr(ctx, x - w, y, w, small ? 20 : 24, 6); ctx.fill();
        const ty = y + (small ? 14 : 17);
        if (f.info) { ctx.fillStyle = f.vc; ctx.fillText(text, x - 8, ty); }
        else if (!f.kn) {
          const tail = ' ist gestorben';
          ctx.fillStyle = '#ddd'; ctx.fillText(tail, x - 8, ty);
          ctx.fillStyle = f.vc; ctx.fillText(f.vn, x - 8 - ctx.measureText(tail).width, ty);
        } else {
          // coloured parts, right to left
          const mid = `  [${f.w}]  `;
          let cx = x - 8;
          ctx.fillStyle = f.vc; ctx.fillText(f.vn, cx, ty); cx -= ctx.measureText(f.vn).width;
          ctx.fillStyle = '#bbb'; ctx.fillText(mid, cx, ty); cx -= ctx.measureText(mid).width;
          ctx.fillStyle = f.kc; ctx.fillText(f.kn, cx, ty);
        }
        y += small ? 23 : 28;
      }
      ctx.globalAlpha = 1;
    }

    // health + weapon
    if (me) this.drawVitals(g, me, touch);

    // messages
    {
      let y = H * 0.24;
      ctx.textAlign = 'center';
      for (const m of fx.messages) {
        const k = m.life / m.max;
        const a = Math.min(1, k * 3, (1 - k) * 8 + 0.2);
        ctx.globalAlpha = a;
        ctx.font = `400 ${small ? 26 : 38}px 'Russo One', system-ui, sans-serif`;
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(m.text, W / 2, y);
        ctx.fillStyle = m.color;
        ctx.fillText(m.text, W / 2, y);
        if (m.sub) {
          ctx.font = `700 ${small ? 13 : 16}px system-ui, sans-serif`;
          ctx.lineWidth = 4;
          ctx.strokeText(m.sub, W / 2, y + (small ? 22 : 28));
          ctx.fillStyle = '#fff';
          ctx.fillText(m.sub, W / 2, y + (small ? 22 : 28));
        }
        y += small ? 50 : 66;
      }
      ctx.globalAlpha = 1;
    }

    // death screen
    if (me && !me.alive && !g.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.font = `400 ${small ? 30 : 44}px 'Russo One', system-ui, sans-serif`;
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('ELIMINIERT', W / 2, H * 0.42);
      ctx.font = `600 ${small ? 14 : 18}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      const killer = me.killedBy ? g.players.get(me.killedBy)?.name : null;
      ctx.fillText(killer ? `von ${killer}` : 'Selbst erwischt …', W / 2, H * 0.42 + (small ? 28 : 36));
      ctx.fillStyle = '#ffd166';
      const sub = g.settings.mode === 'survival' ? 'Du kommst nach der Welle zurück – du schaust deinem Team zu.' : `Respawn in ${Math.max(0, me.respawnT).toFixed(1)} s`;
      ctx.fillText(sub, W / 2, H * 0.42 + (small ? 52 : 66));
    }

    // crosshair
    if (!touch && view.input.mouse.seen && me && me.alive) {
      const { x, y } = view.input.mouse;
      const gap = 6 + WEAPONS[me.wid].spread * 60 + fx.recoil;
      ctx.strokeStyle = fx.killMarker > 0 ? '#ff4d4d' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - gap - 8, y); ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + 8, y);
      ctx.moveTo(x, y - gap - 8); ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + 8);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      if (fx.hitMarker > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${fx.hitMarker / 0.15})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(x + dx * 7, y + dy * 7); ctx.lineTo(x + dx * 13, y + dy * 13); }
        ctx.stroke();
      }
    } else if (touch && fx.hitMarker > 0 && me) {
      const s = this.toScreen(me.x + Math.cos(me.aim) * 120, me.y + Math.sin(me.aim) * 120);
      ctx.strokeStyle = `rgba(255,255,255,${fx.hitMarker / 0.15})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(s.x + dx * 7, s.y + dy * 7); ctx.lineTo(s.x + dx * 13, s.y + dy * 13); }
      ctx.stroke();
    }

    if (touch) this.drawTouch(view.input, me);
    if (view.showScores || g.over) this.drawScoreboard(g);

    if (view.showFps || view.ping !== null) {
      ctx.textAlign = 'left';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const parts = [];
      if (view.showFps) parts.push(`${Math.round(view.fps)} FPS`);
      if (view.ping !== null) parts.push(`Ping ${Math.round(view.ping)} ms`);
      const mh = this.mini ? this.mini.height / 2 : 0;
      ctx.fillText(parts.join(' · '), sl, 10 + this.safe.t + mh + 16);
    }
  }

  private drawModeBar(g: Game) {
    const ctx = this.ctx;
    const { W } = this;
    const small = this.small;
    const s = g.settings;
    const me = g.local;
    const y = 10 + this.safe.t;
    ctx.textAlign = 'center';
    if (s.mode === 'team') {
      const w = small ? 200 : 260, h = small ? 40 : 50;
      this.panel(W / 2 - w / 2, y, w, h);
      ctx.font = `400 ${small ? 20 : 26}px 'Russo One', system-ui, sans-serif`;
      ctx.fillStyle = TEAM_COLORS[0];
      ctx.fillText(String(g.teamKills[0]), W / 2 - w * 0.3, y + h * 0.66);
      ctx.fillStyle = TEAM_COLORS[1];
      ctx.fillText(String(g.teamKills[1]), W / 2 + w * 0.3, y + h * 0.66);
      ctx.font = `700 ${small ? 12 : 14}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(fmtTime(g.timeLeft), W / 2, y + h * 0.45);
      ctx.font = `600 ${small ? 9 : 11}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`Ziel ${s.killLimit}`, W / 2, y + h * 0.82);
    } else if (s.mode === 'dm') {
      const w = small ? 210 : 270, h = small ? 40 : 50;
      this.panel(W / 2 - w / 2, y, w, h);
      const leader = [...g.list].sort((a, b) => b.kills - a.kills)[0];
      ctx.font = `700 ${small ? 12 : 14}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`${fmtTime(g.timeLeft)}  ·  Ziel ${s.killLimit} Kills`, W / 2, y + h * 0.42);
      ctx.font = `600 ${small ? 11 : 13}px system-ui, sans-serif`;
      ctx.fillStyle = '#ffd166';
      const lead = leader ? `👑 ${leader.name} ${leader.kills}` : '';
      ctx.fillText(`${lead}   ·   Du: ${me?.kills ?? 0}`, W / 2, y + h * 0.8);
    } else {
      const w = small ? 200 : 250, h = small ? 40 : 50;
      this.panel(W / 2 - w / 2, y, w, h);
      ctx.font = `400 ${small ? 17 : 22}px 'Russo One', system-ui, sans-serif`;
      ctx.fillStyle = '#ffd166';
      ctx.fillText(g.wave > 0 ? `WELLE ${g.wave}` : 'BEREIT MACHEN', W / 2, y + h * 0.5);
      ctx.font = `600 ${small ? 11 : 13}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      const sub = g.waveT > 0 ? `Nächste Welle in ${Math.ceil(g.waveT)} s` : `Gegner übrig: ${g.enemiesLeft}`;
      ctx.fillText(sub, W / 2, y + h * 0.86);
    }
  }

  private drawVitals(g: Game, me: Player, touch: boolean) {
    const ctx = this.ctx;
    const { W, H } = this;
    const small = this.small;
    const bottom = H - 12 - this.safe.b;
    const bw = small ? 170 : 250;
    const x = touch ? W / 2 - bw / 2 : 16 + this.safe.l;
    const y = bottom - (small ? 26 : 34);
    // health
    this.panel(x - 6, y - (small ? 24 : 30), bw + 12, (small ? 24 : 30) + (small ? 26 : 34), 10);
    const hpR = Math.max(0, me.hp / me.maxHp);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    rr(ctx, x, y, bw, small ? 14 : 18, 5); ctx.fill();
    ctx.fillStyle = hpR > 0.5 ? '#4ade80' : hpR > 0.25 ? '#facc15' : '#ef4444';
    if (hpR > 0) { rr(ctx, x, y, Math.max(8, bw * hpR), small ? 14 : 18, 5); ctx.fill(); }
    ctx.font = `800 ${small ? 11 : 13}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0b0f17';
    ctx.fillText(`${Math.ceil(Math.max(0, me.hp))} / ${me.maxHp}`, x + bw / 2, y + (small ? 11 : 14));
    if (me.armor > 0) {
      ctx.fillStyle = '#60a5fa';
      rr(ctx, x, y + (small ? 16 : 21), (bw * Math.min(100, me.armor)) / 100, 4, 2); ctx.fill();
    }
    // weapon + ammo
    const { slot, mag } = g.ammoInfo(me);
    if (!slot) return;
    const def = WEAPONS[slot.id];
    ctx.textAlign = 'left';
    ctx.font = `700 ${small ? 12 : 14}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    const ammoTxt = slot.reloadT > 0 ? 'Lädt nach …' : `${slot.ammo} / ${isFinite(slot.reserve) ? slot.reserve : '∞'}`;
    ctx.fillText(def.name, x, y - (small ? 9 : 11));
    ctx.textAlign = 'right';
    ctx.fillStyle = slot.ammo === 0 ? '#ef4444' : slot.ammo <= mag * 0.25 ? '#facc15' : '#ffd166';
    ctx.fillText(ammoTxt, x + bw, y - (small ? 9 : 11));
    // slots
    if (!touch) {
      const sx = W - 16 - this.safe.r;
      let cx = sx;
      ctx.textAlign = 'center';
      for (let i = me.slots.length - 1; i >= 0; i--) {
        const s = me.slots[i];
        const w = 96, h = 44;
        cx -= w;
        const active = i === me.cur;
        this.panel(cx, bottom - h, w - 6, h, 8);
        if (active) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; rr(ctx, cx, bottom - h, w - 6, h, 8); ctx.stroke(); }
        ctx.save();
        ctx.translate(cx + 14, bottom - h / 2 - 4);
        ctx.globalAlpha = active ? 1 : 0.55;
        this.drawGun(s.id, 0, 1, true);
        ctx.restore();
        ctx.globalAlpha = active ? 1 : 0.6;
        ctx.fillStyle = '#fff';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.fillText(`${i + 1} · ${s.pickup ? s.ammo + s.reserve : '∞'}`, cx + (w - 6) / 2, bottom - 6);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawTouch(input: Input, me: Player | undefined) {
    const ctx = this.ctx;
    const R = input.stickR;
    const drawStick = (s: Input['moveStick'], color: string) => {
      if (s.id === null) return;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.bx, s.by, R, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(s.x, s.y, R * 0.42, 0, 7); ctx.fill();
    };
    drawStick(input.moveStick, 'rgba(255,255,255,0.45)');
    drawStick(input.aimStick, input.aimStick.mag > 0.5 ? 'rgba(255,90,90,0.65)' : 'rgba(255,209,102,0.55)');
    // hints when idle
    if (input.moveStick.id === null) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.arc(this.safe.l + 110, this.H - 110 - this.safe.b, R, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LAUFEN', this.safe.l + 110, this.H - 106 - this.safe.b);
    }
    if (input.aimStick.id === null) {
      const x = this.W - 150 - this.safe.r, y = this.H - 110 - this.safe.b;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ZIELEN', x, y - 2);
      ctx.fillText('& FEUERN', x, y + 12);
    }
    for (const b of input.buttons) {
      const pressed = b.touch !== null;
      ctx.fillStyle = pressed ? 'rgba(255,209,102,0.45)' : 'rgba(10,14,24,0.5)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `700 ${b.r > 24 ? 12 : 13}px system-ui, sans-serif`;
      if (b.id === 'pause') { ctx.fillRect(b.x - 6, b.y - 7, 4, 14); ctx.fillRect(b.x + 2, b.y - 7, 4, 14); }
      else if (b.id === 'score') { ctx.fillRect(b.x - 8, b.y - 6, 16, 3); ctx.fillRect(b.x - 8, b.y - 1, 16, 3); ctx.fillRect(b.x - 8, b.y + 4, 16, 3); }
      else if (b.id === 'reload') {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.42, -0.3, Math.PI * 1.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x + b.r * 0.42, b.y - b.r * 0.42); ctx.lineTo(b.x + b.r * 0.42, b.y - 1); ctx.lineTo(b.x + b.r * 0.08, b.y - b.r * 0.2); ctx.fill();
      } else if (b.id === 'swap' && me) {
        const next = me.slots[(me.cur + 1) % me.slots.length];
        ctx.save();
        ctx.translate(b.x - b.r * 0.6, b.y - 2);
        this.drawGun(next?.id ?? 'pistol', 0, 0.75, true);
        ctx.restore();
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.fillText('WECHSELN', b.x, b.y + b.r * 0.62);
      }
    }
  }

  private drawScoreboard(g: Game) {
    const ctx = this.ctx;
    const { W, H } = this;
    const small = this.small;
    const rows = [...g.list]
      .filter((p) => !(g.settings.mode === 'survival' && p.bot))
      .sort((a, b) => (g.settings.mode === 'team' ? a.team - b.team : 0) || b.kills - a.kills || a.deaths - b.deaths);
    const rh = small ? 20 : 26;
    const w = Math.min(W - 40, 520);
    const h = 64 + rows.length * rh;
    const x = W / 2 - w / 2, y = Math.max(60, H / 2 - h / 2);
    this.panel(x, y, w, h, 14);
    ctx.textAlign = 'left';
    ctx.font = `400 ${small ? 15 : 18}px 'Russo One', system-ui, sans-serif`;
    ctx.fillStyle = '#ffd166';
    const title = g.settings.mode === 'team' ? `${TEAM_NAMES[0]} ${g.teamKills[0]} : ${g.teamKills[1]} ${TEAM_NAMES[1]}`
      : g.settings.mode === 'survival' ? `Überleben – Welle ${g.wave}` : 'Jeder gegen jeden';
    ctx.fillText(title, x + 16, y + 28);
    ctx.font = `600 ${small ? 10 : 12}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const cols = [w - 190, w - 125, w - 60];
    ctx.fillText('SPIELER', x + 16, y + 50);
    ctx.textAlign = 'right';
    ['KILLS', 'TODE', 'PUNKTE'].forEach((c, i) => ctx.fillText(c, x + cols[i] + 40, y + 50));
    rows.forEach((p, i) => {
      const ry = y + 56 + i * rh;
      if (p.id === g.localId) { ctx.fillStyle = 'rgba(255,209,102,0.12)'; ctx.fillRect(x + 6, ry, w - 12, rh); }
      ctx.textAlign = 'left';
      ctx.font = `600 ${small ? 11 : 13}px system-ui, sans-serif`;
      ctx.fillStyle = p.team === 0 ? '#9fd2ff' : p.team === 1 ? '#ffadad' : p.bot ? '#d1d5db' : '#ffe08a';
      ctx.fillText(`${p.name}${p.level ? '  · Lv ' + p.level : ''}${p.alive ? '' : '  ✝'}`, x + 16, ry + rh * 0.7);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      [p.kills, p.deaths, p.score].forEach((v, j) => ctx.fillText(String(v), x + cols[j] + 40, ry + rh * 0.7));
    });
  }
}
