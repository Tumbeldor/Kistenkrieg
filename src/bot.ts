import { DiffDef, WEAPONS } from './config';
import type { Game, Player, PlayerInput } from './game';
import { Vec, angleDiff, dist, dist2 } from './geom';
import { rand } from './rng';
import { magSize } from './weapons';

const sameTeam = (a: { team: number }, b: { team: number }) => a.team >= 0 && a.team === b.team;

export class Bot {
  private target: Player | null = null;
  private targetVisible = false;
  private seenT = 0;
  private lastKnown: Vec | null = null;
  private lastKnownT = -99;
  private path: Vec[] = [];
  private pathGoal: Vec | null = null;
  private repathT = 0;
  private thinkT = 0;
  private goal: Vec | null = null;
  private goalT = 0;
  private strafe = 1;
  private strafeT = 0;
  private aim = 0;
  private wobble = Math.random() * 100;
  private stuckT = 0;
  private stuckN = 0;
  private lastX = 0;
  private lastY = 0;
  private nudge: Vec | null = null;
  private nudgeT = 0;
  private burstT = 0;
  private pauseT = 0;
  private input: PlayerInput = { mx: 0, my: 0, aim: 0, fire: false, reload: false, next: false, slot: -1, throw: false, throwDist: 0 };

  constructor(readonly diff: DiffDef) {}

  reset() {
    this.target = null;
    this.targetVisible = false;
    this.seenT = 0;
    this.lastKnown = null;
    this.path = [];
    this.pathGoal = null;
    this.goal = null;
    this.stuckN = 0;
  }

  /** A gunshot was heard: investigate roughly where it came from. */
  onNoise(x: number, y: number) {
    if (this.targetVisible) return;
    this.lastKnown = { x: x + rand(-140, 140), y: y + rand(-140, 140) };
    this.lastKnownT = performance.now() / 1000;
  }

  onHurt(attacker: Player) {
    if (!this.targetVisible) {
      this.lastKnown = { x: attacker.x + rand(-80, 80), y: attacker.y + rand(-80, 80) };
      this.lastKnownT = performance.now() / 1000;
    }
  }

  think(g: Game, me: Player, dt: number): PlayerInput {
    const inp = this.input;
    const d = this.diff;
    inp.fire = false;
    inp.reload = false;
    inp.next = false;
    inp.slot = -1;
    inp.throw = false;
    const now = performance.now() / 1000;

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.12 + Math.random() * 0.1;
      this.pickTarget(g, me, now);
    }

    const slot = me.slots[me.cur];
    const def = WEAPONS[slot.id];
    let mx = 0, my = 0;
    const t = this.target;

