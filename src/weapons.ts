import { PerkId, WEAPONS, WeaponId } from './config';

export interface WeaponSlot {
  id: WeaponId;
  ammo: number;
  reserve: number; // Infinity for loadout weapons
  reloadT: number; // remaining reload time (0 = not reloading)
  reloadTotal: number;
  cool: number; // time until the next shot is allowed
  spin: number; // minigun spin-up 0..1
  pickup: boolean;
}

export const magSize = (id: WeaponId, perk: PerkId) => Math.round(WEAPONS[id].mag * (perk === 'mag' ? 1.4 : 1));

export function makeSlot(id: WeaponId, perk: PerkId, pickup = false): WeaponSlot {
  const mag = magSize(id, perk);
  return {
    id, ammo: mag, reserve: pickup ? Math.max(0, WEAPONS[id].pickupAmmo - mag) : Infinity,
    reloadT: 0, reloadTotal: 0, cool: 0, spin: 0, pickup,
  };
}

export function loadout(primary: WeaponId, perk: PerkId): WeaponSlot[] {
  return primary === 'pistol' ? [makeSlot('pistol', perk)] : [makeSlot(primary, perk), makeSlot('pistol', perk)];
}

export function startReload(slot: WeaponSlot, perk: PerkId): boolean {
  if (slot.reloadT > 0 || slot.reserve <= 0 || slot.ammo >= magSize(slot.id, perk)) return false;
  slot.reloadTotal = WEAPONS[slot.id].reload * (perk === 'reload' ? 0.65 : 1);
  slot.reloadT = slot.reloadTotal;
  return true;
}

export interface WeaponTick { shots: number; empty: boolean; reloaded: boolean; reloadStarted: boolean }

/** Advances weapon state; returns how many shots were fired this tick. */
export function tickWeapon(slot: WeaponSlot, perk: PerkId, dt: number, fire: boolean, reload: boolean): WeaponTick {
  const def = WEAPONS[slot.id];
  const res: WeaponTick = { shots: 0, empty: false, reloaded: false, reloadStarted: false };
  if (slot.reloadT > 0) {
    slot.reloadT -= dt;
    if (slot.reloadT <= 0) {
      slot.reloadT = 0;
      const take = Math.min(magSize(slot.id, perk) - slot.ammo, slot.reserve);
      slot.ammo += take;
      slot.reserve -= take;
      res.reloaded = true;
    }
  }
  slot.cool -= dt;
  if (def.spinUp > 0) {
    slot.spin = fire && slot.reloadT <= 0 ? Math.min(1, slot.spin + dt / def.spinUp) : Math.max(0, slot.spin - (dt / def.spinUp) * 1.5);
  }
  if (reload && startReload(slot, perk)) res.reloadStarted = true;
  if (fire && slot.reloadT <= 0) {
    if (slot.ammo <= 0) {
      if (startReload(slot, perk)) res.reloadStarted = true;
      else if (slot.cool <= 0) { res.empty = true; slot.cool = 0.3; }
    } else if (def.spinUp === 0 || slot.spin >= 1) {
      while (slot.cool <= 0 && slot.ammo > 0) {
        res.shots++;
        slot.ammo--;
        slot.cool += 1 / def.rate;
      }
      if (slot.ammo <= 0 && startReload(slot, perk)) res.reloadStarted = true;
    }
  }
  if (slot.cool < 0) slot.cool = 0;
  return res;
}
