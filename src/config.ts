// Static game data: weapons, perks, cosmetics, difficulties, modes, progression.

/** Test build (experiment branch, published under /test/): own save game and own rooms. */
export const IS_TEST = import.meta.env.VITE_CHANNEL === 'test';

export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'flamer' | 'minigun' | 'rocket' | 'rail'
  | 'revolver' | 'crossbow' | 'smgsil' | 'dmr' | 'lmg' | 'autoshotgun' | 'gl' | 'grenade';
export type WeaponKind = 'bullet' | 'rocket' | 'flame' | 'beam' | 'grenade';

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
  silent: boolean; // bots do not hear it, does not reveal the shooter
  fuse: number; // grenades: seconds until detonation
}

const W = (d: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'desc' | 'unlock'>): WeaponDef => ({
  kind: 'bullet', dmg: 10, rate: 5, mag: 10, reload: 1.5, pellets: 1, spread: 0.05, speed: 1500, range: 900,
  moveMul: 1, pierce: 0, splash: 0, splashDmg: 0, crateMul: 1, shake: 2, color: '#ffe3a1', len: 18, thick: 7,
  botRange: 380, spinUp: 0, pickupAmmo: 30, silent: false, fuse: 0, ...d,
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
  revolver: W({ id: 'revolver', name: 'Revolver', desc: 'Sechs Schuss, jeder davon sitzt.', unlock: 2,
    dmg: 46, rate: 1.9, mag: 6, reload: 2.0, spread: 0.02, speed: 1700, range: 1000, moveMul: 1.03,
    shake: 3.5, len: 16, thick: 6, botRange: 400, pickupAmmo: 18 }),
  crossbow: W({ id: 'crossbow', name: 'Armbrust', desc: 'Lautlos und tödlich. Bots hören dich nicht.', unlock: 6,
    dmg: 80, rate: 1.0, mag: 1, reload: 1.15, spread: 0.006, speed: 1250, range: 1400, moveMul: 0.97, silent: true,
    crateMul: 0.6, shake: 1, color: '#d9d2c0', len: 26, thick: 7, botRange: 520, pickupAmmo: 8 }),
  smgsil: W({ id: 'smgsil', name: 'Schalldämpfer-MP', desc: 'Leise Maschinenpistole. Verrät dich nicht im Busch.', unlock: 9,
    dmg: 10, rate: 11, mag: 30, reload: 1.5, spread: 0.09, speed: 1350, range: 700, silent: true,
    shake: 1, color: '#e8dcb0', len: 26, thick: 7, botRange: 300, pickupAmmo: 90 }),
  dmr: W({ id: 'dmr', name: 'Präzisionsgewehr', desc: 'Halbautomatisch, große Reichweite, hoher Schaden.', unlock: 12,
    dmg: 42, rate: 2.6, mag: 10, reload: 2.0, spread: 0.01, speed: 2600, range: 1500, moveMul: 0.92,
    shake: 3.5, color: '#fff2b8', len: 32, thick: 6, botRange: 620, pickupAmmo: 30 }),
  lmg: W({ id: 'lmg', name: 'Maschinengewehr', desc: 'Großes Magazin für Dauerfeuer. Macht etwas langsamer.', unlock: 15,
    dmg: 15, rate: 10, mag: 80, reload: 3.6, spread: 0.08, speed: 1700, range: 1000, moveMul: 0.82,
    shake: 2.2, color: '#ffe08a', len: 30, thick: 9, botRange: 460, pickupAmmo: 160 }),
  autoshotgun: W({ id: 'autoshotgun', name: 'Automatik-Schrotflinte', desc: 'Schrot im Dauerfeuer – auf kurze Distanz unschlagbar.', unlock: 18,
    dmg: 9, pellets: 7, rate: 3.6, mag: 10, reload: 2.4, spread: 0.3, speed: 1200, range: 430, moveMul: 0.93,
    shake: 4, color: '#ffcf8a', len: 24, thick: 9, botRange: 170, pickupAmmo: 30 }),
  gl: W({ id: 'gl', name: 'Granatwerfer', desc: 'Granaten prallen von Wänden ab und explodieren nach kurzer Zeit.', unlock: 22, kind: 'grenade',
    dmg: 25, splash: 115, splashDmg: 80, rate: 1.3, mag: 6, reload: 3.0, spread: 0.02, speed: 820, range: 99999, fuse: 1.1, moveMul: 0.9,
    crateMul: 2.5, shake: 4, color: '#9aa37a', len: 24, thick: 11, botRange: 420, pickupAmmo: 12 }),
  grenade: W({ id: 'grenade', name: 'Handgranate', desc: 'Wurfgeschoss mit Zeitzünder.', unlock: 999, kind: 'grenade',
    dmg: 0, splash: 130, splashDmg: 95, rate: 99, mag: 1, spread: 0, speed: 700, range: 99999, fuse: 1.5,
    crateMul: 3, shake: 0, color: '#6b7350', len: 4, thick: 4, botRange: 400, pickupAmmo: 0 }),
};
/** Selectable weapons, ordered by unlock level (the hand grenade is not a weapon slot). */
export const WEAPON_LIST: WeaponId[] = ['pistol', 'smg', 'revolver', 'shotgun', 'rifle', 'crossbow', 'sniper', 'smgsil', 'flamer',
  'dmr', 'minigun', 'lmg', 'rocket', 'autoshotgun', 'rail', 'gl'];
export const PICKUP_WEAPONS: WeaponId[] = ['shotgun', 'sniper', 'flamer', 'minigun', 'rocket', 'rail', 'dmr', 'lmg', 'autoshotgun', 'crossbow', 'gl'];
/** "Waffenmeister": every kill advances to the next weapon, a kill with the last one wins. */
export const GUN_TIERS: WeaponId[] = ['rifle', 'smg', 'autoshotgun', 'lmg', 'shotgun', 'dmr', 'smgsil', 'minigun', 'sniper', 'flamer', 'crossbow', 'revolver', 'pistol'];
export const GRENADES = 2;

export type PerkId = 'none' | 'tough' | 'swift' | 'reload' | 'grenadier' | 'mag' | 'vamp' | 'regen' | 'blast';
export interface PerkDef { id: PerkId; name: string; desc: string; unlock: number }
export const PERKS: PerkDef[] = [
  { id: 'none', name: 'Kein Perk', desc: 'Standardausrüstung ohne Extras.', unlock: 1 },
  { id: 'tough', name: 'Abgehärtet', desc: '+25 maximale Lebenspunkte.', unlock: 4 },
  { id: 'swift', name: 'Leichtes Gepäck', desc: '+12 % Laufgeschwindigkeit.', unlock: 6 },
  { id: 'reload', name: 'Schnellladen', desc: 'Nachladen 35 % schneller.', unlock: 9 },
  { id: 'grenadier', name: 'Grenadier', desc: '+2 Handgranaten pro Leben.', unlock: 7 },
  { id: 'mag', name: 'Erweiterte Magazine', desc: '+40 % Magazingröße.', unlock: 12 },
  { id: 'vamp', name: 'Adrenalin', desc: '+25 LP für jede Eliminierung.', unlock: 15 },
  { id: 'regen', name: 'Feldsanitäter', desc: 'Heilt 6 LP/s, wenn du 4 s keinen Schaden nimmst.', unlock: 19 },
  { id: 'blast', name: 'Sprengstoffexperte', desc: 'Kein Eigenschaden durch Explosionen, +25 % Radius.', unlock: 23 },
];
export const perkDef = (id: string): PerkDef => PERKS.find((p) => p.id === id) ?? PERKS[0];

/** Uniform camouflage: base colour plus pattern colours. `color` is the representative colour for UI. */
export type CamoPattern = 'plain' | 'blotch' | 'digital' | 'stripe';
export interface SkinDef { id: string; name: string; color: string; spots: string[]; pattern: CamoPattern; unlock: number }
export const SKINS: SkinDef[] = [
  { id: 'woodland', name: 'Woodland', color: '#4f5b3c', spots: ['#2f3826', '#6e6a47', '#1e2219'], pattern: 'blotch', unlock: 1 },
  { id: 'desert', name: 'Wüste', color: '#b19d76', spots: ['#8c7752', '#cdbb93'], pattern: 'blotch', unlock: 1 },
  { id: 'urban', name: 'Urban', color: '#686d74', spots: ['#474b52', '#8a8f96'], pattern: 'blotch', unlock: 1 },
  { id: 'olive', name: 'Oliv', color: '#566238', spots: [], pattern: 'plain', unlock: 2 },
  { id: 'navy', name: 'Marine', color: '#2e3d52', spots: ['#1f2a3a', '#3e5068'], pattern: 'digital', unlock: 3 },
  { id: 'black', name: 'Schwarz', color: '#25282d', spots: [], pattern: 'plain', unlock: 5 },
  { id: 'winter', name: 'Winter', color: '#c9ced4', spots: ['#9ea6b0', '#e6e9ec'], pattern: 'blotch', unlock: 7 },
  { id: 'digital', name: 'Digital', color: '#5d6648', spots: ['#3c4430', '#7c7a5a', '#2a2f22'], pattern: 'digital', unlock: 9 },
  { id: 'tiger', name: 'Tigerstreifen', color: '#5a6040', spots: ['#262a1c', '#7a6f4a'], pattern: 'stripe', unlock: 11 },
  { id: 'arid', name: 'Steppe', color: '#8f8462', spots: ['#6b6248', '#a89c76', '#5a4f3a'], pattern: 'digital', unlock: 13 },
  { id: 'night', name: 'Nachtjäger', color: '#1d2430', spots: ['#141a22', '#2b3646'], pattern: 'stripe', unlock: 16 },
  { id: 'elite', name: 'Elite Schwarz-Gold', color: '#1f2024', spots: ['#8a7334'], pattern: 'stripe', unlock: 25 },
  { id: 'titan', name: 'Titan', color: '#7d848c', spots: ['#5d636b', '#a2a9b1'], pattern: 'digital', unlock: 30 },
];
export const skinDef = (id: string): SkinDef => SKINS.find((s) => s.id === id) ?? SKINS[0];

export interface HatDef { id: string; name: string; unlock: number }
export const HATS: HatDef[] = [
  { id: 'none', name: 'Ohne', unlock: 1 },
  { id: 'cap', name: 'Basecap', unlock: 2 },
  { id: 'beanie', name: 'Mütze', unlock: 5 },
  { id: 'headset', name: 'Headset', unlock: 8 },
  { id: 'beret', name: 'Barett', unlock: 10 },
  { id: 'boonie', name: 'Boonie-Hut', unlock: 13 },
  { id: 'helmet', name: 'Gefechtshelm', unlock: 16 },
  { id: 'balaclava', name: 'Sturmhaube', unlock: 18 },
  { id: 'nvg', name: 'Nachtsichtgerät', unlock: 21 },
  { id: 'gasmask', name: 'Gasmaske', unlock: 24 },
  { id: 'tactical', name: 'Taktischer Helm', unlock: 27 },
  { id: 'officer', name: 'Schirmmütze', unlock: 29 },
];

export type DiffId = 'easy' | 'normal' | 'hard' | 'insane';
export interface DiffDef {
  id: DiffId; name: string; desc: string; xp: number;
  reaction: number; aimErr: number; turn: number; dmgMul: number; hpMul: number;
  /** Half-width of the bot's view box (like a player's screen); half-height is half of it. */
  sight: number; lead: number; strafe: number; hunt: number; smart: boolean;
  /** Movement speed relative to a player. */
  speed: number;
}
export const DIFFS: Record<DiffId, DiffDef> = {
  easy: { id: 'easy', name: 'Leicht', desc: 'Entspannt – Bots zielen schlecht.', xp: 0.7, reaction: 0.8, aimErr: 0.25, turn: 3.5,
    dmgMul: 0.5, hpMul: 0.85, sight: 520, lead: 0, strafe: 0.35, hunt: 0.45, smart: false, speed: 0.8 },
  normal: { id: 'normal', name: 'Normal', desc: 'Faire Gegner.', xp: 1, reaction: 0.55, aimErr: 0.15, turn: 6,
    dmgMul: 0.7, hpMul: 1, sight: 600, lead: 0.25, strafe: 0.7, hunt: 0.65, smart: false, speed: 0.84 },
  hard: { id: 'hard', name: 'Schwer', desc: 'Bots weichen aus, holen sich Medikits.', xp: 1.4, reaction: 0.36, aimErr: 0.085, turn: 9,
    dmgMul: 0.85, hpMul: 1, sight: 660, lead: 0.6, strafe: 1, hunt: 0.85, smart: true, speed: 0.88 },
  insane: { id: 'insane', name: 'Albtraum', desc: 'Nur für Profis.', xp: 1.9, reaction: 0.22, aimErr: 0.05, turn: 13,
    dmgMul: 1.0, hpMul: 1.1, sight: 690, lead: 0.85, strafe: 1, hunt: 1, smart: true, speed: 0.92 },
};
export const DIFF_LIST: DiffId[] = ['easy', 'normal', 'hard', 'insane'];

export type ModeId = 'dm' | 'team' | 'survival' | 'gungame';
export const MODES: Record<ModeId, { id: ModeId; name: string; desc: string; coop: boolean }> = {
  dm: { id: 'dm', name: 'Jeder gegen jeden', desc: 'Freie Schlacht gegen Freunde und Bots. Wer zuerst das Kill-Limit erreicht, gewinnt.', coop: false },
  team: { id: 'team', name: 'Team vs. Bots', desc: 'Koop: Ihr spielt zusammen als Team gegen ein Bot-Team.', coop: true },
  survival: { id: 'survival', name: 'Überleben', desc: 'Koop: Haltet so viele Bot-Wellen wie möglich durch. Alle 5 Wellen kommt ein Boss.', coop: true },
  gungame: { id: 'gungame', name: 'Waffenmeister', desc: 'Jede Eliminierung bringt dich zur nächsten Waffe. Wer zuerst alle 13 Stufen schafft, gewinnt.', coop: false },
};
export const MODE_LIST: ModeId[] = ['dm', 'gungame', 'team', 'survival'];
/** Free-for-all modes (everyone against everyone, optional bots). */
export const isFfa = (m: ModeId) => m === 'dm' || m === 'gungame';

export type MapId = 'lager' | 'wald' | 'wueste' | 'winter' | 'stadt';
export const MAPS: Record<MapId, { id: MapId; name: string }> = {
  lager: { id: 'lager', name: 'Lagerhalle' },
  wald: { id: 'wald', name: 'Wald' },
  wueste: { id: 'wueste', name: 'Wüste' },
  winter: { id: 'winter', name: 'Winter' },
  stadt: { id: 'stadt', name: 'Stadt' },
};
export const MAP_LIST: MapId[] = ['lager', 'wald', 'wueste', 'winter', 'stadt'];

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
  timeLimit: mode === 'team' ? 420 : mode === 'gungame' ? 480 : 300,
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
/** XP needed from `level` to `level + 1` (curve v2: about twice as long as v1 to reach level 30). */
export const xpToNext = (level: number) => 400 + 180 * level;
/** First curve, only used to migrate old save games so nobody loses a level. */
export const xpToNextV1 = (level: number) => 250 + 100 * level;
export function levelInfo(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = totalXp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

export const XP = { kill: 80, finish: 100, win: 300, second: 150, third: 75, wave: 60, online: 0.2 };

export interface Unlock { level: number; kind: 'Waffe' | 'Perk' | 'Tarnung' | 'Kopfbedeckung'; name: string }
export function allUnlocks(): Unlock[] {
  const list: Unlock[] = [];
  for (const id of WEAPON_LIST) list.push({ level: WEAPONS[id].unlock, kind: 'Waffe', name: WEAPONS[id].name });
  for (const p of PERKS) if (p.id !== 'none') list.push({ level: p.unlock, kind: 'Perk', name: p.name });
  for (const s of SKINS) list.push({ level: s.unlock, kind: 'Tarnung', name: s.name });
  for (const h of HATS) if (h.id !== 'none') list.push({ level: h.unlock, kind: 'Kopfbedeckung', name: h.name });
  return list.filter((u) => u.level > 1).sort((a, b) => a.level - b.level);
}

export const BOT_NAMES = [
  'Falke', 'Wolf', 'Viper', 'Adler', 'Fuchs', 'Luchs', 'Bär', 'Kobra', 'Specht', 'Hammer', 'Sturm', 'Eisen',
  'Schatten', 'Rabe', 'Keiler', 'Habicht', 'Dachs', 'Marder', 'Kranich', 'Wiesel', 'Granit', 'Orkan', 'Blitz', 'Echo',
];

export const TEAM_COLORS = ['#5b9bd5', '#cf5a4f'];
export const TEAM_NAMES = ['Team Blau', 'Team Rot'];
