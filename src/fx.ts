// Visual + audio reactions to game events (particles, kill feed, damage numbers, shake).
import { WEAPONS, WeaponId } from './config';
import type { Game, GameEvent } from './game';
import { rand } from './rng';
import * as sfx from './audio';

export type PKind = 'spark' | 'blood' | 'smoke' | 'fire' | 'debris' | 'shell' | 'ring' | 'glow' | 'chip';
export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string;
  kind: PKind; rot: number; vr: number; drag: number; grow: number;
}
export interface FloatText { x: number; y: number; text: string; color: string; life: number; max: number; size: number }
export interface FeedItem { kn: string; kc: string; vn: string; vc: string; w: string; t: number; mine: boolean; info?: string }
export interface Beam { x: number; y: number; x2: number; y2: number; life: number }
export interface Flash { x: number; y: number; a: number; life: number; size: number }
export interface Message { text: string; sub: string; life: number; max: number; color: string }

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  feed: FeedItem[] = [];
  beams: Beam[] = [];
  flashes: Flash[] = [];
  messages: Message[] = [];
  shake = 0;
  hitMarker = 0;
  killMarker = 0;
  hurt = 0;
  recoil = 0;
  listener = { x: 0, y: 0 };
  myKills = 0;
  onEnd: ((ev: Extract<GameEvent, { e: 'end' }>) => void) | null = null;

  reset() {
    this.particles = [];
    this.texts = [];
    this.feed = [];
    this.beams = [];
    this.flashes = [];
    this.messages = [];
    this.shake = this.hitMarker = this.killMarker = this.hurt = this.recoil = 0;
    this.myKills = 0;
  }

  private spatial(x: number, y: number): [number, number] {
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const v = Math.max(0, 1 - d / 1500);
    return [v * v, dx / 900];
  }

  add(p: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'kind' | 'color'>) {
    if (this.particles.length > 700) this.particles.shift();
    const life = p.life ?? 0.5;
    this.particles.push({ vx: 0, vy: 0, size: 3, rot: Math.random() * 6.28, vr: 0, drag: 2, grow: 0, ...p, life, max: life });
  }

  message(text: string, sub = '', color = '#d8b04a', life = 2.2) {
    this.messages = this.messages.filter((m) => m.text !== text);
    this.messages.push({ text, sub, life, max: life, color });
    if (this.messages.length > 3) this.messages.shift();
  }

  text(x: number, y: number, text: string, color: string, size = 16) {
    this.texts.push({ x: x + rand(-8, 8), y, text, color, life: 0.9, max: 0.9, size });
    if (this.texts.length > 60) this.texts.shift();
  }

  explosion(x: number, y: number, r: number) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, s = rand(60, 380) * (r / 125);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'fire', color: '#ffb347', life: rand(0.3, 0.7), size: rand(10, 22), drag: 4, grow: -10 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, s = rand(20, 120);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'smoke', color: '#555', life: rand(0.8, 1.6), size: rand(14, 26), drag: 1.5, grow: 18 });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.28, s = rand(250, 600);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'spark', color: '#e2d3ac', life: rand(0.2, 0.5), size: 2, drag: 3 });
    }
    this.add({ x, y, kind: 'ring', color: '#fff3c4', life: 0.35, size: r * 0.3, grow: r * 2.6 });
    this.add({ x, y, kind: 'glow', color: '#ff9a3c', life: 0.25, size: r * 1.1 });
  }

  handle(ev: GameEvent, g: Game) {
    const local = g.localId;
    const name = (id: string | null) => (id ? g.players.get(id)?.name ?? '?' : '');
    const color = (id: string | null) => {
      const p = id ? g.players.get(id) : undefined;
      if (!p) return '#ccc';
      if (p.team === 0) return '#8fb8de';
      if (p.team === 1) return '#d9796e';
      return p.id === local ? '#d8b04a' : p.bot ? '#c3c7cc' : '#e2d3ac';
    };
    switch (ev.e) {
      case 'shot': {
        const def = WEAPONS[ev.w];
        const [v, pan] = this.spatial(ev.x, ev.y);
        sfx.sfxShot(ev.w, Math.min(1, v * (ev.p === local ? 1 : 0.85)), pan);
        if (def.kind !== 'flame') {
          this.flashes.push({ x: ev.x, y: ev.y, a: ev.a[0], life: 0.06, size: def.pellets > 1 ? 1.5 : def.id === 'sniper' ? 1.6 : 1 });
          if (def.kind === 'bullet') {
            const a = ev.a[0] + Math.PI / 2;
            this.add({ x: ev.x, y: ev.y, vx: Math.cos(a) * rand(60, 140), vy: Math.sin(a) * rand(60, 140), kind: 'shell', color: '#e0b04a', life: 0.6, size: 3, vr: rand(-15, 15), drag: 5 });
          }
        }
        if (ev.p === local) {
          this.shake = Math.min(14, this.shake + def.shake * 0.5);
          this.recoil = Math.min(10, this.recoil + def.shake * 0.6);
        }
        break;
      }
      case 'beam': {
        this.beams.push({ x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, life: 0.3 });
        const [v, pan] = this.spatial(ev.x, ev.y);
        sfx.sfxShot('rail', v, pan);
        for (let i = 0; i < 10; i++) this.add({ x: ev.x2, y: ev.y2, vx: rand(-200, 200), vy: rand(-200, 200), kind: 'spark', color: '#a6dbe4', life: 0.35, size: 2 });
        if (ev.p === local) this.shake = Math.min(14, this.shake + 4);
        break;
      }
      case 'hit': {
        const t = g.players.get(ev.t);
        const n = Math.min(10, 2 + ev.d / 8);
        for (let i = 0; i < n; i++) {
          this.add({ x: ev.x, y: ev.y, vx: rand(-160, 160), vy: rand(-160, 160), kind: 'blood', color: t?.bot ? '#7d241f' : '#8c2b24', life: rand(0.25, 0.5), size: rand(2, 4.5), drag: 6 });
        }
        const [v, pan] = this.spatial(ev.x, ev.y);
        if (ev.by === local && ev.t !== local) {
          this.hitMarker = 0.15;
          this.text(ev.x, ev.y - 24, String(ev.d), ev.d >= 50 ? '#d8b04a' : '#e8e8e8', ev.d >= 50 ? 16 : 13);
          sfx.sfxHit(0.6, pan, true);
        } else if (ev.t === local) {
          this.hurt = Math.min(1, this.hurt + 0.25 + ev.d / 120);
          this.shake = Math.min(14, this.shake + 3);
          sfx.sfxHurt();
        } else sfx.sfxHit(v * 0.5, pan, false);
        break;
      }
      case 'kill': {
        const v = g.players.get(ev.v);
        const wname = ev.w === 'boom' ? 'Explosion' : WEAPONS[ev.w as WeaponId]?.name ?? '';
        this.feed.push({ kn: name(ev.k), kc: color(ev.k), vn: name(ev.v), vc: color(ev.v), w: wname, t: 5, mine: ev.k === local || ev.v === local });
        if (this.feed.length > 6) this.feed.shift();
        if (v) {
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * 6.28, s = rand(80, 260);
            this.add({ x: v.x, y: v.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'blood', color: '#7a221c', life: rand(0.4, 0.8), size: rand(3, 6), drag: 5 });
          }
                  }
        if (ev.k === local && ev.v !== local) {
          this.myKills++;
          this.killMarker = 0.5;
          sfx.sfxKill(true);
          if (v) this.text(v.x, v.y - 40, v.boss ? '+500' : '+100', '#9ccc96', 16);
        } else sfx.sfxKill(false);
        if (ev.v === local) this.hurt = 1;
        break;
      }
      case 'crate': {
        const s = g.map.solids[ev.id];
        if (!s) break;
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        const [v, pan] = this.spatial(cx, cy);
        const wood = s.kind === 'crate';
        if (ev.hp <= 0) {
          for (let i = 0; i < 18; i++) {
            this.add({ x: cx + rand(-15, 15), y: cy + rand(-15, 15), vx: rand(-240, 240), vy: rand(-240, 240), kind: 'debris',
              color: wood ? (Math.random() < 0.5 ? '#a8743f' : '#7a4f22') : '#c33', life: rand(0.5, 1.1), size: rand(4, 9), vr: rand(-12, 12), drag: 4 });
          }
          for (let i = 0; i < 5; i++) this.add({ x: cx, y: cy, vx: rand(-40, 40), vy: rand(-40, 40), kind: 'smoke', color: '#9a8a76', life: rand(0.6, 1.1), size: 16, grow: 20, drag: 2 });
          sfx.sfxCrate(v, pan);
        } else if (Math.random() < 0.5) {
          this.add({ x: cx + rand(-s.w / 2, s.w / 2), y: cy + rand(-s.h / 2, s.h / 2), vx: rand(-120, 120), vy: rand(-120, 120), kind: 'chip', color: '#c8955a', life: 0.4, size: 3, drag: 5 });
        }
        break;
      }
      case 'boom': {
        this.explosion(ev.x, ev.y, ev.r);
        const [v, pan] = this.spatial(ev.x, ev.y);
        sfx.sfxBoom(Math.min(1, v * 1.2), pan);
        this.shake = Math.min(22, this.shake + 16 * v);
        break;
      }
      case 'spark': {
        for (let i = 0; i < 4; i++) {
          const a = ev.a + rand(-1, 1), s = rand(80, 260);
          this.add({ x: ev.x, y: ev.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind: 'spark', color: ev.c, life: rand(0.1, 0.25), size: 1.6, drag: 4 });
        }
        break;
      }
      case 'heal': {
        if (ev.p !== local) break;
        sfx.sfxPickup(ev.kind);
        const p = g.local;
        if (!p) break;
        if (ev.kind === 'health') this.text(p.x, p.y - 34, '+50 LP', '#9ccc96', 18);
        else if (ev.kind === 'armor') this.text(p.x, p.y - 34, '+50 Rüstung', '#8fb8de', 18);
        else this.message(WEAPONS[p.wid].name, 'Waffe aufgehoben', '#d8b04a', 1.6);
        break;
      }
      case 'pk': {
        const pk = g.pickups[ev.i];
        if (pk && ev.on) this.add({ x: pk.x, y: pk.y, kind: 'ring', color: '#ffffff', life: 0.4, size: 8, grow: 60 });
        break;
      }
      case 'spawn': {
        const p = g.players.get(ev.p);
        if (p) this.add({ x: ev.x, y: ev.y, kind: 'ring', color: '#9fbfcf', life: 0.5, size: 10, grow: 90 });
        if (ev.p === local) this.hurt = 0;
        break;
      }
      case 'join': {
        if (!ev.pl.bot) this.feed.push({ kn: '', kc: '#ccc', vn: ev.pl.name, vc: '#9ccc96', w: '', t: 4, mine: false, info: 'ist beigetreten' });
        break;
      }
      case 'leave': {
        const p = g.players.get(ev.p);
        if (p && !p.bot) this.feed.push({ kn: '', kc: '#ccc', vn: p.name, vc: '#d9958c', w: '', t: 4, mine: false, info: 'hat das Spiel verlassen' });
        break;
      }
      case 'wave':
        this.message(`Welle ${ev.n}`, ev.boss ? 'Schwer gepanzerter Gegner im Anmarsch' : 'Feindkontakt', ev.boss ? '#d9796e' : '#d8b04a', 2.8);
        sfx.sfxUi('wave');
        break;
      case 'msg':
        this.message(ev.text, '', '#d8b04a', 2.2);
        break;
      case 'empty':
        if (ev.p === local) sfx.sfxEmpty();
        break;
      case 'reload':
        if (ev.p === local) sfx.sfxReload();
        break;
      case 'end':
        this.onEnd?.(ev);
        break;
      default:
        break;
    }
  }

  update(dt: number, g: Game) {
    for (const p of this.particles) {
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size = Math.max(0.1, p.size + p.grow * dt);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) { t.life -= dt; t.y -= 40 * dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    for (const m of this.messages) m.life -= dt;
    this.messages = this.messages.filter((m) => m.life > 0);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.recoil = Math.max(0, this.recoil - dt * 40);
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.killMarker = Math.max(0, this.killMarker - dt);
    this.hurt = Math.max(0, this.hurt - dt * 0.9);
    // rocket smoke trails + flame embers
    for (const b of g.bullets) {
      const def = WEAPONS[b.w];
      if (def.kind === 'rocket' && Math.random() < 0.8) {
        this.add({ x: b.x - b.vx * 0.02, y: b.y - b.vy * 0.02, vx: rand(-15, 15), vy: rand(-15, 15), kind: 'smoke', color: '#8a8a8a', life: rand(0.4, 0.7), size: 6, grow: 16, drag: 2 });
      }
    }
  }
}
