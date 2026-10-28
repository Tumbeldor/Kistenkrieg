// Static game data: weapons, perks, cosmetics, difficulties, modes, progression.

export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'flamer' | 'minigun' | 'rocket' | 'rail';
export type WeaponKind = 'bullet' | 'rocket' | 'flame' | 'beam';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
  unlock: number;
  kind: WeaponKind;
  dmg: number;
  rate: number; // shots per second
  mag: number;
  reload: number; // seconds
  pellets: number;
  spread: number; // radians, total cone
  speed: number; // px/s
  range: number; // px
  moveMul: number;
  pierce: number; // how many players a projectile passes through
  splash: number; // explosion radius
  splashDmg: number;
  crateMul: number; // damage multiplier vs crates
  shake: number;
  color: string;
  len: number; // barrel length (visual + muzzle offset)
  thick: number;
  botRange: number;
  spinUp: number;
  pickupAmmo: number;
}

const W = (d: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'desc' | 'unlock'>): WeaponDef => ({
  kind: 'bullet', dmg: 10, rate: 5, mag: 10, reload: 1.5, pellets: 1, spread: 0.05, speed: 1500, range: 900,
  moveMul: 1, pierce: 0, splash: 0, splashDmg: 0, crateMul: 1, shake: 2, color: '#ffe3a1', len: 18, thick: 7,
  botRange: 380, spinUp: 0, pickupAmmo: 30, ...d,
});

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: W({ id: 'pistol', name: 'Pistole', desc: 'Zuverlässig und präzise. Immer dabei.', unlock: 1,
    dmg: 22, rate: 4.5, mag: 12, reload: 1.0, spread: 0.035, speed: 1500, range: 950, moveMul: 1.05,
    shake: 1.5, len: 14, thick: 6, botRange: 380, pickupAmmo: 36 }),
  smg: W({ id: 'smg', name: 'MP', desc: 'Hohe Feuerrate, ideal auf mittlere Distanz.', unlock: 1,
    dmg: 11, rate: 12, mag: 32, reload: 1.5, spread: 0.1, speed: 1400, range: 750,
    shake: 1.5, color: '#ffd27a', len: 18, thick: 7, botRange: 320, pickupAmmo: 96 }),
  shotgun: W({ id: 'shotgun', name: 'Schrotflinte', desc: 'Verheerend aus nächster Nähe.', unlock: 3,
    dmg: 12, pellets: 8, rate: 1.15, mag: 6, reload: 1.9, spread: 0.34, speed: 1250, range: 480, moveMul: 0.96,
    shake: 6, color: '#ffcf8a', len: 22, thick: 8, botRange: 170, pickupAmmo: 18 }),
  rifle: W({ id: 'rifle', name: 'Sturmgewehr', desc: 'Allrounder mit gutem Schaden und Reichweite.', unlock: 5,
    dmg: 17, rate: 8.5, mag: 28, reload: 1.8, spread: 0.05, speed: 1750, range: 1050, moveMul: 0.95,
    shake: 2.2, color: '#fff2b8', len: 26, thick: 7, botRange: 480, pickupAmmo: 84 }),
  sniper: W({ id: 'sniper', name: 'Scharfschützengewehr', desc: 'Ein Treffer, fast ein Kill. Durchschlägt Gegner.', unlock: 8,
    dmg: 95, rate: 0.85, mag: 5, reload: 2.3, spread: 0.004, speed: 3400, range: 1900, moveMul: 0.88, pierce: 1,
    crateMul: 1.5, shake: 7, color: '#b8f3ff', len: 36, thick: 6, botRange: 750, pickupAmmo: 12 }),
  flamer: W({ id: 'flamer', name: 'Flammenwerfer', desc: 'Kurze Reichweite, brennt durch mehrere Gegner.', unlock: 11, kind: 'flame',
    dmg: 5, rate: 24, mag: 90, reload: 2.2, spread: 0.26, speed: 520, range: 320, moveMul: 0.95, pierce: 99,
    crateMul: 2, shake: 0.6, color: '#ff8a1e', len: 22, thick: 10, botRange: 150, pickupAmmo: 180 }),
  minigun: W({ id: 'minigun', name: 'Minigun', desc: 'Bleihagel nach kurzem Anlaufen. Macht langsam.', unlock: 14,
    dmg: 9, rate: 18, mag: 140, reload: 3.2, spread: 0.12, speed: 1500, range: 880, moveMul: 0.78, spinUp: 0.45,
    shake: 1.8, color: '#ffe08a', len: 30, thick: 11, botRange: 420, pickupAmmo: 280 }),
  rocket: W({ id: 'rocket', name: 'Raketenwerfer', desc: 'Flächenschaden. Sprengt Kisten. Vorsicht vor Eigenschaden!', unlock: 17, kind: 'rocket',
    dmg: 45, splash: 125, splashDmg: 85, rate: 0.8, mag: 2, reload: 2.4, spread: 0.01, speed: 760, range: 1400, moveMul: 0.86,
    crateMul: 3, shake: 9, color: '#ffb36b', len: 30, thick: 12, botRange: 480, pickupAmmo: 6 }),
  rail: W({ id: 'rail', name: 'Railgun', desc: 'Sofortiger Energiestrahl, durchdringt Gegner und Kisten.', unlock: 20, kind: 'beam',
    dmg: 75, rate: 1.0, mag: 4, reload: 2.1, spread: 0, speed: 0, range: 2000, moveMul: 0.92, pierce: 99,
    crateMul: 1.5, shake: 6, color: '#7cf5ff', len: 34, thick: 7, botRange: 700, pickupAmmo: 10 }),
};
export const WEAPON_LIST: WeaponId[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'flamer', 'minigun', 'rocket', 'rail'];
export const PICKUP_WEAPONS: WeaponId[] = ['shotgun', 'sniper', 'flamer', 'minigun', 'rocket', 'rail'];

