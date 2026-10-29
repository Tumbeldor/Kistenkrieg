// Match simulation. The host runs it with authority=true (bots, damage, scoring, pickups);
// clients run it with authority=false to move their own player, simulate visual bullets
// and apply the host's snapshots/events.
import {
  BASE_HP, BASE_SPEED, DIFFS, MAX_TOTAL, MatchSettings, MapId, PERKS, PICKUP_WEAPONS, PLAYER_RADIUS, PerkId,
  RESPAWN_TIME, SPAWN_PROTECT, WEAPONS, WEAPON_LIST, WeaponId, BOT_NAMES, GUN_TIERS, GRENADES, isFfa,
} from './config';
import { GameMap, MapSize, PickupKind, Solid } from './map';
import { Vec, angleDiff, dist, dist2, lerp, lerpAngle, segCircle } from './geom';
import { WeaponSlot, loadout, magSize, makeSlot, tickWeapon } from './weapons';
import { Bot } from './bot';
import { pick, rand } from './rng';

export interface PlayerInput {
  mx: number;
  my: number;
  aim: number;
  fire: boolean;
  reload: boolean;
  next: boolean;
  slot: number; // -1 = no change
  throw: boolean; // hand grenade
  throwDist: number; // desired throw distance (0 = default)
}
export const emptyInput = (): PlayerInput => ({ mx: 0, my: 0, aim: 0, fire: false, reload: false, next: false, slot: -1, throw: false, throwDist: 0 });

export interface PlayerInfo {
  id: string;
  name: string;
  bot: boolean;
  team: number; // -1 = free for all
  skin: string;
  hat: string;
  level: number;
  perk: PerkId;
  primary: WeaponId;
  boss?: boolean;
  hpMul?: number;
}

export interface Player extends PlayerInfo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  r: number;
  hp: number;
  maxHp: number;
  armor: number;
  alive: boolean;
  respawnT: number;
  protectT: number;
  slots: WeaponSlot[];
  cur: number;
  wid: WeaponId;
  reloading: boolean;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  lastShotAt: number;
  lastHurtAt: number;
  lastAttacker: string | null;
  killedBy: string | null;
  spawnSeq: number;
  dmgMul: number;
  brain: Bot | null;
  removeT: number;
  grenades: number;
  nextThrow: number;
  tier: number; // Waffenmeister: index into GUN_TIERS
  lastBurnAt: number;
  // client-side interpolation buffer
  buf: { t: number; x: number; y: number; a: number }[];
}

export interface Bullet {
  id: string;
  owner: string;
  team: number;
  w: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  travelled: number;
  range: number;
  dmg: number;
  pierce: number;
  hit: string[];
  visual: boolean;
  dead: boolean;
  age: number;
}

export interface Pickup { i: number; x: number; y: number; kind: PickupKind; w: WeaponId | null; on: boolean; t: number }

export interface ResultRow { id: string; name: string; bot: boolean; team: number; kills: number; deaths: number; score: number; place: number }
export interface MatchResult { mode: MatchSettings['mode']; winnerTeam: number | null; winnerId: string | null; rows: ResultRow[]; wave: number; duration: number }

export type GameEvent =
  | { e: 'shot'; p: string; w: WeaponId; x: number; y: number; a: number[]; b: string; pw?: number }
  | { e: 'beam'; p: string; x: number; y: number; x2: number; y2: number }
  | { e: 'hit'; t: string; by: string; d: number; x: number; y: number; b?: string }
  | { e: 'kill'; k: string | null; v: string; w: WeaponId | 'boom' }
  | { e: 'crate'; id: number; hp: number }
  | { e: 'boom'; x: number; y: number; r: number }
  | { e: 'bend'; b: string }
  | { e: 'pk'; i: number; on: 0 | 1; w?: WeaponId | null }
  | { e: 'give'; p: string; w: WeaponId }
  | { e: 'heal'; p: string; kind: PickupKind }
  | { e: 'spawn'; p: string; x: number; y: number; sq: number }
  | { e: 'join'; pl: PlayerInfo }
  | { e: 'leave'; p: string }
  | { e: 'wave'; n: number; boss: boolean }
  | { e: 'arm'; p: string; tier: number }
  | { e: 'msg'; text: string }
  | { e: 'end'; res: MatchResult }
  // local-only effects (never sent)
  | { e: 'spark'; x: number; y: number; a: number; c: string }
  | { e: 'empty'; p: string }
  | { e: 'reload'; p: string };

export interface ShotMsg { w: WeaponId; x: number; y: number; a: number[]; b: string; pw?: number }

export interface GameOptions {
  authority: boolean;
  settings: MatchSettings;
  seed: number;
  mapId: MapId;
  size: MapSize;
  localId: string;
}

const PICKUP_RESPAWN: Record<PickupKind, number> = { health: 18, armor: 25, weapon: 22 };
const BOSS_NAMES = ['Juggernaut', 'Koloss', 'Bollwerk', 'Titan', 'Rammbock'];

/** Distance a full-power hand grenade travels before it explodes (speed · (1 − 0.3^fuse) / ln(1/0.3)). */
const GRENADE_REACH = (WEAPONS.grenade.speed * (1 - Math.pow(0.3, WEAPONS.grenade.fuse))) / Math.log(1 / 0.3);
/** Fire from the flamethrower is gone after this many seconds. */
export const FLAME_LIFE = 10;
const grenadeCount = (perk: PerkId) => GRENADES + (perk === 'grenadier' ? 2 : 0);

/** Outward surface normal of a solid at a point on its edge. */
function normalAt(s: Solid, x: number, y: number): Vec {
  if (s.round) {
    const l = Math.hypot(x - s.cx, y - s.cy) || 1;
    return { x: (x - s.cx) / l, y: (y - s.cy) / l };
  }
  const d = [Math.abs(x - s.x), Math.abs(x - (s.x + s.w)), Math.abs(y - s.y), Math.abs(y - (s.y + s.h))];
  const m = Math.min(...d);
  return m === d[0] ? { x: -1, y: 0 } : m === d[1] ? { x: 1, y: 0 } : m === d[2] ? { x: 0, y: -1 } : { x: 0, y: 1 };
}

export const sameTeam = (a: { team: number }, b: { team: number }) => a.team >= 0 && a.team === b.team;

