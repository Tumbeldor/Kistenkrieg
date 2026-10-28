// Canvas renderer: world, entities, effects and HUD.
import { GUN_TIERS, MapId, TEAM_COLORS, TEAM_NAMES, WEAPONS, WeaponId, skinDef } from './config';
import type { Fx } from './fx';
import type { Game, Player } from './game';
import { sameTeam } from './game';
import type { Input } from './input';
import { GameMap, Solid } from './map';
import { dist } from './geom';
import { drawWeaponSide } from './weaponart';

interface Theme {
  bg: string; floor: string; floor2: string; line: string; wall: string; wallTop: string; wallEdge: string;
  bush: string; bush2: string; bushEdge: string; rock: string; rock2: string; shadow: string;
}
const THEMES: Record<MapId, Theme> = {
  lager: { bg: '#121417', floor: '#4a4e53', floor2: '#45494e', line: '#3c4045', wall: '#2a2e33', wallTop: '#575d65', wallEdge: '#1a1d21',
    bush: '#4b5639', bush2: '#59654a', bushEdge: '#333b27', rock: '#5f5f5f', rock2: '#777', shadow: 'rgba(0,0,0,0.35)' },
  wald: { bg: '#10150f', floor: '#4a5e3a', floor2: '#465938', line: '#3f5133', wall: '#55584f', wallTop: '#7f8276', wallEdge: '#36382f',
    bush: '#34502c', bush2: '#3f5e35', bushEdge: '#233620', rock: '#2d4527', rock2: '#3a5832', shadow: 'rgba(0,10,0,0.35)' },
  wueste: { bg: '#221c14', floor: '#b9a27c', floor2: '#b39b74', line: '#a68f6a', wall: '#86705a', wallTop: '#b39d80', wallEdge: '#5d4c3b',
    bush: '#717449', bush2: '#83865a', bushEdge: '#4f5133', rock: '#857561', rock2: '#9c8c77', shadow: 'rgba(40,25,5,0.3)' },
  winter: { bg: '#141a20', floor: '#d6dde3', floor2: '#cfd7de', line: '#c3ccd4', wall: '#5d646b', wallTop: '#9aa3ab', wallEdge: '#3a4046',
    bush: '#4f6152', bush2: '#dfe6ea', bushEdge: '#33423a', rock: '#2f4436', rock2: '#e6ecef', shadow: 'rgba(40,60,80,0.25)' },
  stadt: { bg: '#101113', floor: '#3c3e42', floor2: '#383a3e', line: '#c9b25a', wall: '#4a4643', wallTop: '#77716b', wallEdge: '#2a2826',
    bush: '#3d5233', bush2: '#4a6340', bushEdge: '#29381f', rock: '#555', rock2: '#777', shadow: 'rgba(0,0,0,0.38)' },
};