export type PerkId = 'none' | 'tough' | 'swift' | 'reload' | 'mag' | 'vamp' | 'regen' | 'blast';
export interface PerkDef { id: PerkId; name: string; desc: string; unlock: number; icon: string }
export const PERKS: PerkDef[] = [
  { id: 'none', name: 'Kein Perk', desc: 'Ganz ohne Extras.', unlock: 1, icon: '–' },
  { id: 'tough', name: 'Zäh', desc: '+25 maximale Lebenspunkte.', unlock: 4, icon: '🛡️' },
  { id: 'swift', name: 'Flink', desc: '+12 % Laufgeschwindigkeit.', unlock: 6, icon: '👟' },
  { id: 'reload', name: 'Schnelllader', desc: 'Nachladen 35 % schneller.', unlock: 9, icon: '⚡' },
  { id: 'mag', name: 'Großes Magazin', desc: '+40 % Magazingröße.', unlock: 12, icon: '📦' },
  { id: 'vamp', name: 'Vampir', desc: '+25 LP für jede Eliminierung.', unlock: 15, icon: '🦇' },
  { id: 'regen', name: 'Regeneration', desc: 'Heilt 6 LP/s, wenn du 4 s keinen Schaden nimmst.', unlock: 19, icon: '💚' },
  { id: 'blast', name: 'Sprengmeister', desc: 'Kein Eigenschaden durch Explosionen, +25 % Radius.', unlock: 23, icon: '💥' },
];
export const perkDef = (id: string): PerkDef => PERKS.find((p) => p.id === id) ?? PERKS[0];