export class Game {
  readonly authority: boolean;
  readonly settings: MatchSettings;
  readonly map: GameMap;
  readonly seed: number;
  readonly mapId: MapId;
  readonly size: MapSize;
  localId: string;
  time = 0;
  players = new Map<string, Player>();
  list: Player[] = [];
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  fx: GameEvent[] = [];
  net: GameEvent[] = [];
  outShots: ShotMsg[] = [];
  teamKills = [0, 0];
  timeLeft: number;
  wave = 0;
  waveT = 4;
  waveToSpawn = 0;
  waveSpawnT = 0;
  enemiesLeft = 0;
  over = false;
  result: MatchResult | null = null;
  private seq = 0;
  private botSeq = 0;
  private usedNames = new Set<string>();

  constructor(o: GameOptions) {
    this.authority = o.authority;
    this.settings = o.settings;
    this.seed = o.seed;
    this.mapId = o.mapId;
    this.size = o.size;
    this.localId = o.localId;
    this.map = new GameMap(o.seed, o.mapId, o.size);
    this.timeLeft = o.settings.mode === 'survival' ? 0 : o.settings.timeLimit;
    this.pickups = this.map.pickupSpots.map((s, i) => ({
      i, x: s.x, y: s.y, kind: s.kind, w: s.kind === 'weapon' ? pick(PICKUP_WEAPONS) : null,
      on: !(s.kind === 'weapon' && o.settings.mode === 'gungame'), t: 0, // Waffenmeister: no weapon pickups
    }));
  }

  get local(): Player | undefined {
    return this.players.get(this.localId);
  }

  emit(ev: GameEvent, broadcast = true) {
    this.fx.push(ev);
    if (this.authority && broadcast) this.net.push(ev);
  }

  // ------------------------------------------------------------ players

  addPlayer(info: PlayerInfo, spawn: boolean): Player {
    const perkHp = info.perk === 'tough' ? 25 : 0;
    const maxHp = Math.round((BASE_HP + perkHp) * (info.hpMul ?? 1));
    const p: Player = {
      ...info, x: this.map.w / 2, y: this.map.h / 2, vx: 0, vy: 0, aim: 0, r: info.boss ? 28 : PLAYER_RADIUS,
      hp: maxHp, maxHp, armor: 0, alive: false, respawnT: 0, protectT: 0,
      slots: loadout(info.primary, info.perk), cur: 0, wid: info.primary, reloading: false,
      kills: 0, deaths: 0, score: 0, streak: 0, lastShotAt: -9, lastHurtAt: -9, lastAttacker: null, killedBy: null,
      spawnSeq: 0, dmgMul: 1, brain: null, removeT: 0, buf: [],
      grenades: grenadeCount(info.perk), nextThrow: 0, tier: 0, lastBurnAt: -9,
    };
    if (this.settings.mode === 'gungame') { p.slots = this.armSlots(p); p.wid = p.slots[0].id; }
    if (info.bot) {
      const diff = DIFFS[this.settings.diff];
      p.dmgMul = diff.dmgMul * (info.boss ? 1.2 : 1);
      p.brain = new Bot(diff);
    }
    this.players.set(p.id, p);
    this.list = [...this.players.values()];
    if (this.authority) {
      this.emit({ e: 'join', pl: this.infoOf(p) });
      if (spawn) this.spawnPlayer(p);
    }
    return p;
  }