export function shade(hex: string, amt: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; } else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
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
  private camoCache = new Map<string, CanvasPattern | string>();

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
        x.strokeStyle = Math.random() < 0.6 ? 'rgba(20,40,15,0.35)' : 'rgba(150,170,110,0.18)';
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.random() * 4 - 2, py - 4 - Math.random() * 4); x.stroke();
      }
      for (let i = 0; i < 40; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(60,45,30,0.25)' : 'rgba(30,30,25,0.2)';
        x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
    } else if (theme === 'winter') {
      // snow: soft drifts, footprints, a few twigs
      for (let i = 0; i < 8; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(150,170,190,0.06)' : 'rgba(255,255,255,0.16)';
        x.beginPath(); x.ellipse(Math.random() * S, Math.random() * S, 30 + Math.random() * 40, 12 + Math.random() * 16, Math.random() * 3, 0, 7); x.fill();
      }
      x.fillStyle = 'rgba(120,140,160,0.1)';
      for (let i = 0; i < 6; i++) {
        const px = 40 + i * 20, py = 140 + Math.sin(i) * 20 + (i % 2) * 10;
        x.beginPath(); x.ellipse(px, py, 4, 6, 0.4, 0, 7); x.fill();
      }
      x.strokeStyle = 'rgba(80,70,60,0.35)';
      x.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const px = Math.random() * S, py = Math.random() * S;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + 8, py - 4); x.lineTo(px + 12, py - 1); x.stroke();
      }
    } else if (theme === 'stadt') {
      // asphalt with cracks, a manhole and a faded road marking
      for (let i = 0; i < 500; i++) {
        x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
        x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      }
      x.fillStyle = 'rgba(201,178,90,0.16)';
      for (let px = 8; px < S; px += 64) x.fillRect(px, 126, 36, 4);
      x.strokeStyle = 'rgba(0,0,0,0.35)';
      x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(30, 20); x.lineTo(46, 38); x.lineTo(44, 60); x.lineTo(60, 74); x.stroke();
      x.fillStyle = 'rgba(0,0,0,0.1)';
      x.beginPath(); x.ellipse(190, 200, 34, 18, 0.3, 0, 7); x.fill();
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
      } else if (def.kind === 'grenade') {
        const big = b.w === 'gl';
        const blink = Math.sin(b.age * (8 + b.age * 14)) > 0.4;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(b.x + 2, b.y + 3, big ? 5 : 6, 0, 7); ctx.fill();
        ctx.fillStyle = big ? '#6d7452' : '#4f5a3a';
        ctx.beginPath(); ctx.arc(b.x, b.y, big ? 5 : 6, 0, 7); ctx.fill();
        ctx.strokeStyle = '#1d2016'; ctx.lineWidth = 1.2; ctx.stroke();
        if (blink) { ctx.fillStyle = '#e05a4a'; ctx.beginPath(); ctx.arc(b.x, b.y, 1.8, 0, 7); ctx.fill(); }
      } else if (b.w === 'crossbow') {
        const a = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillStyle = '#5a4a36';
        ctx.fillRect(-22, -1.2, 22, 2.4);
        ctx.fillStyle = '#c9ccd0';
        ctx.beginPath(); ctx.moveTo(0, -2.2); ctx.lineTo(6, 0); ctx.lineTo(0, 2.2); ctx.fill();
        ctx.fillStyle = '#8a8f96';
        ctx.fillRect(-24, -3, 5, 1.5); ctx.fillRect(-24, 1.5, 5, 1.5);
        ctx.restore();
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
        ctx.strokeStyle = 'rgba(255,210,140,0.18)';
        ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 1.6;
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
      let ring: string | null = null;
      if (p === me) ring = 'rgba(255,255,255,0.32)';
      else if (p.boss) ring = 'rgba(207,90,79,0.8)';
      else if (me && sameTeam(p, me)) ring = 'rgba(91,155,213,0.6)';
      else if (p.team === 0 || p.team === 1) ring = 'rgba(207,90,79,0.5)';
      this.drawPlayer(p, hidden ? 0.55 : 1, g, p === me, ring);
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
      ctx.fillStyle = '#ffe2a8';
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
      ctx.strokeStyle = '#6fc6d6';
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
      ctx.font = `800 ${t.size}px 'Barlow', system-ui, sans-serif`;
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
      const s = c.width / 64;
      x.setTransform(s, 0, 0, s, c.width / 2 - 6 * s, c.height / 2);
      const fake = {
        id: 'avatar', x: 0, y: 0, r: 18, aim, skin, hat, wid, team: -1, boss: false, lastHurtAt: -9, protectT: 0, reloading: false,
        slots: [], cur: 0,
      } as unknown as Player;
      const saveT = this.time;
      this.time = t;
      this.drawPlayer(fake, 1, { time: 0 } as Game, false);
      this.time = saveT;
    });
  }

  camoSwatch(c: HTMLCanvasElement, skin: string) {
    this.withCanvas(c, (x) => {
      x.setTransform(2, 0, 0, 2, 0, 0);
      x.fillStyle = this.camo(skin);
      x.fillRect(0, 0, c.width, c.height);
    });
  }

  gunIcon(c: HTMLCanvasElement, w: WeaponId) {
    this.withCanvas(c, (x) => {
      drawWeaponSide(x, w, c.width / 2, c.height / 2, Math.min(c.width * 0.92, (c.height / 40) * 100 * 0.95));
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
      if ((this.map?.theme === 'lager' || this.map?.theme === 'stadt') && s.w > 40 && s.h > 20 && s.h < 40) {
        ctx.fillStyle = 'rgba(200,170,60,0.18)';
        for (let x = s.x + 10; x < s.x + s.w - 20; x += 40) ctx.fillRect(x, s.y + s.h / 2 - 2, 18, 4);
      }
      return;
    }
    if (s.kind === 'rock') {
      if (this.map?.theme === 'wald' || this.map?.theme === 'winter') {
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
      ctx.fillStyle = '#4e1d16';
      ctx.beginPath(); ctx.arc(s.cx, s.cy, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#8a3427';
      ctx.beginPath(); ctx.arc(s.cx, s.cy, r - 3, 0, 7); ctx.fill();
      ctx.strokeStyle = '#5a2219';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.cx, s.cy, r * 0.62, 0, 7); ctx.stroke();
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath(); ctx.arc(s.cx + r * 0.35, s.cy - r * 0.35, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#c9a646';
      ctx.beginPath(); ctx.moveTo(s.cx - 2, s.cy - 6); ctx.lineTo(s.cx + 5, s.cy + 5); ctx.lineTo(s.cx - 9, s.cy + 5); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(s.cx - 3, s.cy - 2, 2, 5);
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
    ctx.fillStyle = '#4c3a26';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = dmg > 0.5 ? '#7a5e40' : '#8b6c48';
    ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
    ctx.strokeStyle = '#614a31';
    ctx.lineWidth = 4;
    ctx.strokeRect(s.x + 5, s.y + 5, s.w - 10, s.h - 10);
    ctx.beginPath();
    ctx.moveTo(s.x + 7, s.y + 7); ctx.lineTo(s.x + s.w - 7, s.y + s.h - 7);
    ctx.moveTo(s.x + s.w - 7, s.y + 7); ctx.lineTo(s.x + 7, s.y + s.h - 7);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,235,200,0.1)';
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
    let st = Math.floor(seed * 1000) + 7;
    const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
    // irregular outer mass
    ctx.fillStyle = th.bushEdge;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, 7);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rnd() * 0.5;
      const d = r * (0.5 + rnd() * 0.25);
      const cr = r * (0.3 + rnd() * 0.16);
      const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
      ctx.moveTo(cx + cr, cy);
      ctx.arc(cx, cy, cr, 0, 7);
    }
    ctx.fill();
    // leaf clusters
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.7;
      const cr = r * (0.13 + rnd() * 0.14);
      ctx.fillStyle = i % 3 === 0 ? th.bush2 : th.bush;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, cr, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r * 0.6;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.08, 0, 7); ctx.fill();
    }
    if (this.map?.theme === 'lager') {
      // camouflage net, clipped to the shape
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.92, 0, 7);
      ctx.clip();
      ctx.strokeStyle = 'rgba(20,25,15,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = -5; i <= 5; i++) {
        ctx.moveTo(x + i * r * 0.22 - r, y - r); ctx.lineTo(x + i * r * 0.22 + r, y + r);
        ctx.moveTo(x + i * r * 0.22 + r, y - r); ctx.lineTo(x + i * r * 0.22 - r, y + r);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawPickup(x: number, y: number, kind: string, w: WeaponId | null, on: boolean) {
    const ctx = this.ctx;
    const t = this.time;
    const col = kind === 'health' ? '127,183,126' : kind === 'armor' ? '111,159,207' : '201,166,70';
    ctx.globalAlpha = on ? 1 : 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${col},0.75)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.moveTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22);
      ctx.lineTo(x + Math.cos(a) * 28, y + Math.sin(a) * 28);
    }
    ctx.stroke();
    if (!on) { ctx.globalAlpha = 1; return; }
    ctx.strokeStyle = `rgba(${col},${0.25 + Math.sin(t * 3 + x) * 0.15})`;
    ctx.beginPath(); ctx.arc(x, y, 25 + Math.sin(t * 3 + x) * 2, 0, 7); ctx.stroke();
    if (kind === 'health') {
      ctx.fillStyle = '#1f2120';
      rr(ctx, x - 13, y - 10, 26, 20, 3); ctx.fill();
      ctx.fillStyle = '#c4c7c1';
      rr(ctx, x - 11.5, y - 8.5, 23, 17, 2); ctx.fill();
      ctx.fillStyle = '#a3322b';
      ctx.fillRect(x - 2.5, y - 6.5, 5, 13);
      ctx.fillRect(x - 6.5, y - 2.5, 13, 5);
    } else if (kind === 'armor') {
      ctx.fillStyle = '#1d211a';
      rr(ctx, x - 11, y - 13, 22, 26, 4); ctx.fill();
      ctx.fillStyle = '#4c5a3a';
      rr(ctx, x - 9.5, y - 11.5, 19, 23, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x - 7, y + 1, 4, 7); ctx.fillRect(x - 2, y + 1, 4, 7); ctx.fillRect(x + 3, y + 1, 4, 7);
      ctx.fillRect(x - 9.5, y - 6, 19, 2);
    } else if (w) {
      drawWeaponSide(ctx, w, x, y, 46);
    }
    ctx.globalAlpha = 1;
  }

  private gunShape(w: WeaponId, x0: number, scale: number, mono?: string) {
    const ctx = this.ctx;
    const c = (col: string) => mono ?? col;
    const def = WEAPONS[w];
    const L = (def.len + 10) * scale, T = def.thick * scale;
    const metal = '#1d2024', metal2 = '#34383e', poly = '#2a2c2a';
    const rect = (x: number, y: number, ww: number, hh: number, col: string, rad = 0) => {
      ctx.fillStyle = c(col);
      if (rad) { rr(ctx, x, y, ww, hh, rad); ctx.fill(); } else ctx.fillRect(x, y, ww, hh);
    };
    switch (w) {
      case 'pistol':
        rect(x0, -T * 0.42, L * 0.62, T * 0.84, poly, 1.5);
        rect(x0 + L * 0.15, -T * 0.25, L * 0.62, T * 0.5, metal);
        break;
      case 'smg':
        rect(x0 - 2 * scale, -T * 0.2, L * 0.25, T * 0.4, metal2);
        rect(x0 + L * 0.15, -T * 0.45, L * 0.55, T * 0.9, poly, 1.5);
        rect(x0 + L * 0.65, -T * 0.2, L * 0.35, T * 0.4, metal);
        break;
      case 'rifle':
        rect(x0 - 3 * scale, -T * 0.4, L * 0.28, T * 0.8, poly, 2);
        rect(x0 + L * 0.22, -T * 0.42, L * 0.45, T * 0.84, metal, 1);
        rect(x0 + L * 0.3, -T * 0.18, L * 0.22, T * 0.36, metal2);
        rect(x0 + L * 0.62, -T * 0.25, L * 0.38, T * 0.5, metal);
        rect(x0 + L * 0.94, -T * 0.32, L * 0.06, T * 0.64, metal2);
        break;
      case 'shotgun':
        rect(x0 - 3 * scale, -T * 0.42, L * 0.3, T * 0.84, '#4a3a2a', 2);
        rect(x0 + L * 0.24, -T * 0.4, L * 0.32, T * 0.8, metal);
        rect(x0 + L * 0.5, -T * 0.3, L * 0.5, T * 0.6, metal2);
        rect(x0 + L * 0.55, -T * 0.42, L * 0.22, T * 0.84, '#4a3a2a', 1.5);
        break;
      case 'sniper':
        rect(x0 - 4 * scale, -T * 0.45, L * 0.3, T * 0.9, '#3d4232', 2);
        rect(x0 + L * 0.22, -T * 0.4, L * 0.3, T * 0.8, metal);
        rect(x0 + L * 0.25, -T * 0.75, L * 0.3, T * 1.5, '#121416', 2);
        rect(x0 + L * 0.5, -T * 0.2, L * 0.5, T * 0.4, metal);
        break;
      case 'flamer':
        rect(x0 - 2 * scale, -T * 0.5, L * 0.32, T, '#4b4f3a', 3);
        rect(x0 + L * 0.28, -T * 0.32, L * 0.42, T * 0.64, metal);
        rect(x0 + L * 0.68, -T * 0.22, L * 0.32, T * 0.44, metal2);
        break;
      case 'minigun':
        rect(x0, -T * 0.5, L * 0.42, T, '#2b2e2a', 3);
        for (const o of [-T * 0.3, 0, T * 0.3]) rect(x0 + L * 0.38, o - 1.4 * scale, L * 0.62, 2.8 * scale, metal2);
        rect(x0 + L * 0.9, -T * 0.45, L * 0.06, T * 0.9, metal);
        break;
      case 'rocket':
        rect(x0 - 2 * scale, -T * 0.5, L, T, '#3f4a2c', 3);
        rect(x0 + L * 0.3, -T * 0.62, L * 0.18, T * 1.24, '#2a3120', 1);
        rect(x0 + L - 4 * scale, -T * 0.55, 4 * scale, T * 1.1, '#1d2416');
        break;
      case 'rail':
        rect(x0 - 2 * scale, -T * 0.45, L * 0.35, T * 0.9, '#22262b', 2);
        rect(x0 + L * 0.3, -T * 0.4, L * 0.7, T * 0.8, metal, 1);
        rect(x0 + L * 0.35, -1, L * 0.6, 2, '#5fb7c9');
        break;
      case 'revolver':
        rect(x0, -T * 0.42, L * 0.4, T * 0.84, '#3a3027', 2);
        rect(x0 + L * 0.3, -T * 0.5, L * 0.25, T, metal, 2);
        rect(x0 + L * 0.5, -T * 0.22, L * 0.5, T * 0.44, metal2);
        break;
      case 'smgsil':
        rect(x0 - 2 * scale, -T * 0.2, L * 0.2, T * 0.4, metal2);
        rect(x0 + L * 0.12, -T * 0.45, L * 0.45, T * 0.9, poly, 1.5);
        rect(x0 + L * 0.55, -T * 0.32, L * 0.45, T * 0.64, '#141618', 2);
        break;
      case 'dmr':
        rect(x0 - 4 * scale, -T * 0.42, L * 0.28, T * 0.84, '#3a3d34', 2);
        rect(x0 + L * 0.2, -T * 0.4, L * 0.35, T * 0.8, metal);
        rect(x0 + L * 0.24, -T * 0.6, L * 0.24, T * 1.2, '#121416', 2);
        rect(x0 + L * 0.55, -T * 0.22, L * 0.45, T * 0.44, metal);
        break;
      case 'lmg':
        rect(x0 - 3 * scale, -T * 0.4, L * 0.26, T * 0.8, poly, 2);
        rect(x0 + L * 0.2, -T * 0.5, L * 0.42, T, metal, 1);
        rect(x0 + L * 0.3, T * 0.3, L * 0.18, T * 0.55, '#3a3d34', 1);
        rect(x0 + L * 0.6, -T * 0.22, L * 0.4, T * 0.44, metal2);
        break;
      case 'autoshotgun':
        rect(x0 - 2 * scale, -T * 0.4, L * 0.24, T * 0.8, poly, 2);
        rect(x0 + L * 0.2, -T * 0.5, L * 0.5, T, metal, 2);
        rect(x0 + L * 0.66, -T * 0.3, L * 0.34, T * 0.6, metal2);
        break;
      case 'gl':
        rect(x0 - 2 * scale, -T * 0.32, L * 0.25, T * 0.64, poly, 2);
        rect(x0 + L * 0.2, -T * 0.5, L * 0.32, T, '#3f4434', 4);
        rect(x0 + L * 0.48, -T * 0.34, L * 0.52, T * 0.68, metal, 2);
        break;
      case 'crossbow':
        rect(x0, -T * 0.25, L, T * 0.5, '#4a3c2c', 1.5);
        rect(x0 + L * 0.62, -T * 1.4, 3 * scale, T * 2.8, '#1f2124', 1.5);
        ctx.strokeStyle = c('rgba(220,215,200,0.7)');
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x0 + L * 0.66, -T * 1.35); ctx.lineTo(x0 + L * 0.35, 0); ctx.lineTo(x0 + L * 0.66, T * 1.35);
        ctx.stroke();
        break;
      case 'grenade':
        break;
    }
  }

  /** Camouflage fill for a skin (cached pattern; drawn in the player's local frame so it moves with them). */
  private camo(skinId: string): CanvasPattern | string {
    const cached = this.camoCache.get(skinId);
    if (cached) return cached;
    const sk = skinDef(skinId);
    const S = 48;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d')!;
    x.fillStyle = sk.color;
    x.fillRect(0, 0, S, S);
    let seed = skinId.length * 97 + skinId.charCodeAt(0);
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    if (sk.pattern === 'blotch') {
      for (let i = 0; i < 16; i++) {
        x.fillStyle = sk.spots[i % sk.spots.length];
        const px = rnd() * S, py = rnd() * S, rx = 3 + rnd() * 7, ry = 2 + rnd() * 4, a = rnd() * 3;
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          x.beginPath(); x.ellipse(px + ox, py + oy, rx, ry, a, 0, 7); x.fill();
        }
      }
    } else if (sk.pattern === 'digital') {
      for (let i = 0; i < 70; i++) {
        x.fillStyle = sk.spots[i % sk.spots.length];
        x.fillRect(Math.floor(rnd() * 16) * 3, Math.floor(rnd() * 16) * 3, 3 * (1 + Math.floor(rnd() * 2)), 3);
      }
    } else if (sk.pattern === 'stripe') {
      for (let i = 0; i < 9; i++) {
        x.fillStyle = sk.spots[i % sk.spots.length];
        const y0 = rnd() * S * 1.5 - S * 0.25;
        x.beginPath();
        x.moveTo(-4, y0); x.lineTo(S * 0.5, y0 - 6 - rnd() * 6); x.lineTo(S + 4, y0 - 2);
        x.lineTo(S + 4, y0 + 2); x.lineTo(S * 0.5, y0 - 3); x.lineTo(-4, y0 + 3);
        x.fill();
      }
    } else {
      for (let i = 0; i < 120; i++) {
        x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
        x.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
      }
    }
    const pat = this.ctx.createPattern(c, 'repeat') ?? sk.color;
    this.camoCache.set(skinId, pat);
    return pat;
  }

  /** Top-down soldier, drawn in its local frame (x = aim direction). */
  private drawPlayer(p: Player, alpha: number, g: Game, isMe: boolean, ring: string | null = null) {
    const ctx = this.ctx;
    const t = this.time;
    const r = p.r;
    const sk = skinDef(p.skin);
    const hurt = g.time - p.lastHurtAt < 0.12;
    const def = WEAPONS[p.wid];
    const gunScale = p.boss ? 1.3 : 1;
    ctx.globalAlpha = alpha;
    // ground marker + shadow
    if (ring) {
      ctx.strokeStyle = ring;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 5, r * 1.05, r * 0.95, 0, 0, 7); ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);
    const camo = this.camo(p.skin);
    const dark = shade(sk.color, -0.45);
    // torso: shoulders + plate carrier
    ctx.fillStyle = camo;
    ctx.beginPath(); ctx.ellipse(-r * 0.12, 0, r * 0.62, r * 1.02, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // backpack on the back, plate carrier on the chest
    ctx.fillStyle = p.boss ? '#18191b' : shade(sk.color, -0.42);
    rr(ctx, -r * 0.8, -r * 0.46, r * 0.42, r * 0.92, r * 0.12); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(-r * 0.74, -r * 0.4, r * 0.08, r * 0.8);
    ctx.fillStyle = p.boss ? '#1f2124' : shade(sk.color, -0.28);
    rr(ctx, -r * 0.42, -r * 0.6, r * 0.72, r * 1.2, r * 0.16); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (const sy of [-0.5, -0.12, 0.26]) ctx.fillRect(r * 0.12, r * sy, r * 0.16, r * 0.26);
    if (p.boss) {
      ctx.fillStyle = '#3a3d42';
      for (const sy of [-1, 1]) { rr(ctx, -r * 0.45, sy * r * 0.62 - r * 0.22, r * 0.7, r * 0.44, 3); ctx.fill(); }
    }
    // arms reaching to the weapon
    const gy = r * 0.12;
    const grip = r * 0.62;
    const support = grip + Math.min(def.len * 0.55, 22) * gunScale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.05, r * 0.8); ctx.lineTo(grip - r * 0.1, gy + r * 0.12);
    ctx.moveTo(-r * 0.05, -r * 0.8); ctx.lineTo(support - r * 0.1, gy - r * 0.06);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = r * 0.42;
    ctx.stroke();
    ctx.strokeStyle = camo;
    ctx.lineWidth = r * 0.32;
    ctx.stroke();
    // weapon + gloves
    ctx.translate(0, gy);
    this.gunShape(p.wid, grip - r * 0.2, gunScale);
    ctx.translate(0, -gy);
    ctx.fillStyle = '#2a2a27';
    ctx.beginPath(); ctx.arc(grip, gy + r * 0.08, r * 0.19, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(support, gy - r * 0.05, r * 0.19, 0, 7); ctx.fill();
    // head + headgear
    this.drawHead(p, r, dark);
    ctx.restore();

    if (hurt) {
      ctx.fillStyle = 'rgba(200,40,30,0.35)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.05, 0, 7); ctx.fill();
    }
    if (p.protectT > 0) {
      ctx.strokeStyle = `rgba(150,200,225,${0.45 + Math.sin(t * 10) * 0.2})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 10, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (isMe && p.reloading) {
      const slot = p.slots[p.cur];
      if (slot && slot.reloadTotal > 0) {
        ctx.strokeStyle = 'rgba(216,176,74,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - slot.reloadT / slot.reloadTotal));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Head and headgear in the player's local frame (x forward). */
  private drawHead(p: Player, r: number, dark: string) {
    const ctx = this.ctx;
    const tones = ['#d6ad8c', '#b98a68', '#8d6246', '#62432f', '#e4c3a6'];
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
    const skinTone = tones[Math.abs(h) % tones.length];
    const hR = r * 0.47;
    const hx = r * 0.08;
    const circle = (x: number, y: number, rad: number, col: string) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); };
    const outline = () => { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.stroke(); };
    // bare head: skin with hair on the back of the head
    const bareHead = (hair = '#2b2420') => {
      circle(hx, 0, hR, skinTone);
      outline();
      ctx.fillStyle = hair;
      ctx.beginPath(); ctx.arc(hx, 0, hR, Math.PI * 0.42, Math.PI * 1.58); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx - hR * 0.1, 0, hR * 0.72, hR * 0.95, 0, 0, 7); ctx.fill();
    };
    const helmet = (col: string, rad = hR * 1.15) => {
      circle(hx - r * 0.02, 0, rad, col);
      outline();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx - r * 0.02, 0, rad * 0.72, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.arc(hx - rad * 0.25, -rad * 0.25, rad * 0.4, 0, 7); ctx.fill();
    };
    switch (p.hat) {
      case 'cap':
        bareHead();
        circle(hx - r * 0.03, 0, hR * 0.98, '#2f3328');
        ctx.fillStyle = '#23261e';
        ctx.beginPath(); ctx.ellipse(hx + hR * 0.85, 0, hR * 0.38, hR * 0.72, 0, 0, 7); ctx.fill();
        break;
      case 'beanie':
        circle(hx, 0, hR * 1.02, '#26282b');
        outline();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        for (const k of [0.35, 0.65]) { ctx.beginPath(); ctx.arc(hx, 0, hR * k, 0, 7); ctx.stroke(); }
        break;
      case 'headset':
        bareHead();
        ctx.strokeStyle = '#1b1c1e';
        ctx.lineWidth = r * 0.14;
        ctx.beginPath(); ctx.moveTo(hx - hR * 0.1, -hR * 1.05); ctx.lineTo(hx - hR * 0.1, hR * 1.05); ctx.stroke();
        ctx.fillStyle = '#2c2e31';
        for (const sy of [-1, 1]) { rr(ctx, hx - hR * 0.45, sy * hR * 1.05 - hR * 0.28, hR * 0.7, hR * 0.56, 2); ctx.fill(); }
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(hx, hR * 1.05); ctx.quadraticCurveTo(hx + hR * 0.9, hR * 0.9, hx + hR * 0.95, hR * 0.3); ctx.stroke();
        break;
      case 'beret':
        bareHead();
        ctx.fillStyle = '#4a1f22';
        ctx.beginPath(); ctx.ellipse(hx - hR * 0.1, hR * 0.15, hR * 0.95, hR * 1.08, 0.2, 0, 7); ctx.fill();
        outline();
        circle(hx + hR * 0.35, -hR * 0.45, hR * 0.16, '#b89a4a');
        break;
      case 'boonie':
        circle(hx - r * 0.02, 0, hR * 1.55, shade(skinDef(p.skin).color, 0.08));
        outline();
        circle(hx - r * 0.02, 0, hR * 0.95, shade(skinDef(p.skin).color, -0.12));
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(hx - r * 0.02, 0, hR * 0.95, 0, 7); ctx.stroke();
        break;
      case 'helmet':
        helmet(shade(skinDef(p.skin).color, -0.08));
        break;
      case 'balaclava':
        circle(hx, 0, hR, '#18191b');
        outline();
        ctx.fillStyle = skinTone;
        rr(ctx, hx + hR * 0.45, -hR * 0.55, hR * 0.4, hR * 1.1, 2); ctx.fill();
        ctx.fillStyle = '#18191b';
        circle(hx + hR * 0.68, -hR * 0.25, hR * 0.08, '#111');
        circle(hx + hR * 0.68, hR * 0.25, hR * 0.08, '#111');
        break;
      case 'nvg':
        helmet('#3d4434');
        ctx.fillStyle = '#16181a';
        rr(ctx, hx + hR * 0.55, -hR * 0.5, hR * 0.55, hR * 1.0, 2); ctx.fill();
        circle(hx + hR * 1.1, -hR * 0.25, hR * 0.18, '#3c6b3a');
        circle(hx + hR * 1.1, hR * 0.25, hR * 0.18, '#3c6b3a');
        break;
      case 'gasmask':
        circle(hx, 0, hR, '#2a2c2e');
        outline();
        circle(hx + hR * 0.55, -hR * 0.38, hR * 0.24, '#5d6a70');
        circle(hx + hR * 0.55, hR * 0.38, hR * 0.24, '#5d6a70');
        rr(ctx, hx + hR * 0.75, -hR * 0.3, hR * 0.55, hR * 0.6, 3); ctx.fillStyle = '#3b3e40'; ctx.fill();
        break;
      case 'tactical':
        helmet(p.boss ? '#1f2124' : '#6e6550', hR * 1.2);
        ctx.fillStyle = '#1c1d1f';
        for (const sy of [-1, 1]) ctx.fillRect(hx - hR * 0.5, sy * hR * 1.08 - (sy < 0 ? hR * 0.2 : 0), hR * 0.9, hR * 0.2);
        rr(ctx, hx - hR * 0.95, -hR * 0.18, hR * 0.38, hR * 0.36, 2); ctx.fill();
        break;
      case 'officer':
        circle(hx - r * 0.02, 0, hR * 1.12, '#3a4030');
        outline();
        ctx.fillStyle = '#121314';
        ctx.beginPath(); ctx.ellipse(hx + hR * 0.9, 0, hR * 0.35, hR * 0.75, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#7a3a2e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx - r * 0.02, 0, hR * 0.85, 0, 7); ctx.stroke();
        circle(hx + hR * 0.45, 0, hR * 0.16, '#b89a4a');
        break;
      default:
        bareHead();
    }
    void dark;
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
      ctx.fillStyle = ratio > 0.5 ? '#79b46f' : ratio > 0.25 ? '#cfa743' : '#c4524a';
      if (!friendly && g.settings.mode !== 'survival') ctx.fillStyle = ratio > 0.25 ? '#c4524a' : '#c4524a';
      ctx.fillRect(s.x - bw / 2, top + 4, bw * ratio, 4);
      if (p.armor > 0) {
        ctx.fillStyle = '#6f9fcf';
        ctx.fillRect(s.x - bw / 2, top + 9, (bw * Math.min(100, p.armor)) / 100, 2);
      }
      if (isMe) continue;
      ctx.font = `600 ${fs + 2}px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      const label = p.level > 0 ? `${p.name}  ${p.level}` : p.name;
      ctx.strokeText(label, s.x, top - 1);
      ctx.fillStyle = p.team === 0 ? '#a9c8e6' : p.team === 1 ? '#e3a69e' : p.bot ? '#e5e7eb' : '#e2d3ac';
      ctx.fillText(label, s.x, top - 1);
    }
  }

  private panel(x: number, y: number, w: number, h: number, r = 3) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(13,15,18,0.74)';
    rr(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
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
      const a = Math.min(0.5, fx.hurt * 0.45 + low * 0.7);
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
        ctx.fillStyle = pk.kind === 'health' ? '#7fb77e' : pk.kind === 'armor' ? '#6f9fcf' : '#c9a646';
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
        ctx.fillStyle = friendly ? '#8fb8de' : p.boss ? '#c4524a' : '#d9796e';
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
      ctx.font = `600 ${small ? 11 : 13}px 'Barlow', system-ui, sans-serif`;
      for (const f of fx.feed) {
        const alpha = Math.min(1, f.t * 2);
        ctx.globalAlpha = alpha;
        let text = '';
        if (f.info) text = `${f.vn} ${f.info}`;
        else text = f.kn ? `${f.kn}  [${f.w}]  ${f.vn}` : `${f.vn} ist gestorben`;
        const w = ctx.measureText(text).width + 16;
        const x = W - sr;
        ctx.fillStyle = f.mine ? 'rgba(90,70,20,0.6)' : 'rgba(10,14,24,0.55)';
        rr(ctx, x - w, y, w, small ? 20 : 24, 2); ctx.fill();
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
        ctx.font = `700 ${small ? 26 : 36}px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(m.text, W / 2, y);
        ctx.fillStyle = m.color;
        ctx.fillText(m.text, W / 2, y);
        if (m.sub) {
          ctx.font = `700 ${small ? 13 : 16}px 'Barlow', system-ui, sans-serif`;
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
      ctx.font = `700 ${small ? 30 : 44}px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
      ctx.fillStyle = '#d9796e';
      ctx.fillText('ELIMINIERT', W / 2, H * 0.42);
      ctx.font = `600 ${small ? 14 : 18}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      const killer = me.killedBy ? g.players.get(me.killedBy)?.name : null;
      ctx.fillText(killer ? `von ${killer}` : 'Eigenverschulden', W / 2, H * 0.42 + (small ? 28 : 36));
      ctx.fillStyle = '#d8b04a';
      const sub = g.settings.mode === 'survival' ? 'Du kommst nach der Welle zurück – du schaust deinem Team zu.' : `Respawn in ${Math.max(0, me.respawnT).toFixed(1)} s`;
      ctx.fillText(sub, W / 2, H * 0.42 + (small ? 52 : 66));
    }

    // crosshair
    if (!touch && view.input.mouse.seen && me && me.alive) {
      const { x, y } = view.input.mouse;
      const gap = 6 + WEAPONS[me.wid].spread * 60 + fx.recoil;
      ctx.strokeStyle = fx.killMarker > 0 ? '#c4524a' : '#ffffff';
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
      ctx.font = "600 11px 'Barlow', system-ui, sans-serif";
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
      ctx.font = `700 ${small ? 20 : 26}px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
      ctx.fillStyle = TEAM_COLORS[0];
      ctx.fillText(String(g.teamKills[0]), W / 2 - w * 0.3, y + h * 0.66);
      ctx.fillStyle = TEAM_COLORS[1];
      ctx.fillText(String(g.teamKills[1]), W / 2 + w * 0.3, y + h * 0.66);
      ctx.font = `700 ${small ? 12 : 14}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(fmtTime(g.timeLeft), W / 2, y + h * 0.45);
      ctx.font = `600 ${small ? 9 : 11}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`Ziel ${s.killLimit}`, W / 2, y + h * 0.82);
    } else if (s.mode === 'gungame') {
      const w = small ? 250 : 320, h = small ? 40 : 50;
      this.panel(W / 2 - w / 2, y, w, h);
      const n = GUN_TIERS.length;
      const tier = Math.min(n - 1, Math.floor((me?.score ?? 0) / 100));
      const leader = [...g.list].sort((a, b) => b.score - a.score)[0];
      ctx.font = `700 ${small ? 12 : 14}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`${fmtTime(g.timeLeft)}  ·  Stufe ${tier + 1}/${n}: ${WEAPONS[GUN_TIERS[tier]].name}`, W / 2, y + h * 0.42);
      ctx.font = `600 ${small ? 11 : 13}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = '#d8b04a';
      if (leader) ctx.fillText(`Führung: ${leader.name} – Stufe ${Math.min(n, Math.floor(leader.score / 100) + 1)}`, W / 2, y + h * 0.8);
    } else if (s.mode === 'dm') {
      const w = small ? 210 : 270, h = small ? 40 : 50;
      this.panel(W / 2 - w / 2, y, w, h);
      const leader = [...g.list].sort((a, b) => b.kills - a.kills)[0];
      ctx.font = `700 ${small ? 12 : 14}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`${fmtTime(g.timeLeft)}  ·  Ziel ${s.killLimit} Kills`, W / 2, y + h * 0.42);
      ctx.font = `600 ${small ? 11 : 13}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = '#d8b04a';
      const lead = leader ? `Führung: ${leader.name} ${leader.kills}` : '';
      ctx.fillText(`${lead}   ·   Du: ${me?.kills ?? 0}`, W / 2, y + h * 0.8);
    } else {
      const w = small ? 200 : 250, h = small ? 40 : 50;
      this.panel(W / 2 - w / 2, y, w, h);
      ctx.font = `700 ${small ? 17 : 22}px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
      ctx.fillStyle = '#d8b04a';
      ctx.fillText(g.wave > 0 ? `WELLE ${g.wave}` : 'BEREIT MACHEN', W / 2, y + h * 0.5);
      ctx.font = `600 ${small ? 11 : 13}px 'Barlow', system-ui, sans-serif`;
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
    this.panel(x - 6, y - (small ? 24 : 30), bw + 12, (small ? 24 : 30) + (small ? 26 : 34), 3);
    const hpR = Math.max(0, me.hp / me.maxHp);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    rr(ctx, x, y, bw, small ? 14 : 18, 2); ctx.fill();
    ctx.fillStyle = hpR > 0.5 ? '#79b46f' : hpR > 0.25 ? '#cfa743' : '#c4524a';
    if (hpR > 0) { rr(ctx, x, y, Math.max(4, bw * hpR), small ? 14 : 18, 2); ctx.fill(); }
    ctx.font = `800 ${small ? 11 : 13}px 'Barlow', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0b0f17';
    ctx.fillText(`${Math.ceil(Math.max(0, me.hp))} / ${me.maxHp}`, x + bw / 2, y + (small ? 11 : 14));
    if (me.armor > 0) {
      ctx.fillStyle = '#6f9fcf';
      rr(ctx, x, y + (small ? 16 : 21), (bw * Math.min(100, me.armor)) / 100, 4, 2); ctx.fill();
    }
    // weapon + ammo
    const { slot, mag } = g.ammoInfo(me);
    if (!slot) return;
    const def = WEAPONS[slot.id];
    ctx.textAlign = 'left';
    ctx.font = `700 ${small ? 12 : 14}px 'Barlow', system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    const ammoTxt = slot.reloadT > 0 ? 'Lädt nach …' : `${slot.ammo} / ${isFinite(slot.reserve) ? slot.reserve : '∞'}`;
    ctx.fillText(`${def.name}  ·  Granaten ${me.grenades}`, x, y - (small ? 9 : 11));
    ctx.textAlign = 'right';
    ctx.fillStyle = slot.ammo === 0 ? '#c4524a' : slot.ammo <= mag * 0.25 ? '#cfa743' : '#d8b04a';
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
        this.panel(cx, bottom - h, w - 6, h, 3);
        if (active) { ctx.strokeStyle = '#d8b04a'; ctx.lineWidth = 2; rr(ctx, cx, bottom - h, w - 6, h, 3); ctx.stroke(); }
        ctx.globalAlpha = active ? 1 : 0.55;
        drawWeaponSide(ctx, s.id, cx + (w - 6) / 2, bottom - h / 2 - 5, 64);
        ctx.globalAlpha = active ? 1 : 0.6;
        ctx.fillStyle = '#fff';
        ctx.font = "600 10px 'Barlow', system-ui, sans-serif";
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
    drawStick(input.aimStick, input.aimStick.mag > 0.5 ? 'rgba(196,82,74,0.6)' : 'rgba(216,176,74,0.5)');
    // hints when idle
    if (input.moveStick.id === null) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.arc(this.safe.l + 110, this.H - 110 - this.safe.b, R, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = "600 11px 'Barlow', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('LAUFEN', this.safe.l + 110, this.H - 106 - this.safe.b);
    }
    if (input.aimStick.id === null) {
      const x = this.W - 150 - this.safe.r, y = this.H - 110 - this.safe.b;
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = "600 11px 'Barlow', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('ZIELEN', x, y - 2);
      ctx.fillText('& FEUERN', x, y + 12);
    }
    for (const b of input.buttons) {
      const pressed = b.touch !== null;
      ctx.fillStyle = pressed ? 'rgba(216,176,74,0.4)' : 'rgba(10,14,24,0.5)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = `700 ${b.r > 24 ? 12 : 13}px 'Barlow', system-ui, sans-serif`;
      if (b.id === 'pause') { ctx.fillRect(b.x - 6, b.y - 7, 4, 14); ctx.fillRect(b.x + 2, b.y - 7, 4, 14); }
      else if (b.id === 'score') { ctx.fillRect(b.x - 8, b.y - 6, 16, 3); ctx.fillRect(b.x - 8, b.y - 1, 16, 3); ctx.fillRect(b.x - 8, b.y + 4, 16, 3); }
      else if (b.id === 'reload') {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.42, -0.3, Math.PI * 1.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x + b.r * 0.42, b.y - b.r * 0.42); ctx.lineTo(b.x + b.r * 0.42, b.y - 1); ctx.lineTo(b.x + b.r * 0.08, b.y - b.r * 0.2); ctx.fill();
      } else if (b.id === 'swap' && me) {
        const next = me.slots[(me.cur + 1) % me.slots.length];
        drawWeaponSide(ctx, next?.id ?? 'pistol', b.x, b.y - 3, b.r * 1.55);
        ctx.font = "700 9px 'Barlow', system-ui, sans-serif";
        ctx.fillText('WECHSELN', b.x, b.y + b.r * 0.62);
      } else if (b.id === 'grenade' && me) {
        ctx.globalAlpha = me.grenades > 0 ? 1 : 0.35;
        drawWeaponSide(ctx, 'grenade', b.x, b.y - 4, b.r * 2.2);
        ctx.font = "700 10px 'Barlow', system-ui, sans-serif";
        ctx.fillStyle = '#fff';
        ctx.fillText(`× ${me.grenades}`, b.x, b.y + b.r * 0.66);
        ctx.globalAlpha = 1;
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
    this.panel(x, y, w, h, 4);
    ctx.textAlign = 'left';
    ctx.font = `700 ${small ? 15 : 18}px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
    ctx.fillStyle = '#d8b04a';
    const title = g.settings.mode === 'team' ? `${TEAM_NAMES[0]} ${g.teamKills[0]} : ${g.teamKills[1]} ${TEAM_NAMES[1]}`
      : g.settings.mode === 'survival' ? `Überleben – Welle ${g.wave}` : g.settings.mode === 'gungame' ? 'Waffenmeister' : 'Jeder gegen jeden';
    ctx.fillText(title, x + 16, y + 28);
    ctx.font = `600 ${small ? 10 : 12}px 'Barlow', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const cols = [w - 190, w - 125, w - 60];
    ctx.fillText('SPIELER', x + 16, y + 50);
    ctx.textAlign = 'right';
    ['KILLS', 'TODE', 'PUNKTE'].forEach((c, i) => ctx.fillText(c, x + cols[i] + 40, y + 50));
    rows.forEach((p, i) => {
      const ry = y + 56 + i * rh;
      if (p.id === g.localId) { ctx.fillStyle = 'rgba(216,176,74,0.12)'; ctx.fillRect(x + 6, ry, w - 12, rh); }
      ctx.textAlign = 'left';
      ctx.font = `600 ${small ? 11 : 13}px 'Barlow', system-ui, sans-serif`;
      ctx.fillStyle = p.team === 0 ? '#a9c8e6' : p.team === 1 ? '#e3a69e' : p.bot ? '#d1d5db' : '#e2d3ac';
      ctx.fillText(`${p.name}${p.level ? '  · Lv ' + p.level : ''}${p.alive ? '' : '  ✝'}`, x + 16, ry + rh * 0.7);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      [p.kills, p.deaths, p.score].forEach((v, j) => ctx.fillText(String(v), x + cols[j] + 40, ry + rh * 0.7));
    });
  }
}