    if (t && t.alive && this.targetVisible) {
      this.seenT += dt;
      const dd = dist(me.x, me.y, t.x, t.y);
      const travel = def.kind === 'beam' ? 0 : dd / def.speed;
      const px = t.x + t.vx * travel * d.lead;
      const py = t.y + t.vy * travel * d.lead;
      const exact = Math.atan2(py - me.y, px - me.x);
      const tm = g.time;
      const err = d.aimErr * (Math.sin(tm * 2.3 + this.wobble) * 0.7 + Math.sin(tm * 5.7 + this.wobble * 2) * 0.3);
      this.turnTo(exact + err, dt);

      // movement: keep preferred range and strafe
      const pref = def.botRange;
      const ux = (t.x - me.x) / (dd || 1), uy = (t.y - me.y) / (dd || 1);
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafe = Math.random() < 0.5 ? -this.strafe : this.strafe;
        this.strafeT = rand(0.5, 1.6) / Math.max(0.4, d.strafe);
      }
      let fwd = 0;
      if (dd > pref + 90) fwd = 1;
      else if (dd < pref - 90) fwd = -0.8;
      if (fwd > 0 && !g.map.clearPath(me.x, me.y, t.x, t.y, me.r)) {
        const dir = this.follow(g, me, t, dt);
        mx = dir.x; my = dir.y;
      } else {
        mx = ux * fwd - uy * this.strafe * d.strafe;
        my = uy * fwd + ux * this.strafe * d.strafe;
      }
      // fire control
      const off = Math.abs(angleDiff(this.aim, exact));
      const tol = 0.1 + def.spread * 0.5 + (dd < 160 ? 0.25 : 0);
      const tooClose = (def.kind === 'rocket' || def.kind === 'grenade') && dd < 160;
      if (this.seenT >= d.reaction && off < tol && dd < def.range * 0.95 && !tooClose && t.protectT <= 0) {
        if (d.id === 'easy') {
          if (this.pauseT > 0) this.pauseT -= dt;
          else {
            inp.fire = true;
            this.burstT += dt;
            if (this.burstT > 0.6) { this.burstT = 0; this.pauseT = rand(0.4, 0.9); }
          }
        } else inp.fire = true;
      }
      // grenades at medium range (smarter bots more often)
      if (me.grenades > 0 && dd > 220 && dd < 520 && this.seenT > d.reaction && Math.random() < dt * (d.smart ? 0.15 : 0.04)) {
        inp.throw = true;
        inp.throwDist = dd + rand(-40, 40) * (1 - d.lead * 0.5);
      }
      // weak bots run away to a medkit on smart difficulties
      if (d.smart && me.hp < me.maxHp * 0.3) {
        const hk = this.nearestPickup(g, me, 'health');
        if (hk && dist(me.x, me.y, hk.x, hk.y) < 700) {
          const dir = this.follow(g, me, hk, dt);
          mx = dir.x; my = dir.y;
        }
      }
    } else {
      this.seenT = Math.max(0, this.seenT - dt * 2);
      let dest: Vec | null = null;
      if (this.lastKnown && now - this.lastKnownT < 4) {
        dest = this.lastKnown;
        if (dist2(me.x, me.y, dest.x, dest.y) < 50 * 50) this.lastKnown = null;
      } else {
        this.goalT -= dt;
        if (!this.goal || this.goalT <= 0 || dist2(me.x, me.y, this.goal.x, this.goal.y) < 60 * 60) this.chooseGoal(g, me);
        dest = this.goal;
      }
      if (dest) {
        const dir = this.follow(g, me, dest, dt);
        mx = dir.x; my = dir.y;
        const look = this.lastKnown ? Math.atan2(this.lastKnown.y - me.y, this.lastKnown.x - me.x) : Math.atan2(my, mx);
        if (mx || my || this.lastKnown) this.turnTo(look, dt * 0.6);
      }
      if (slot.ammo < magSize(slot.id, me.perk) * 0.5) inp.reload = true;
    }

    // unstick
    this.stuckT += dt;
    if (this.stuckT > 0.5) {
      const moved = dist(me.x, me.y, this.lastX, this.lastY);
      if (Math.hypot(mx, my) > 0.3 && moved < 10) this.stuckN++;
      else this.stuckN = 0;
      if (this.stuckN >= 2) {
        this.stuckN = 0;
        this.path = [];
        this.goal = null;
        this.strafe = -this.strafe;
        const a = Math.random() * Math.PI * 2;
        this.nudge = { x: Math.cos(a), y: Math.sin(a) };
        this.nudgeT = 0.4;
      }
      this.lastX = me.x;
      this.lastY = me.y;
      this.stuckT = 0;
    }
    if (this.nudge && this.nudgeT > 0) {
      this.nudgeT -= dt;
      mx = this.nudge.x;
      my = this.nudge.y;
    }

    inp.mx = mx;
    inp.my = my;
    inp.aim = this.aim;
    return inp;
  }

  private turnTo(a: number, dt: number) {
    const diff = angleDiff(this.aim, a);
    const max = this.diff.turn * dt;
    this.aim += Math.max(-max, Math.min(max, diff));
  }

  private pickTarget(g: Game, me: Player, now: number) {
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const e of g.list) {
      if (e === me || !e.alive || sameTeam(e, me)) continue;
      // only spot what a player would see on screen: a wide, flat box around the bot
      const keep = e === this.target && this.targetVisible ? 1.15 : 1;
      const ax = Math.abs(e.x - me.x), ay = Math.abs(e.y - me.y);
      if (ax > this.diff.sight * keep || ay > this.diff.sight * 0.5 * keep) continue;
      const dd = Math.hypot(ax, ay);
      if (!g.visibleTo(me, e)) continue;
      if (!g.map.los(me.x, me.y, e.x, e.y)) continue;
      let score = dd;
      if (e === this.target) score -= 180;
      if (e.protectT > 0) score += 300;
      if (!e.bot) score -= 40;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best !== this.target) {
      if (this.target && this.target.alive && this.targetVisible && !best) {
        this.lastKnown = { x: this.target.x, y: this.target.y };
        this.lastKnownT = now;
      }
      if (best) this.seenT = this.target ? this.seenT * 0.5 : 0;
      this.target = best;
    }
    this.targetVisible = !!best;
  }

  private nearestPickup(g: Game, me: Player, kind: 'health' | 'weapon' | 'armor'): Vec | null {
    let best: Vec | null = null;
    let bd = Infinity;
    for (const p of g.pickups) {
      if (!p.on || p.kind !== kind) continue;
      const d2 = dist2(me.x, me.y, p.x, p.y);
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  private chooseGoal(g: Game, me: Player) {
    const d = this.diff;
    this.goalT = rand(4, 8);
    if (me.hp < me.maxHp * 0.45 && (d.smart || me.hp < me.maxHp * 0.25)) {
      const hk = this.nearestPickup(g, me, 'health');
      if (hk) { this.goal = { x: hk.x, y: hk.y }; return; }
    }
    if (!me.slots.some((s) => s.pickup) && !me.boss && (d.smart || Math.random() < 0.3)) {
      const wk = this.nearestPickup(g, me, 'weapon');
      if (wk && dist(me.x, me.y, wk.x, wk.y) < 900) { this.goal = { x: wk.x, y: wk.y }; return; }
    }
    if (d.smart && me.armor < 50 && Math.random() < 0.4) {
      const ak = this.nearestPickup(g, me, 'armor');
      if (ak && dist(me.x, me.y, ak.x, ak.y) < 800) { this.goal = { x: ak.x, y: ak.y }; return; }
    }
    // no wallhack: head only roughly towards the nearest enemy
    const survival = g.settings.mode === 'survival';
    const huntChance = survival ? 1 : d.hunt * 0.5;
    const off = survival ? 250 : 500;
    if (Math.random() < huntChance) {
      let best: Player | null = null;
      let bd = Infinity;
      for (const e of g.list) {
        if (e === me || !e.alive || sameTeam(e, me)) continue;
        const dd = dist2(me.x, me.y, e.x, e.y);
        if (dd < bd) { bd = dd; best = e; }
      }
      if (best) {
        this.goal = {
          x: Math.max(60, Math.min(g.map.w - 60, best.x + rand(-off, off))),
          y: Math.max(60, Math.min(g.map.h - 60, best.y + rand(-off, off))),
        };
        this.goalT = rand(1.5, 3);
        return;
      }
    }
    const sp = g.map.spawns[Math.floor(Math.random() * g.map.spawns.length)];
    this.goal = sp ? { x: sp.x, y: sp.y } : { x: g.map.w / 2, y: g.map.h / 2 };
  }

  /** Direction (unit-ish vector) toward dest using A* when the straight line is blocked. */
  private follow(g: Game, me: Player, dest: Vec, dt: number): Vec {
    const map = g.map;
    this.repathT -= dt;
    const goalMoved = !this.pathGoal || dist2(this.pathGoal.x, this.pathGoal.y, dest.x, dest.y) > 120 * 120;
    if (this.repathT <= 0 || goalMoved || !this.path.length) {
      if (map.clearPath(me.x, me.y, dest.x, dest.y, me.r)) {
        this.path = [{ x: dest.x, y: dest.y }];
      } else {
        this.path = map.nav.findPath(me.x, me.y, dest.x, dest.y) ?? [];
      }
      this.pathGoal = { x: dest.x, y: dest.y };
      this.repathT = rand(0.6, 1.1);
    }
    while (this.path.length > 1 && dist2(me.x, me.y, this.path[0].x, this.path[0].y) < 26 * 26) this.path.shift();
    if (this.path.length > 1 && this.thinkT > 0.2 && map.clearPath(me.x, me.y, this.path[1].x, this.path[1].y, me.r - 2)) this.path.shift();
    const wp = this.path[0];
    if (!wp) return { x: 0, y: 0 };
    const dx = wp.x - me.x, dy = wp.y - me.y;
    const l = Math.hypot(dx, dy);
    if (l < 8) return { x: 0, y: 0 };
    return { x: dx / l, y: dy / l };
  }
}