  infoOf(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, bot: p.bot, team: p.team, skin: p.skin, hat: p.hat, level: p.level, perk: p.perk,
      primary: p.primary, boss: p.boss, hpMul: p.hpMul };
  }

  removePlayer(id: string) {
    if (!this.players.delete(id)) return;
    this.list = [...this.players.values()];
    if (this.authority) this.emit({ e: 'leave', p: id });
  }

  /** Change loadout (takes effect on next spawn). */
  setLoadout(id: string, primary: WeaponId, perk: PerkId, skin: string, hat: string) {
    const p = this.players.get(id);
    if (!p) return;
    p.primary = primary;
    p.skin = skin;
    p.hat = hat;
    if (p.perk !== perk) {
      p.perk = perk;
      const maxHp = Math.round((BASE_HP + (perk === 'tough' ? 25 : 0)) * (p.hpMul ?? 1));
      p.maxHp = maxHp;
      p.hp = Math.min(p.hp, maxHp);
    }
  }

  addBot(team: number, opts: { boss?: boolean; hpMul?: number; weapon?: WeaponId } = {}): Player {
    let name = pick(BOT_NAMES);
    for (let i = 0; i < 6 && this.usedNames.has(name); i++) name = pick(BOT_NAMES);
    this.usedNames.add(name);
    if (opts.boss) name = pick(BOSS_NAMES);
    const diff = this.settings.diff;
    const pool: WeaponId[] = diff === 'easy' ? ['pistol', 'smg', 'smg', 'shotgun', 'revolver']
      : diff === 'normal' ? ['smg', 'rifle', 'shotgun', 'pistol', 'smg', 'revolver', 'crossbow', 'smgsil']
      : diff === 'hard' ? ['smg', 'rifle', 'shotgun', 'rifle', 'sniper', 'minigun', 'dmr', 'lmg', 'autoshotgun', 'crossbow']
      : ['rifle', 'shotgun', 'sniper', 'minigun', 'rocket', 'rail', 'smg', 'dmr', 'lmg', 'autoshotgun', 'gl'];
    const skins = ['woodland', 'desert', 'urban', 'olive', 'navy', 'black', 'digital', 'tiger', 'arid'];
    const hats = ['none', 'cap', 'beanie', 'headset', 'helmet', 'helmet', 'boonie', 'beret', 'balaclava'];
    const info: PlayerInfo = {
      id: 'b' + ++this.botSeq, name: opts.boss ? name : 'KI-' + name, bot: true, team,
      skin: opts.boss ? 'black' : pick(skins), hat: opts.boss ? 'tactical' : pick(hats), level: 0, perk: 'none',
      primary: opts.weapon ?? pick(pool), boss: opts.boss, hpMul: (opts.hpMul ?? 1) * DIFFS[diff].hpMul,
    };
    return this.addPlayer(info, true);
  }

  private chooseSpawn(p: Player): Vec {
    const spawns = this.map.spawns;
    const enemies = this.list.filter((o) => o !== p && o.alive && !sameTeam(o, p));
    const mode = this.settings.mode;
    let cands = spawns;
    if (mode === 'team' && p.team >= 0) {
      const side = spawns.filter((s) => (p.team === 0 ? s.x < this.map.w * 0.45 : s.x > this.map.w * 0.55));
      if (side.length >= 2) cands = side;
    }
    if (mode === 'survival' && !p.bot) {
      const cx = this.map.w / 2, cy = this.map.h / 2;
      cands = [...spawns].sort((a, b) => dist2(a.x, a.y, cx, cy) - dist2(b.x, b.y, cx, cy)).slice(0, 4);
    }
    const scored = cands.map((s) => {
      let d = 1e9;
      for (const e of enemies) d = Math.min(d, dist(s.x, s.y, e.x, e.y));
      for (const o of this.list) if (o !== p && o.alive && dist(s.x, s.y, o.x, o.y) < 60) d = -1;
      return { s, d: d + Math.random() * 120 };
    });
    scored.sort((a, b) => b.d - a.d);
    const top = scored.slice(0, Math.min(3, scored.length));
    return { ...pick(top).s };
  }

  /** Weapons a player spawns with: loadout, or the current tier in Waffenmeister. */
  armSlots(p: Player): WeaponSlot[] {
    if (this.settings.mode !== 'gungame') return loadout(p.primary, p.perk);
    return [makeSlot(GUN_TIERS[Math.min(p.tier, GUN_TIERS.length - 1)], p.perk)];
  }

  /** Waffenmeister: hand the player the weapon of their current tier. */
  private arm(p: Player) {
    p.slots = this.armSlots(p);
    p.cur = 0;
    p.wid = p.slots[0].id;
    this.emit({ e: 'arm', p: p.id, tier: p.tier });
  }

  spawnPlayer(p: Player) {
    const s = this.chooseSpawn(p);
    p.x = s.x;
    p.y = s.y;
    p.vx = p.vy = 0;
    p.alive = true;
    p.hp = p.maxHp;
    p.armor = 0;
    p.protectT = SPAWN_PROTECT;
    p.slots = this.armSlots(p);
    p.cur = 0;
    p.wid = p.slots[0].id;
    p.grenades = grenadeCount(p.perk);
    p.spawnSeq++;
    p.killedBy = null;
    p.buf.length = 0;
    if (p.brain) p.brain.reset();
    this.emit({ e: 'spawn', p: p.id, x: Math.round(p.x), y: Math.round(p.y), sq: p.spawnSeq });
  }

  // ------------------------------------------------------------ main update

  update(dt: number, input: PlayerInput | null) {
    if (this.over) {
      this.updateBullets(dt);
      return;
    }
    this.time += dt;
    for (const p of this.list) {
      if (!p.alive) {
        if (this.authority && p.bot && this.settings.mode === 'survival' && p.team === 1) {
          p.removeT -= dt;
          if (p.removeT <= 0) this.removePlayer(p.id);
          continue;
        }
        if (this.authority && this.settings.mode !== 'survival') {
          p.respawnT -= dt;
          if (p.respawnT <= 0) this.spawnPlayer(p);
        }
        continue;
      }
      if (p.protectT > 0) p.protectT -= dt;
      const isLocal = p.id === this.localId;
      if (isLocal && input) this.control(p, input, dt);
      else if (this.authority && p.brain) this.control(p, p.brain.think(this, p, dt), dt);
      if (this.authority && p.perk === 'regen' && this.time - p.lastHurtAt > 4 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + 6 * dt);
      }
    }
    if (this.authority) this.separate();
    else this.interpolate();
    this.updateBullets(dt);
    if (this.authority) {
      this.updatePickups(dt);
      this.updateMode(dt);
    } else if (this.settings.mode !== 'survival') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
    }
  }

  private control(p: Player, inp: PlayerInput, dt: number) {
    p.aim = inp.aim;
    // weapon switching
    if (inp.slot >= 0 && inp.slot < p.slots.length && inp.slot !== p.cur) this.switchTo(p, inp.slot);
    else if (inp.next && p.slots.length > 1) this.switchTo(p, (p.cur + 1) % p.slots.length);
    let slot = p.slots[p.cur];
    const def = WEAPONS[slot.id];
    // movement
    let mx = inp.mx, my = inp.my;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const botMul = p.bot ? DIFFS[this.settings.diff].speed : 1;
    const speed = BASE_SPEED * def.moveMul * botMul * (p.perk === 'swift' ? 1.12 : 1) * (p.boss ? 0.8 : 1) * (slot.spin > 0.5 ? 0.85 : 1);
    // bots accelerate a little softer so direction changes look less twitchy
    const k = Math.min(1, dt * (p.bot ? 9 : 14));
    p.vx += (mx * speed - p.vx) * k;
    p.vy += (my * speed - p.vy) * k;
    this.map.moveCircle(p, p.vx * dt, p.vy * dt, p.r);
    // weapon
    const res = tickWeapon(slot, p.perk, dt, inp.fire, inp.reload);
    if (res.empty) {
      if (slot.pickup && slot.reserve <= 0) {
        p.slots.splice(p.cur, 1);
        p.cur = 0;
        slot = p.slots[0];
      } else this.emit({ e: 'empty', p: p.id }, false);
    }
    if (res.reloadStarted) this.emit({ e: 'reload', p: p.id }, false);
    for (let i = 0; i < res.shots; i++) this.fire(p, def.id);
    if (inp.throw && p.grenades > 0 && this.time >= p.nextThrow) {
      p.grenades--;
      p.nextThrow = this.time + 0.8;
      // throw so that the grenade comes to rest near the requested distance when the fuse runs out
      const want = inp.throwDist > 0 ? inp.throwDist : 400;
      this.fire(p, 'grenade', Math.max(0.25, Math.min(1, want / GRENADE_REACH)));
    }
    if (slot.pickup && slot.ammo <= 0 && slot.reserve <= 0 && p.slots.length > 1) {
      p.slots.splice(p.cur, 1);
      p.cur = 0;
    }
    p.wid = p.slots[p.cur].id;
    p.reloading = p.slots[p.cur].reloadT > 0;
  }

  switchTo(p: Player, idx: number) {
    const old = p.slots[p.cur];
    if (old) old.reloadT = 0;
    p.cur = idx;
    const s = p.slots[idx];
    s.cool = Math.max(s.cool, 0.2);
    p.wid = s.id;
  }

  giveWeapon(p: Player, w: WeaponId) {
    const existing = p.slots.findIndex((s) => s.id === w);
    if (existing >= 0 && p.slots[existing].pickup) {
      p.slots[existing] = makeSlot(w, p.perk, true);
      this.switchTo(p, existing);
      return;
    }
    const slot = makeSlot(w, p.perk, true);
    const pi = p.slots.findIndex((s) => s.pickup);
    if (pi >= 0) p.slots[pi] = slot;
    else p.slots.push(slot);
    this.switchTo(p, pi >= 0 ? pi : p.slots.length - 1);
  }

  // ------------------------------------------------------------ shooting

  private muzzle(p: Player, w: WeaponId): Vec {
    const def = WEAPONS[w];
    const l = p.r + def.len * 0.75;
    const mx = p.x + Math.cos(p.aim) * l;
    const my = p.y + Math.sin(p.aim) * l;
    const hit = this.map.raycast(p.x, p.y, mx, my);
    if (hit.solid) return { x: lerp(p.x, mx, hit.t * 0.85), y: lerp(p.y, my, hit.t * 0.85) };
    return { x: mx, y: my };
  }

  private fire(p: Player, w: WeaponId, power = 1) {
    const def = WEAPONS[w];
    const mz = this.muzzle(p, w);
    const angles: number[] = [];
    const spread = def.spread;
    for (let i = 0; i < def.pellets; i++) {
      const base = def.pellets > 1 ? (i / (def.pellets - 1) - 0.5) * spread : (Math.random() - 0.5) * spread;
      const jitter = def.pellets > 1 ? (Math.random() - 0.5) * spread * 0.25 : 0;
      angles.push(Math.round((p.aim + base + jitter) * 1000) / 1000);
    }
    if (!def.silent) p.lastShotAt = this.time;
    if (this.authority) this.alertBots(p, mz.x, mz.y, w);
    const b = p.id + '.' + ++this.seq;
    const x = Math.round(mz.x), y = Math.round(mz.y);
    if (def.kind === 'beam') {
      const end = this.beam(p, x, y, angles[0], !this.authority);
      this.emit({ e: 'beam', p: p.id, x, y, x2: Math.round(end.x), y2: Math.round(end.y) });
    } else {
      const pw = power < 1 ? Math.round(power * 100) / 100 : undefined;
      this.spawnBullets(p, w, x, y, angles, b, !this.authority, pw);
      this.emit({ e: 'shot', p: p.id, w, x, y, a: angles, b, pw });
    }
    if (!this.authority) this.outShots.push({ w, x, y, a: angles, b, pw: power < 1 ? Math.round(power * 100) / 100 : undefined });
  }

  /** Host: a client reported a shot. */
  applyRemoteShot(pid: string, s: ShotMsg) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !WEAPONS[s.w] || !Array.isArray(s.a)) return;
    const def = WEAPONS[s.w];
    if (!def.silent) p.lastShotAt = this.time;
    this.alertBots(p, s.x, s.y, s.w);
    const angles = s.a.slice(0, def.pellets);
    if (def.kind === 'beam') {
      const end = this.beam(p, s.x, s.y, angles[0], false);
      this.emit({ e: 'beam', p: pid, x: s.x, y: s.y, x2: Math.round(end.x), y2: Math.round(end.y) });
    } else {
      const pw = typeof s.pw === 'number' ? Math.max(0.2, Math.min(1, s.pw)) : undefined;
      this.spawnBullets(p, s.w, s.x, s.y, angles, String(s.b), false, pw);
      this.emit({ e: 'shot', p: pid, w: s.w, x: s.x, y: s.y, a: angles, b: String(s.b), pw });
    }
  }

  /** Gunfire is audible: nearby enemy bots investigate the area. */
  private alertBots(shooter: Player, x: number, y: number, w: WeaponId) {
    const def = WEAPONS[w];
    if (def.silent) return;
    const range = w === 'grenade' ? 500 : def.kind === 'flame' ? 450 : w === 'sniper' || w === 'rocket' || w === 'rail' ? 1400 : 1000;
    for (const b of this.list) {
      if (!b.brain || !b.alive || b === shooter || sameTeam(b, shooter)) continue;
      if (dist2(b.x, b.y, x, y) < range * range) b.brain.onNoise(x, y);
    }
  }

  spawnBullets(p: { id: string; team: number }, w: WeaponId, x: number, y: number, angles: number[], b: string, visual: boolean, power = 1) {
    const def = WEAPONS[w];
    angles.forEach((a, i) => {
      const sp = def.speed * power * (def.pellets > 1 ? rand(0.85, 1.1) : def.kind === 'flame' ? rand(0.8, 1.15) : 1);
      this.bullets.push({
        id: def.pellets > 1 ? b + ':' + i : b, owner: p.id, team: p.team, w, x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, travelled: 0, range: def.range * (def.kind === 'flame' ? rand(0.75, 1.1) : 1),
        dmg: def.dmg, pierce: def.pierce, hit: [], visual, dead: false, age: 0,
      });
    });
  }

  /** Instant beam: pierces players and crates, stops at walls/rocks/steel. */
  private beam(p: Player, x: number, y: number, a: number, visual: boolean): Vec {
    const def = WEAPONS.rail;
    const x2 = x + Math.cos(a) * def.range;
    const y2 = y + Math.sin(a) * def.range;
    const hit = this.map.raycast(x, y, x2, y2, (s) => s.kind !== 'crate' && s.kind !== 'barrel');
    const ex = lerp(x, x2, hit.t), ey = lerp(y, y2, hit.t);
    if (!visual) {
      const dx = ex - x, dy = ey - y;
      for (const o of this.list) {
        if (o === p || !o.alive || sameTeam(o, p)) continue;
        if (segCircle(x, y, dx, dy, o.x, o.y, o.r) >= 0) this.damagePlayer(o, def.dmg, p, 'rail', o.x, o.y);
      }
      // crates along the beam
      for (const s of [...this.map.query(x, y, ex, ey)]) {
        if (s.kind !== 'crate' && s.kind !== 'barrel') continue;
        if (this.map.raycast(x, y, ex, ey, (q) => q === s).solid) this.damageSolid(s, def.dmg * def.crateMul, p.id);
      }
    }
    return { x: ex, y: ey };
  }

  // ------------------------------------------------------------ bullets

  private updateBullets(dt: number) {
    const map = this.map;
    for (const b of this.bullets) {
      if (b.dead) continue;
      const def = WEAPONS[b.w];
      b.age += dt;
      if (def.kind === 'flame') {
        const drag = Math.pow(0.12, dt);
        b.vx *= drag;
        b.vy *= drag;
        if (b.age >= FLAME_LIFE) { b.dead = true; continue; }
        if (b.vx * b.vx + b.vy * b.vy < 30 * 30) {
          // the flame came to rest: some of them keep burning on the ground, the rest go out
          if (b.vx !== 0 || b.vy !== 0) {
            if (Math.random() > 0.35) { b.dead = true; continue; }
            b.vx = b.vy = 0;
          }
          if (!b.visual) this.burnGround(b);
          continue;
        }
      } else if (def.kind === 'grenade') {
        const drag = Math.pow(0.3, dt);
        b.vx *= drag;
        b.vy *= drag;
        if (b.age >= def.fuse) {
          b.dead = true;
          if (!b.visual) {
            this.explode(b.x, b.y, def.splash, def.splashDmg, b.owner, b.w);
            this.emit({ e: 'bend', b: b.id });
          }
          continue;
        }
      }
      const dx = b.vx * dt;
      const dy = b.vy * dt;
      const stepLen = Math.hypot(dx, dy);
      const rh = map.raycast(b.x, b.y, b.x + dx, b.y + dy);
      const tSolid = rh.solid ? rh.t : 1;
      // players
      const hits: { t: number; p: Player }[] = [];
      for (const o of this.list) {
        if (!o.alive || o.id === b.owner || b.hit.includes(o.id)) continue;
        if (b.team >= 0 && o.team === b.team) continue;
        const t = segCircle(b.x, b.y, dx, dy, o.x, o.y, o.r + (def.kind === 'flame' ? 8 : 2));
        if (t >= 0 && t <= tSolid) hits.push({ t, p: o });
      }
      hits.sort((a, c) => a.t - c.t);
      for (const h of hits) {
        const hx = b.x + dx * h.t, hy = b.y + dy * h.t;
        b.hit.push(h.p.id);
        if (h.p.protectT > 0) {
          b.dead = true;
          this.emit({ e: 'spark', x: hx, y: hy, a: Math.atan2(-dy, -dx), c: '#9be7ff' }, false);
          break;
        }
        if (!b.visual) {
          const owner = this.players.get(b.owner);
          if (def.kind === 'rocket' || def.kind === 'grenade') {
            if (b.dmg > 0) this.damagePlayer(h.p, b.dmg, owner ?? null, b.w, hx, hy, b.id);
            this.explode(hx, hy, def.splash, def.splashDmg, b.owner, b.w);
            this.emit({ e: 'bend', b: b.id });
          } else {
            this.damagePlayer(h.p, b.dmg, owner ?? null, b.w, hx, hy, b.id);
          }
        }
        if (b.pierce-- <= 0 || def.kind === 'rocket' || def.kind === 'grenade') {
          b.dead = true;
          b.x = hx;
          b.y = hy;
          break;
        }
      }
      if (b.dead) continue;
      if (rh.solid && def.kind === 'grenade') {
        // bounce off walls and crates
        const hx = b.x + dx * rh.t, hy = b.y + dy * rh.t;
        const n = normalAt(rh.solid, hx, hy);
        const dot = b.vx * n.x + b.vy * n.y;
        b.vx = (b.vx - 2 * dot * n.x) * 0.55;
        b.vy = (b.vy - 2 * dot * n.y) * 0.55;
        b.x = hx + n.x * 2;
        b.y = hy + n.y * 2;
        continue;
      }
      if (rh.solid) {
        const hx = b.x + dx * rh.t, hy = b.y + dy * rh.t;
        b.dead = true;
        b.x = hx;
        b.y = hy;
        if (def.kind !== 'flame') this.emit({ e: 'spark', x: hx, y: hy, a: Math.atan2(-dy, -dx), c: rh.solid.kind === 'crate' ? '#c8955a' : '#ffe9b0' }, false);
        if (!b.visual) {
          if (def.kind === 'rocket') {
            this.explode(hx - Math.cos(Math.atan2(dy, dx)) * 6, hy - Math.sin(Math.atan2(dy, dx)) * 6, def.splash, def.splashDmg, b.owner, b.w);
            this.emit({ e: 'bend', b: b.id });
          }
          this.damageSolid(rh.solid, b.dmg * def.crateMul, b.owner);
        }
        continue;
      }
      b.x += dx;
      b.y += dy;
      b.travelled += stepLen;
      if (b.travelled >= b.range) {
        b.dead = true;
        if (!b.visual && def.kind === 'rocket') {
          this.explode(b.x, b.y, def.splash, def.splashDmg, b.owner, b.w);
          this.emit({ e: 'bend', b: b.id });
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  /** Burning ground hurts players standing in it (at most every 0.25 s per player). */
  private burnGround(b: Bullet) {
    for (const o of this.list) {
      if (!o.alive || o.id === b.owner || (b.team >= 0 && o.team === b.team)) continue;
      if (this.time - o.lastBurnAt < 0.25 || dist2(b.x, b.y, o.x, o.y) > (o.r + 16) ** 2) continue;
      o.lastBurnAt = this.time;
      this.damagePlayer(o, 4, this.players.get(b.owner) ?? null, 'flamer', o.x, o.y);
    }
  }

  removeBullet(id: string) {
    for (const b of this.bullets) if (b.id === id || b.id.startsWith(id + ':')) b.dead = true;
  }

  // ------------------------------------------------------------ damage

  damagePlayer(t: Player, dmg: number, attacker: Player | null, w: WeaponId | 'boom', x: number, y: number, bid?: string) {
    if (!this.authority || !t.alive || t.protectT > 0 || this.over) return;
    if (attacker && attacker !== t && sameTeam(attacker, t)) return;
    if (attacker && attacker !== t) dmg *= attacker.dmgMul;
    const absorbed = Math.min(t.armor, dmg * 0.6);
    t.armor -= absorbed;
    t.hp -= dmg - absorbed;
    t.lastHurtAt = this.time;
    if (attacker && attacker !== t) t.lastAttacker = attacker.id;
    this.emit({ e: 'hit', t: t.id, by: attacker?.id ?? '', d: Math.round(dmg), x: Math.round(x), y: Math.round(y), b: bid });
    if (t.brain && attacker && attacker !== t) t.brain.onHurt(attacker);
    if (t.hp <= 0) this.kill(t, attacker, w);
  }

  private kill(v: Player, k: Player | null, w: WeaponId | 'boom') {
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.streak = 0;
    v.respawnT = RESPAWN_TIME;
    v.removeT = 1.5;
    v.killedBy = k && k !== v ? k.id : null;
    if (k && k !== v) {
      k.kills++;
      k.streak++;
      k.score += v.boss ? 500 : 100;
      if (k.perk === 'vamp' && k.alive) k.hp = Math.min(k.maxHp, k.hp + 25);
      if (k.team === 0 || k.team === 1) this.teamKills[k.team]++;
      if (k.streak === 3 || k.streak === 5 || k.streak === 8) {
        this.emit({ e: 'msg', text: `${k.name}: ${k.streak} Eliminierungen in Folge` });
      }
      if (this.settings.mode === 'gungame' && w === GUN_TIERS[Math.min(k.tier, GUN_TIERS.length - 1)]) {
        k.tier++;
        k.score = k.tier * 100;
        if (k.tier >= GUN_TIERS.length) {
          this.emit({ e: 'kill', k: k.id, v: v.id, w });
          this.finish();
          return;
        }
        if (k.tier === GUN_TIERS.length - 1) this.emit({ e: 'msg', text: `${k.name} hat die letzte Waffe!` });
        this.arm(k);
      }
    } else {
      v.score = Math.max(0, v.score - 50);
    }
    this.emit({ e: 'kill', k: k && k !== v ? k.id : null, v: v.id, w });
    this.checkEnd();
  }

  explode(x: number, y: number, radius: number, dmg: number, ownerId: string, w: WeaponId | 'boom') {
    const owner = this.players.get(ownerId) ?? null;
    const r = radius * (owner?.perk === 'blast' ? 1.25 : 1);
    this.emit({ e: 'boom', x: Math.round(x), y: Math.round(y), r: Math.round(r) });
    for (const o of this.list) {
      if (!o.alive) continue;
      const d = dist(x, y, o.x, o.y);
      if (d > r + o.r) continue;
      const blocked = this.map.raycast(x, y, o.x, o.y, (s) => s.kind === 'wall' || s.kind === 'steel' || s.kind === 'rock').solid;
      if (blocked) continue;
      let dd = dmg * (1 - Math.max(0, d - o.r) / r * 0.65);
      if (o === owner) {
        if (o.perk === 'blast') continue;
        dd *= 0.5;
      }
      this.damagePlayer(o, dd, owner, w, o.x, o.y);
    }
    for (const s of [...this.map.query(x - r, y - r, x + r, y + r)]) {
      if (s.kind !== 'crate' && s.kind !== 'barrel') continue;
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const d = dist(x, y, cx, cy);
      if (d < r + s.w / 2) this.damageSolid(s, dmg * 1.6 * (1 - Math.min(1, d / (r + s.w / 2)) * 0.5), ownerId);
    }
  }

  damageSolid(s: Solid, dmg: number, ownerId: string) {
    if (!this.authority || !isFinite(s.hp) || s.hp <= 0) return;
    s.hp = Math.max(0, s.hp - dmg);
    this.emit({ e: 'crate', id: s.id, hp: Math.round(s.hp) });
    if (s.hp <= 0) {
      this.map.removeSolid(s);
      if (s.kind === 'barrel') this.explode(s.x + s.w / 2, s.y + s.h / 2, 140, 75, ownerId, 'boom');
    }
  }

  // ------------------------------------------------------------ pickups

  private updatePickups(dt: number) {
    for (const pk of this.pickups) {
      if (pk.kind === 'weapon' && this.settings.mode === 'gungame') continue;
      if (!pk.on) {
        pk.t -= dt;
        if (pk.t <= 0) {
          pk.on = true;
          if (pk.kind === 'weapon') pk.w = pick(PICKUP_WEAPONS);
          this.emit({ e: 'pk', i: pk.i, on: 1, w: pk.w });
        }
        continue;
      }
      for (const p of this.list) {
        if (!p.alive || dist2(p.x, p.y, pk.x, pk.y) > (p.r + 18) ** 2) continue;
        if (pk.kind === 'health' && p.hp >= p.maxHp) continue;
        if (pk.kind === 'armor' && p.armor >= 100) continue;
        if (pk.kind === 'weapon' && p.boss) continue;
        pk.on = false;
        pk.t = PICKUP_RESPAWN[pk.kind];
        this.emit({ e: 'pk', i: pk.i, on: 0 });
        if (pk.kind === 'health') p.hp = Math.min(p.maxHp, p.hp + 50);
        else if (pk.kind === 'armor') { p.armor = Math.min(100, p.armor + 50); p.grenades = Math.min(p.grenades + 1, 6); }
        else if (pk.w) {
          const remote = !p.bot && p.id !== this.localId;
          if (remote) this.emit({ e: 'give', p: p.id, w: pk.w });
          else this.giveWeapon(p, pk.w);
        }
        this.emit({ e: 'heal', p: p.id, kind: pk.kind });
        break;
      }
    }
  }

  // ------------------------------------------------------------ bots helper

  private separate() {
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < l.length; j++) {
        const b = l[j];
        if (!b.alive || (!a.bot && !b.bot)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        if (a.bot && b.bot) {
          a.x -= dx * push * 0.5; a.y -= dy * push * 0.5;
          b.x += dx * push * 0.5; b.y += dy * push * 0.5;
        } else if (a.bot) {
          a.x -= dx * push; a.y -= dy * push;
        } else {
          b.x += dx * push; b.y += dy * push;
        }
        if (a.bot) this.map.resolveCircle(a, a.r);
        if (b.bot) this.map.resolveCircle(b, b.r);
      }
    }
  }

  /** Can `viewer` see `p` (bush concealment)? */
  visibleTo(viewer: { x: number; y: number; team: number; id: string } | undefined, p: Player): boolean {
    if (!viewer || viewer.id === p.id || sameTeam(viewer, p)) return true;
    if (this.time - p.lastShotAt < 1.0 || this.time - p.lastHurtAt < 0.6) return true;
    if (!this.map.bushAt(p.x, p.y)) return true;
    return dist2(viewer.x, viewer.y, p.x, p.y) < 120 * 120;
  }

  // ------------------------------------------------------------ modes

  private updateMode(dt: number) {
    const mode = this.settings.mode;
    if (mode !== 'survival') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish();
      }
      return;
    }
    this.timeLeft += dt; // survival: elapsed time
    const humans = this.list.filter((p) => !p.bot || p.team === 0);
    const enemies = this.list.filter((p) => p.team === 1);
    this.enemiesLeft = enemies.filter((p) => p.alive).length + this.waveToSpawn;
    if (this.waveT > 0) {
      this.waveT -= dt;
      if (this.waveT <= 0) this.startWave();
      return;
    }
    if (this.waveToSpawn > 0) {
      this.waveSpawnT -= dt;
      const aliveEnemies = enemies.filter((p) => p.alive).length;
      if (this.waveSpawnT <= 0 && aliveEnemies < Math.min(10, MAX_TOTAL - humans.length) ) {
        this.waveSpawnT = Math.max(0.35, 1.2 - this.wave * 0.05);
        this.spawnWaveBot();
      }
    } else if (enemies.every((p) => !p.alive)) {
      // wave cleared
      this.emit({ e: 'msg', text: `Welle ${this.wave} geschafft!` });
      for (const h of humans) {
        if (!h.alive) this.spawnPlayer(h);
        else h.hp = Math.min(h.maxHp, h.hp + 40);
      }
      this.waveT = 6;
    }
  }

  private startWave() {
    this.wave++;
    const humans = this.list.filter((p) => !p.bot).length;
    const boss = this.wave % 5 === 0;
    this.waveToSpawn = Math.round(2 + this.wave * 1.6 + (humans - 1) * (1 + this.wave * 0.5)) - (boss ? 3 : 0);
    this.waveSpawnT = 0.5;
    if (boss) {
      this.addBot(1, { boss: true, hpMul: 5 + this.wave * 0.4, weapon: this.wave >= 10 ? 'rocket' : 'minigun' });
    }
    this.emit({ e: 'wave', n: this.wave, boss });
  }

  private spawnWaveBot() {
    const w = this.wave;
    const pool: WeaponId[] = w <= 2 ? ['pistol', 'smg', 'revolver'] : w <= 4 ? ['smg', 'shotgun', 'pistol', 'rifle', 'crossbow', 'smgsil']
      : w <= 7 ? ['smg', 'shotgun', 'rifle', 'sniper', 'flamer', 'dmr', 'lmg', 'autoshotgun']
      : ['rifle', 'shotgun', 'sniper', 'minigun', 'flamer', 'rocket', 'rail', 'lmg', 'autoshotgun', 'gl'];
    this.waveToSpawn--;
    this.addBot(1, { hpMul: 1 + 0.07 * (w - 1), weapon: pick(pool) });
  }

  private checkEnd() {
    if (this.over) return;
    const s = this.settings;
    if (s.mode === 'dm' && this.list.some((p) => p.kills >= s.killLimit)) this.finish();
    else if (s.mode === 'team' && Math.max(...this.teamKills) >= s.killLimit) this.finish();
    else if (s.mode === 'survival') {
      const humans = this.list.filter((p) => !p.bot);
      if (humans.length && humans.every((p) => !p.alive)) this.finish();
    }
  }

  finish() {
    if (this.over) return;
    this.over = true;
    const s = this.settings;
    const rows: ResultRow[] = this.list
      .filter((p) => !(s.mode === 'survival' && p.bot && p.team === 1))
      .map((p) => ({ id: p.id, name: p.name, bot: p.bot, team: p.team, kills: p.kills, deaths: p.deaths, score: p.score, place: 0 }));
    if (s.mode === 'gungame') rows.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    else rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score);
    rows.forEach((r, i) => (r.place = i + 1));
    let winnerTeam: number | null = null;
    let winnerId: string | null = null;
    if (isFfa(s.mode)) winnerId = rows[0]?.id ?? null;
    else if (s.mode === 'team') winnerTeam = this.teamKills[0] === this.teamKills[1] ? null : this.teamKills[0] > this.teamKills[1] ? 0 : 1;
    const cleared = s.mode === 'survival' ? Math.max(0, this.wave - 1) : 0;
    this.result = { mode: s.mode, winnerTeam, winnerId, rows, wave: cleared, duration: Math.round(this.time) };
    this.emit({ e: 'end', res: this.result });
  }

  // ------------------------------------------------------------ setup helpers

  populateBots() {
    const s = this.settings;
    if (isFfa(s.mode)) for (let i = 0; i < s.bots; i++) this.addBot(-1);
    else if (s.mode === 'team') {
      for (let i = 0; i < s.allies; i++) this.addBot(0);
      for (let i = 0; i < s.bots; i++) this.addBot(1);
    }
  }

  // ------------------------------------------------------------ networking (host side)

  snapshot(): Snapshot {
    const ps: SnapPlayer[] = this.list.map((p) => [
      p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.aim * 100) / 100, Math.ceil(p.hp), Math.round(p.armor),
      p.alive ? 1 : 0, WEAPON_LIST.indexOf(p.wid), p.reloading ? 1 : 0, p.protectT > 0 ? 1 : 0, p.kills, p.deaths, p.spawnSeq,
      Math.round(Math.max(0, p.respawnT) * 10) / 10, p.maxHp, p.score,
    ]);
    return {
      tm: Math.round(this.time * 1000) / 1000, ps,
      st: [Math.round(this.timeLeft * 10) / 10, this.teamKills[0], this.teamKills[1], this.wave, Math.round(this.waveT * 10) / 10, this.enemiesLeft],
    };
  }

  fullState(): FullState {
    return {
      players: this.list.map((p) => this.infoOf(p)),
      crates: this.map.solids.filter((s) => isFinite(s.maxHp) && s.hp < s.maxHp).map((s) => [s.id, Math.round(s.hp)]),
      pickups: this.pickups.map((p) => [p.i, p.on ? 1 : 0, p.w]),
      time: this.time,
    };
  }

  /** Host: apply a client's input message. */
  applyRemoteInput(pid: string, m: ClientInput) {
    const p = this.players.get(pid);
    if (!p) return;
    if (p.alive && m.sq === p.spawnSeq && isFinite(m.x) && isFinite(m.y)) {
      const nx = Math.max(p.r, Math.min(this.map.w - p.r, m.x));
      const ny = Math.max(p.r, Math.min(this.map.h - p.r, m.y));
      p.vx = (nx - p.x) * 30;
      p.vy = (ny - p.y) * 30;
      p.x = nx;
      p.y = ny;
      p.aim = m.a;
      if (WEAPON_LIST[m.w]) p.wid = WEAPON_LIST[m.w];
      p.reloading = !!m.rl;
    }
    if (Array.isArray(m.sh)) for (const s of m.sh.slice(0, 8)) this.applyRemoteShot(pid, s);
  }

  // ------------------------------------------------------------ networking (client side)

  private snapClock: number | null = null;

  applySnapshot(s: Snapshot, now: number) {
    const sample = s.tm - now;
    if (this.snapClock === null || sample > this.snapClock) this.snapClock = sample;
    else this.snapClock += (sample - this.snapClock) * 0.02;
    for (const row of s.ps) {
      const [id, x, y, a, hp, armor, alive, wi, rl, prot, kills, deaths, sq, respawnT, maxHp, score] = row;
      const p = this.players.get(id);
      if (!p) continue;
      p.hp = hp;
      p.armor = armor;
      p.maxHp = maxHp;
      p.kills = kills;
      p.deaths = deaths;
      p.score = score;
      p.respawnT = respawnT;
      p.protectT = prot ? Math.max(p.protectT, 0.1) : 0;
      if (p.id === this.localId) {
        if (!alive) p.alive = false;
        continue;
      }
      p.alive = !!alive;
      p.wid = WEAPON_LIST[wi] ?? p.wid;
      p.reloading = !!rl;
      p.spawnSeq = sq;
      const last = p.buf[p.buf.length - 1];
      if (last && dist2(last.x, last.y, x, y) > 250 * 250) p.buf.length = 0;
      p.buf.push({ t: s.tm, x, y, a });
      if (p.buf.length > 30) p.buf.splice(0, p.buf.length - 30);
    }
    const [tl, t0, t1, wave, waveT, left] = s.st;
    this.timeLeft = tl;
    this.teamKills = [t0, t1];
    this.wave = wave;
    this.waveT = waveT;
    this.enemiesLeft = left;
  }

  private interpolate() {
    if (this.snapClock === null) return;
    const rt = performance.now() / 1000 + this.snapClock - 0.1;
    for (const p of this.list) {
      if (p.id === this.localId || !p.buf.length) continue;
      const buf = p.buf;
      let i = buf.length - 1;
      while (i > 0 && buf[i - 1].t > rt) i--;
      const b1 = buf[i];
      const b0 = buf[i - 1];
      if (!b0 || rt >= b1.t) {
        p.x = b1.x; p.y = b1.y; p.aim = b1.a;
      } else {
        const t = Math.max(0, Math.min(1, (rt - b0.t) / (b1.t - b0.t || 1)));
        const nx = lerp(b0.x, b1.x, t), ny = lerp(b0.y, b1.y, t);
        p.vx = (b1.x - b0.x) / (b1.t - b0.t || 1);
        p.vy = (b1.y - b0.y) / (b1.t - b0.t || 1);
        p.x = nx; p.y = ny;
        p.aim = lerpAngle(b0.a, b1.a, t);
      }
    }
  }

  /** Client: apply an event from the host. Returns false if it should not produce effects. */
  applyNetEvent(ev: GameEvent): boolean {
    const local = this.localId;
    switch (ev.e) {
      case 'shot': {
        if (ev.p === local) return false;
        const p = this.players.get(ev.p);
        if (p && !WEAPONS[ev.w].silent) p.lastShotAt = this.time;
        this.spawnBullets({ id: ev.p, team: p?.team ?? -1 }, ev.w, ev.x, ev.y, ev.a, ev.b, true, ev.pw ?? 1);
        return true;
      }
      case 'beam': {
        if (ev.p === local) return false;
        const p = this.players.get(ev.p);
        if (p) p.lastShotAt = this.time;
        return true;
      }
      case 'hit': {
        if (ev.b) this.removeBullet(ev.b);
        const t = this.players.get(ev.t);
        if (t) t.lastHurtAt = this.time;
        return true;
      }
      case 'bend':
        this.removeBullet(ev.b);
        return false;
      case 'kill': {
        const v = this.players.get(ev.v);
        if (v) { v.alive = false; v.killedBy = ev.k; }
        return true;
      }
      case 'crate': {
        const s = this.map.solids[ev.id];
        if (!s || s.hp <= 0) return false;
        s.hp = ev.hp;
        if (ev.hp <= 0) this.map.removeSolid(s);
        return true;
      }
      case 'pk': {
        const pk = this.pickups[ev.i];
        if (pk) { pk.on = !!ev.on; if (ev.w !== undefined) pk.w = ev.w; }
        return true;
      }
      case 'give': {
        const p = this.players.get(ev.p);
        if (p && ev.p === local) this.giveWeapon(p, ev.w);
        return true;
      }
      case 'spawn': {
        const p = this.players.get(ev.p);
        if (!p) return false;
        p.x = ev.x; p.y = ev.y; p.vx = p.vy = 0;
        p.alive = true;
        p.spawnSeq = ev.sq;
        p.protectT = SPAWN_PROTECT;
        p.buf.length = 0;
        p.killedBy = null;
        if (ev.p === local) {
          p.slots = this.armSlots(p);
          p.cur = 0;
          p.wid = p.slots[0].id;
          p.hp = p.maxHp;
          p.armor = 0;
          p.grenades = grenadeCount(p.perk);
        }
        return true;
      }
      case 'arm': {
        const p = this.players.get(ev.p);
        if (!p) return false;
        p.tier = ev.tier;
        if (ev.p === local) {
          p.slots = this.armSlots(p);
          p.cur = 0;
          p.wid = p.slots[0].id;
        }
        return ev.p === local;
      }
      case 'join':
        if (this.players.has(ev.pl.id)) return false;
        this.addPlayer(ev.pl, false);
        return true;
      case 'leave':
        this.removePlayer(ev.p);
        return true;
      case 'end':
        this.over = true;
        this.result = ev.res;
        return true;
      default:
        return true;
    }
  }

  applyFullState(fs: FullState) {
    for (const info of fs.players) if (!this.players.has(info.id)) this.addPlayer(info, false);
    for (const [id, hp] of fs.crates) {
      const s = this.map.solids[id];
      if (!s) continue;
      s.hp = hp;
      if (hp <= 0) this.map.removeSolid(s);
    }
    for (const [i, on, w] of fs.pickups) {
      const pk = this.pickups[i];
      if (pk) { pk.on = !!on; pk.w = w; }
    }
    this.time = fs.time;
  }

  /** Client: build the input message for the host. */
  clientInput(): ClientInput | null {
    const p = this.local;
    if (!p) return null;
    const sh = this.outShots;
    this.outShots = [];
    return {
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, a: Math.round(p.aim * 100) / 100,
      w: WEAPON_LIST.indexOf(p.wid), rl: p.reloading ? 1 : 0, sq: p.spawnSeq, sh,
    };
  }

  ammoInfo(p: Player): { slot: WeaponSlot; mag: number } {
    const slot = p.slots[p.cur] ?? p.slots[0];
    return { slot, mag: magSize(slot.id, p.perk) };
  }
}

// [id, x, y, aim, hp, armor, alive, weaponIdx, reloading, protected, kills, deaths, spawnSeq, respawnT, maxHp, score]
export type SnapPlayer = [string, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
export interface Snapshot { tm: number; ps: SnapPlayer[]; st: [number, number, number, number, number, number] }
export interface FullState { players: PlayerInfo[]; crates: [number, number][]; pickups: [number, number, WeaponId | null][]; time: number }
export interface ClientInput { x: number; y: number; a: number; w: number; rl: number; sq: number; sh: ShotMsg[] }

export function perkName(id: PerkId) {
  return PERKS.find((p) => p.id === id)?.name ?? '';
}

export { angleDiff };