export interface SkinDef { id: string; name: string; color: string; unlock: number }
export const SKINS: SkinDef[] = [
  { id: 'blue', name: 'Blau', color: '#3b82f6', unlock: 1 },
  { id: 'green', name: 'Grün', color: '#22c55e', unlock: 1 },
  { id: 'orange', name: 'Orange', color: '#f97316', unlock: 1 },
  { id: 'purple', name: 'Lila', color: '#a855f7', unlock: 2 },
  { id: 'pink', name: 'Pink', color: '#ec4899', unlock: 3 },
  { id: 'teal', name: 'Türkis', color: '#14b8a6', unlock: 5 },
  { id: 'gold', name: 'Gold', color: '#eab308', unlock: 7 },
  { id: 'red', name: 'Rot', color: '#ef4444', unlock: 9 },
  { id: 'white', name: 'Schnee', color: '#e8eef7', unlock: 11 },
  { id: 'black', name: 'Schatten', color: '#232a36', unlock: 13 },
  { id: 'lime', name: 'Limette', color: '#a3e635', unlock: 16 },
  { id: 'rainbow', name: 'Regenbogen', color: 'rainbow', unlock: 25 },
  { id: 'chrome', name: 'Chrom', color: 'chrome', unlock: 30 },
];
export const skinDef = (id: string): SkinDef => SKINS.find((s) => s.id === id) ?? SKINS[0];

export interface HatDef { id: string; name: string; unlock: number }
export const HATS: HatDef[] = [
  { id: 'none', name: 'Ohne', unlock: 1 },
  { id: 'cap', name: 'Kappe', unlock: 2 },
  { id: 'band', name: 'Stirnband', unlock: 5 },
  { id: 'party', name: 'Partyhut', unlock: 8 },
  { id: 'horns', name: 'Hörner', unlock: 10 },
  { id: 'tophat', name: 'Zylinder', unlock: 13 },
  { id: 'antenna', name: 'Antenne', unlock: 16 },
  { id: 'viking', name: 'Wikinger', unlock: 18 },
  { id: 'halo', name: 'Heiligenschein', unlock: 21 },
  { id: 'crown', name: 'Krone', unlock: 24 },
  { id: 'ninja', name: 'Ninja', unlock: 27 },
  { id: 'fire', name: 'Feuerkopf', unlock: 29 },
];

export type DiffId = 'easy' | 'normal' | 'hard' | 'insane';
export interface DiffDef {
  id: DiffId; name: string; desc: string; xp: number;
  reaction: number; aimErr: number; turn: number; dmgMul: number; hpMul: number;
  sight: number; lead: number; strafe: number; hunt: number; smart: boolean;
}
export const DIFFS: Record<DiffId, DiffDef> = {
  easy: { id: 'easy', name: 'Leicht', desc: 'Entspannt – Bots zielen schlecht.', xp: 0.7, reaction: 0.65, aimErr: 0.2, turn: 4,
    dmgMul: 0.6, hpMul: 0.85, sight: 650, lead: 0, strafe: 0.35, hunt: 0.45, smart: false },
  normal: { id: 'normal', name: 'Normal', desc: 'Faire Gegner.', xp: 1, reaction: 0.42, aimErr: 0.11, turn: 7,
    dmgMul: 0.8, hpMul: 1, sight: 820, lead: 0.35, strafe: 0.7, hunt: 0.65, smart: false },
  hard: { id: 'hard', name: 'Schwer', desc: 'Bots weichen aus, holen sich Medikits.', xp: 1.4, reaction: 0.26, aimErr: 0.06, turn: 11,
    dmgMul: 0.95, hpMul: 1, sight: 980, lead: 0.75, strafe: 1, hunt: 0.85, smart: true },
  insane: { id: 'insane', name: 'Albtraum', desc: 'Nur für Profis.', xp: 1.9, reaction: 0.15, aimErr: 0.03, turn: 16,
    dmgMul: 1.1, hpMul: 1.15, sight: 1150, lead: 1, strafe: 1, hunt: 1, smart: true },
};
export const DIFF_LIST: DiffId[] = ['easy', 'normal', 'hard', 'insane'];

