// Local profile: progression, loadout, stats and settings (stored in localStorage).
import {
  DIFFS, HATS, MatchSettings, PERKS, PerkId, SKINS, WEAPONS, WEAPON_LIST, WeaponId, XP, levelInfo,
} from './config';
import type { MatchResult } from './game';

export interface Profile {
  v: 1;
  name: string;
  xp: number;
  skin: string;
  hat: string;
  primary: WeaponId;
  perk: PerkId;
  stats: { kills: number; deaths: number; matches: number; wins: number; bestWave: number; playTime: number };
  settings: { volume: number; showFps: boolean; aimAssist: boolean };
  solo?: MatchSettings;
  host?: MatchSettings;
}

const KEY = 'kistenkrieg.profile.v1';

function fresh(): Profile {
  const n = Math.floor(Math.random() * 900 + 100);
  return {
    v: 1, name: `Spieler${n}`, xp: 0, skin: 'blue', hat: 'none', primary: 'smg', perk: 'none',
    stats: { kills: 0, deaths: 0, matches: 0, wins: 0, bestWave: 0, playTime: 0 },
    settings: { volume: 0.7, showFps: false, aimAssist: true },
  };
}

export function sanitize(raw: unknown): Profile {
  const base = fresh();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Profile>;
  const p: Profile = {
    ...base,
    name: typeof r.name === 'string' && r.name.trim() ? cleanName(r.name) : base.name,
    xp: typeof r.xp === 'number' && isFinite(r.xp) && r.xp >= 0 ? Math.floor(r.xp) : 0,
    skin: SKINS.some((s) => s.id === r.skin) ? r.skin! : base.skin,
    hat: HATS.some((h) => h.id === r.hat) ? r.hat! : base.hat,
    primary: WEAPON_LIST.includes(r.primary as WeaponId) ? (r.primary as WeaponId) : base.primary,
    perk: PERKS.some((x) => x.id === r.perk) ? (r.perk as PerkId) : base.perk,
    stats: { ...base.stats, ...(typeof r.stats === 'object' ? r.stats : {}) },
    settings: { ...base.settings, ...(typeof r.settings === 'object' ? r.settings : {}) },
    solo: r.solo,
    host: r.host,
  };
  // never equip something that is not unlocked
  const lvl = levelInfo(p.xp).level;
  if (WEAPONS[p.primary].unlock > lvl) p.primary = 'smg';
  if ((PERKS.find((x) => x.id === p.perk)?.unlock ?? 1) > lvl) p.perk = 'none';
  if ((SKINS.find((x) => x.id === p.skin)?.unlock ?? 1) > lvl) p.skin = 'blue';
  if ((HATS.find((x) => x.id === p.hat)?.unlock ?? 1) > lvl) p.hat = 'none';
  return p;
}

export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Spieler';
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return fresh();
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export function exportCode(p: Profile): string {
  const json = JSON.stringify({ ...p, solo: undefined, host: undefined });
  return 'KK1-' + btoa(unescape(encodeURIComponent(json)));
}

export function importCode(code: string): Profile | null {
  try {
    const c = code.trim().replace(/^KK1-/, '');
    return sanitize(JSON.parse(decodeURIComponent(escape(atob(c)))));
  } catch {
    return null;
  }
}

export const level = (p: Profile) => levelInfo(p.xp).level;

export interface XpLine { label: string; xp: number }
export interface XpReport { lines: XpLine[]; total: number; won: boolean; place: number }

export function computeXp(res: MatchResult, myId: string, settings: MatchSettings, humans: number): XpReport {
  const lines: XpLine[] = [];
  const row = res.rows.find((r) => r.id === myId);
  const kills = row?.kills ?? 0;
  let won = false;
  const place = row?.place ?? 0;
  if (kills) lines.push({ label: `${kills} Eliminierungen`, xp: kills * XP.kill });
  lines.push({ label: 'Match beendet', xp: XP.finish });
  if (res.mode === 'dm') {
    if (place === 1) { lines.push({ label: '1. Platz', xp: XP.win }); won = true; }
    else if (place === 2) lines.push({ label: '2. Platz', xp: XP.second });
    else if (place === 3 && res.rows.length > 3) lines.push({ label: '3. Platz', xp: XP.third });
  } else if (res.mode === 'team') {
    if (res.winnerTeam === 0) { lines.push({ label: 'Teamsieg', xp: XP.win }); won = true; }
    else if (res.winnerTeam === null) lines.push({ label: 'Unentschieden', xp: Math.round(XP.win / 3) });
  } else if (res.wave > 0) {
    lines.push({ label: `${res.wave} Wellen überlebt`, xp: res.wave * XP.wave });
    won = res.wave >= 5;
  }
  let total = lines.reduce((s, l) => s + l.xp, 0);
  const withBots = res.mode !== 'dm' || res.rows.some((r) => r.bot);
  const dm = withBots ? DIFFS[settings.diff].xp : 1;
  if (dm !== 1) {
    const extra = Math.round(total * (dm - 1));
    lines.push({ label: `Schwierigkeit ${DIFFS[settings.diff].name} ×${dm}`, xp: extra });
    total += extra;
  }
  if (humans > 1) {
    const extra = Math.round(total * XP.online);
    lines.push({ label: 'Mit Freunden gespielt +20 %', xp: extra });
    total += extra;
  }
  return { lines, total, won, place };
}