export type ModeId = 'dm' | 'team' | 'survival';
export const MODES: Record<ModeId, { id: ModeId; name: string; desc: string; coop: boolean }> = {
  dm: { id: 'dm', name: 'Jeder gegen jeden', desc: 'Freie Schlacht gegen Freunde und Bots. Wer zuerst das Kill-Limit erreicht, gewinnt.', coop: false },
  team: { id: 'team', name: 'Team vs. Bots', desc: 'Koop: Ihr spielt zusammen als Team gegen ein Bot-Team.', coop: true },
  survival: { id: 'survival', name: 'Überleben', desc: 'Koop: Haltet so viele Bot-Wellen wie möglich durch. Alle 5 Wellen kommt ein Boss.', coop: true },
};
export const MODE_LIST: ModeId[] = ['dm', 'team', 'survival'];

export type MapId = 'lager' | 'wald' | 'wueste';
export const MAPS: Record<MapId, { id: MapId; name: string }> = {
  lager: { id: 'lager', name: 'Lagerhalle' },
  wald: { id: 'wald', name: 'Wald' },
  wueste: { id: 'wueste', name: 'Wüste' },
};
export const MAP_LIST: MapId[] = ['lager', 'wald', 'wueste'];

export type MapSizeId = 'auto' | 'small' | 'medium' | 'large';
export const MAP_SIZE_LIST: { id: MapSizeId; name: string }[] = [
  { id: 'auto', name: 'Automatisch' }, { id: 'small', name: 'Klein' }, { id: 'medium', name: 'Mittel' }, { id: 'large', name: 'Groß' },
];

export interface MatchSettings {
  mode: ModeId;
  map: MapId | 'random';
  mapSize: MapSizeId; // auto = by player count
  diff: DiffId;
  bots: number; // enemy bots (dm: all bots)
  allies: number; // team mode: bots on the human team
  killLimit: number;
  timeLimit: number; // seconds
}

export const defaultSettings = (mode: ModeId = 'dm'): MatchSettings => ({
  mode, map: 'random', mapSize: 'auto', diff: 'normal',
  bots: mode === 'team' ? 5 : 4,
  allies: mode === 'team' ? 1 : 0,
  killLimit: mode === 'team' ? 30 : 15,
  timeLimit: mode === 'team' ? 420 : 300,
});

export const MAX_HUMANS = 4;
export const MAX_TOTAL = 12;
export const PLAYER_RADIUS = 18;
export const BASE_SPEED = 250;
export const BASE_HP = 100;
export const RESPAWN_TIME = 3;
export const SPAWN_PROTECT = 1.6;

// Progression
export const MAX_LEVEL = 30;
export const xpToNext = (level: number) => 250 + 100 * level;
export function levelInfo(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = totalXp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

export const XP = { kill: 100, finish: 100, win: 300, second: 150, third: 75, wave: 80, online: 0.2 };

export interface Unlock { level: number; kind: 'Waffe' | 'Perk' | 'Farbe' | 'Hut'; name: string }
export function allUnlocks(): Unlock[] {
  const list: Unlock[] = [];
  for (const id of WEAPON_LIST) list.push({ level: WEAPONS[id].unlock, kind: 'Waffe', name: WEAPONS[id].name });
  for (const p of PERKS) if (p.id !== 'none') list.push({ level: p.unlock, kind: 'Perk', name: p.name });
  for (const s of SKINS) list.push({ level: s.unlock, kind: 'Farbe', name: s.name });
  for (const h of HATS) if (h.id !== 'none') list.push({ level: h.unlock, kind: 'Hut', name: h.name });
  return list.filter((u) => u.level > 1).sort((a, b) => a.level - b.level);
}

export const BOT_NAMES = [
  'Kevin', 'Jürgen', 'Heidi', 'Uwe', 'Svenja', 'Horst', 'Gabi', 'Dieter', 'Lena', 'Klaus', 'Bärbel', 'Günther',
  'Mia', 'Detlef', 'Ute', 'Ronny', 'Chantal', 'Helmut', 'Jana', 'Torsten', 'Gisela', 'Bernd', 'Nina', 'Olaf',
];

export const TEAM_COLORS = ['#4aa3ff', '#ff5a5a'];
export const TEAM_NAMES = ['Team Blau', 'Team Rot'];
