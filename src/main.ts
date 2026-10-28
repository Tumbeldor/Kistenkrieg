import './styles.css';
import {
  HATS, MAP_LIST, MAX_HUMANS, MAX_TOTAL, MatchSettings, PERKS, SKINS, WEAPONS, WEAPON_LIST, WeaponId, PerkId,
  defaultSettings, levelInfo, MapId,
} from './config';
import { Game, MatchResult, PlayerInfo, PlayerInput, emptyInput, sameTeam } from './game';
import { Renderer } from './render';
import { mapSizeFor } from './map';
import { Input } from './input';
import { Fx } from './fx';
import { angleDiff, dist } from './geom';
import { pick } from './rng';
import * as audio from './audio';
import { Profile, cleanName, computeXp, exportCode, importCode, level, loadProfile, saveProfile, sanitize } from './profile';
import { ClientTransport, HostTransport, Link, Msg, PROTOCOL, createHost, joinHost, normCode } from './net';
import * as ui from './ui';
import type { LobbyMember } from './ui';

const $ = ui.$;
const canvas = $<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const input = new Input();
input.attach(canvas);
const fx = new Fx();
const demoFx = new Fx();
let profile: Profile = loadProfile();
audio.setVolume(profile.settings.volume);

// ---------------------------------------------------------------- session state

interface Session {
  kind: 'solo' | 'host' | 'client';
  game: Game | null;
  settings: MatchSettings;
  myId: string;
  members: LobbyMember[];
  code: string;
  host: HostTransport | null;
  client: ClientTransport | null;
  links: Map<string, Link>;
  ping: number | null;
  netT: number;
  pingT: number;
  ended: boolean;
}

let session: Session | null = null;
let demo: Game | null = null;
let demoFollow: string | null = null;
let demoFollowT = 0;
let paused = false;
let returnTo = 'menu';
let fps = 60;
let wakeLock: { release(): Promise<void> } | null = null;

const myMember = (): LobbyMember => ({
  id: session?.myId ?? 'h0', name: profile.name, level: level(profile), skin: profile.skin, hat: profile.hat,
  primary: profile.primary, perk: profile.perk, host: session?.kind !== 'client',
});
const profMsg = () => ({ name: profile.name, level: level(profile), skin: profile.skin, hat: profile.hat, primary: profile.primary, perk: profile.perk });

function validMember(id: string, raw: Record<string, unknown>): LobbyMember {
  const prim = WEAPON_LIST.includes(raw.primary as WeaponId) ? (raw.primary as WeaponId) : 'smg';
  return {
    id,
    name: cleanName(typeof raw.name === 'string' ? raw.name : 'Spieler'),
    level: Math.max(1, Math.min(30, Number(raw.level) | 0)),
    skin: SKINS.some((s) => s.id === raw.skin) ? (raw.skin as string) : 'woodland',
    hat: HATS.some((h) => h.id === raw.hat) ? (raw.hat as string) : 'none',
    primary: prim,
    perk: PERKS.some((p) => p.id === raw.perk) ? (raw.perk as string) : 'none',
    host: false,
  };
}

const infoOf = (m: LobbyMember, team: number): PlayerInfo => ({
  id: m.id, name: m.name, bot: false, team, skin: m.skin, hat: m.hat, level: m.level, perk: m.perk as PerkId, primary: m.primary,
});

// ---------------------------------------------------------------- navigation

function go(name: string) {
  if (name === 'loadout' || name === 'help') returnTo = ui.currentScreen() || 'menu';
  if (name === 'menu') ui.renderMenuProfile(profile);
  if (name === 'solo') renderSolo();
  if (name === 'loadout') renderLoadout();
  if (name === 'progress') ui.renderProgress(profile);
  if (name === 'settings') renderSettingsScreen();
  if (name === 'lobby') renderLobbyScreen();
  if (name === 'online') {
    $('online-status').textContent = '';
    $('online-status').classList.remove('err');
  }
  ui.show(name);
}

document.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => { audio.sfxUi('click'); go(b.dataset.go!); }));
$('loadout-back').onclick = () => back();
$('help-back').onclick = () => back();
function back() {
  if (returnTo === 'pause') { ui.show('pause'); return; }
  go(returnTo === 'lobby' ? 'lobby' : returnTo || 'menu');
}

// first user gesture unlocks audio (iOS)
const unlock = () => audio.unlockAudio();
window.addEventListener('pointerdown', unlock);
window.addEventListener('touchend', unlock);
window.addEventListener('keydown', unlock);
input.onFirstTouch = unlock;
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------------------------------------------------------------- menu & profile

const nameInput = $<HTMLInputElement>('name-input');
nameInput.addEventListener('input', () => {
  profile.name = cleanName(nameInput.value || 'Spieler');
  saveProfile(profile);
  sendProfileUpdate();
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

function drawPreviews() {
  const t = performance.now() / 1000;
  for (const id of ['menu-avatar', 'loadout-avatar']) {
    const c = $<HTMLCanvasElement>(id);
    if (!c.offsetParent) continue;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    if (c.width !== w) { c.width = w; c.height = w; }
    renderer.avatar(c, profile.skin, profile.hat, profile.primary, 0.5 + Math.sin(t * 0.8) * 0.4, t);
  }
}

function renderLoadout() {
  ui.renderLoadout(profile, () => {
    saveProfile(profile);
    renderLoadout();
    sendProfileUpdate();
  }, (c, w) => {
    const dpr = 2;
    c.width = 120 * dpr; c.height = 34 * dpr;
    renderer.gunIcon(c, w);
  }, (c, hat, skin) => renderer.avatar(c, skin, hat, profile.primary, 0.6), (c, skin) => renderer.camoSwatch(c, skin));
}

/** Push loadout/name changes into the running game or to the host. */
function sendProfileUpdate() {
  if (!session) return;
  const g = session.game;
  if (g) g.setLoadout(session.myId, profile.primary, profile.perk, profile.skin, profile.hat);
  if (session.kind === 'client') session.client?.send({ t: 'prof', prof: profMsg() });
  else if (session.kind === 'host') {
    session.members[0] = myMember();
    broadcastLobby();
  }
}

// ---------------------------------------------------------------- settings screen

function renderSettingsScreen() {
  const vol = $<HTMLInputElement>('set-volume');
  vol.value = String(profile.settings.volume);
  vol.oninput = () => { profile.settings.volume = Number(vol.value); audio.setVolume(profile.settings.volume); saveProfile(profile); };
  vol.onchange = () => audio.sfxUi('click');
  const as = $<HTMLInputElement>('set-assist');
  as.checked = profile.settings.aimAssist;
  as.onchange = () => { profile.settings.aimAssist = as.checked; saveProfile(profile); };
  const fp = $<HTMLInputElement>('set-fps');
  fp.checked = profile.settings.showFps;
  fp.onchange = () => { profile.settings.showFps = fp.checked; saveProfile(profile); };
  const status = $('settings-status');
  status.textContent = '';
  const box = $<HTMLTextAreaElement>('save-code');
  $('btn-export').onclick = async () => {
    box.value = exportCode(profile);
    const ok = await copyText(box.value);
    status.textContent = ok ? 'Code kopiert! Auf dem anderen Gerät unter „Code einfügen“ laden.' : 'Code unten markieren und kopieren.';
  };
  $('btn-import').onclick = () => {
    if (!box.value.trim()) { status.textContent = 'Füge zuerst einen Code in das Feld ein.'; return; }
    const p = importCode(box.value);
    if (!p) { status.textContent = 'Der Code ist ungültig.'; return; }
    if (!confirm(`Spielstand von „${p.name}“ (Level ${level(p)}) laden? Dein aktueller Stand wird ersetzt.`)) return;
    profile = p;
    saveProfile(profile);
    audio.setVolume(profile.settings.volume);
    status.textContent = `Geladen: ${p.name}, Level ${level(p)}.`;
    renderSettingsScreen();
  };
  $('btn-reset').onclick = () => {
    if (!confirm('Wirklich den gesamten Fortschritt löschen?')) return;
    const name = profile.name;
    profile = sanitize({ name });
    saveProfile(profile);
    status.textContent = 'Fortschritt gelöscht.';
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------- solo

function renderSolo() {
  const s = { ...defaultSettings('dm'), ...(profile.solo ?? {}) };
  ui.renderSettingsForm($('solo-settings'), s, true, 1, (ns) => {
    profile.solo = ns;
    saveProfile(profile);
    renderSolo();
  });
}

$('solo-start').onclick = () => {
  audio.unlockAudio();
  const s = { ...defaultSettings('dm'), ...(profile.solo ?? {}) };
  session = newSession('solo', s);
  session.members = [myMember()];
  startLocalMatch();
};

function newSession(kind: Session['kind'], settings: MatchSettings): Session {
  return {
    kind, game: null, settings, myId: kind === 'client' ? '' : 'h0', members: [], code: '', host: null, client: null,
    links: new Map(), ping: null, netT: 0, pingT: 0, ended: false,
  };
}

// ---------------------------------------------------------------- local / host match setup

function startLocalMatch() {
  if (!session) return;
  const s = { ...session.settings };
  const humans = session.members.length;
  const online = session.kind === 'host';
  if (s.mode === 'dm' && s.bots === 0 && humans < 2) {
    ui.toast('Ohne Bots braucht ihr mindestens 2 Spieler.', 3500);
    showLobby();
    return;
  }
  // online free-for-all may be friends only (0 bots); solo needs at least one bot
  if (s.mode === 'dm') s.bots = Math.max(online ? 0 : 1, Math.min(s.bots, MAX_TOTAL - humans));
  if (s.mode === 'team') {
    s.bots = Math.max(1, Math.min(s.bots, MAX_TOTAL - humans));
    s.allies = Math.max(0, Math.min(s.allies, MAX_TOTAL - humans - s.bots));
  }
  const mapId: MapId = s.map === 'random' ? pick(MAP_LIST) : s.map;
  const total = humans + (s.mode === 'dm' ? s.bots : s.mode === 'team' ? s.bots + s.allies : 6);
  const size = s.mapSize === 'small' ? 0 : s.mapSize === 'medium' ? 1 : s.mapSize === 'large' ? 2 : mapSizeFor(total);
  const seed = (Math.random() * 2 ** 31) | 0;
  const g = new Game({ authority: true, settings: s, seed, mapId, size, localId: session.myId });
  const team = s.mode === 'dm' ? -1 : 0;
  for (const m of session.members) g.addPlayer(infoOf(m, team), true);
  g.populateBots();
  g.fx.length = 0;
  session.game = g;
  session.ended = false;
  if (session.kind === 'host') {
    for (const [id, link] of session.links) link.send({ t: 'start', seed, mapId, size, settings: s, you: id, full: g.fullState() });
    broadcastLobby();
  }
  enterMatch(g);
}

function enterMatch(g: Game) {
  fx.reset();
  fx.onEnd = (ev) => onMatchEnd(ev.res);
  renderer.setMap(g.map);
  input.resetState();
  input.enabled = true;
  paused = false;
  ui.show(null);
  document.body.classList.add('in-match');
  audio.sfxUi('start');
  requestWakeLock();
  if (input.touchMode && window.innerHeight > window.innerWidth) ui.toast('Tipp: Dreh dein Handy ins Querformat 🔄', 3500);
}

function exitMatchView() {
  input.enabled = false;
  input.resetState();
  paused = false;
  document.body.classList.remove('in-match');
  releaseWakeLock();
}

function onMatchEnd(res: MatchResult) {
  if (!session || session.ended) return;
  session.ended = true;
  const g = session.game;
  const humans = res.rows.filter((r) => !r.bot).length;
  const rep = computeXp(res, session.myId, g?.settings ?? session.settings, humans);
  const before = profile.xp;
  const row = res.rows.find((r) => r.id === session!.myId);
  profile.xp += rep.total;
  profile.stats.kills += row?.kills ?? 0;
  profile.stats.deaths += row?.deaths ?? 0;
  profile.stats.matches++;
  if (rep.won) profile.stats.wins++;
  profile.stats.bestWave = Math.max(profile.stats.bestWave, res.wave);
  profile.stats.playTime += res.duration;
  saveProfile(profile);
  const after = profile.xp;
  const s = session;
  setTimeout(() => {
    if (session !== s) return;
    exitMatchView();
    audio.sfxUi(rep.won ? 'win' : 'lose');
    if (levelInfo(after).level > levelInfo(before).level) setTimeout(() => audio.sfxUi('level'), 900);
    ui.renderResults(res, s.myId, rep, before, after, {
      again: s.kind !== 'client',
      lobby: s.kind === 'host',
      wait: s.kind === 'client' ? 'Warte auf den Host …' : '',
    });
    ui.show('results');
  }, 2800);
}

$('res-again').onclick = () => {
  if (!session) return;
  audio.unlockAudio();
  startLocalMatch();
};
$('res-lobby').onclick = () => {
  if (!session || session.kind !== 'host') return;
  session.game = null;
  for (const l of session.links.values()) l.send({ t: 'toLobby' });
  broadcastLobby();
  showLobby();
};
$('res-menu').onclick = () => leaveSession();

// ---------------------------------------------------------------- pause

function setPaused(p: boolean) {
  if (!session?.game || session.game.over) return;
  paused = p;
  if (p) {
    $('pause-note').textContent = session.kind === 'solo' ? 'Das Spiel ist pausiert.' : 'Achtung: Online läuft das Spiel weiter!';
    ui.show('pause');
    input.resetState();
  } else ui.show(null);
}
$('pause-resume').onclick = () => setPaused(false);
$('pause-loadout').onclick = () => { returnTo = 'pause'; renderLoadout(); ui.show('loadout'); };
$('pause-help').onclick = () => { returnTo = 'pause'; ui.show('help'); };
$('pause-quit').onclick = () => {
  if (!session) return;
  if (session.kind === 'host' && session.links.size && !confirm('Wenn du als Host gehst, endet das Spiel für alle. Wirklich verlassen?')) return;
  leaveSession();
};

// ---------------------------------------------------------------- online: host

$('btn-host').onclick = async () => {
  audio.unlockAudio();
  const status = $('online-status');
  status.classList.remove('err');
  ui.busy('Erstelle Raum …');
  try {
    const t = await createHost();
    const s = { ...defaultSettings('team'), ...(profile.host ?? {}) };
    session = newSession('host', s);
    session.host = t;
    session.code = t.code;
    session.members = [myMember()];
    t.onJoin = () => { /* wait for hello */ };
    t.onMessage = (l, m) => hostOnMessage(l, m);
    t.onLeave = (l) => hostOnLeave(l);
    ui.busy(null);
    showLobby();
  } catch (e) {
    ui.busy(null);
    status.textContent = (e as Error).message;
    status.classList.add('err');
  }
};

function hostOnMessage(l: Link, m: Msg) {
  const s = session;
  if (!s || s.kind !== 'host') return;
  switch (m.t) {
    case 'hello': {
      if (m.v !== PROTOCOL) { l.send({ t: 'reject', reason: 'Unterschiedliche Spielversion – bitte Seite neu laden.' }); setTimeout(() => l.close(), 500); return; }
      if (s.links.has(l.id)) return;
      if (s.members.length >= MAX_HUMANS) { l.send({ t: 'reject', reason: 'Der Raum ist voll (max. 4 Spieler).' }); setTimeout(() => l.close(), 500); return; }
      const mem = validMember(l.id, m.prof ?? {});
      s.members.push(mem);
      s.links.set(l.id, l);
      l.send({ t: 'welcome', id: l.id, code: s.code });
      const g = s.game;
      if (g && !g.over) {
        // late join into the running match
        g.addPlayer(infoOf(mem, g.settings.mode === 'dm' ? -1 : 0), true);
        l.send({ t: 'start', seed: g.seed, mapId: g.mapId, size: g.size, settings: g.settings, you: l.id, full: g.fullState() });
      }
      broadcastLobby();
      if (!g) ui.toast(`${mem.name} ist beigetreten`);
      break;
    }
    case 'prof': {
      const i = s.members.findIndex((x) => x.id === l.id);
      if (i < 0) return;
      const mem = validMember(l.id, m.prof ?? {});
      s.members[i] = mem;
      s.game?.setLoadout(l.id, mem.primary, mem.perk as PerkId, mem.skin, mem.hat);
      const gp = s.game?.players.get(l.id);
      if (gp) gp.name = mem.name;
      broadcastLobby();
      break;
    }
    case 'i':
      s.game?.applyRemoteInput(l.id, m as never);
      break;
    case 'ping':
      l.send({ t: 'pong', n: m.n });
      break;
    case 'leave':
      hostOnLeave(l);
      l.close();
      break;
  }
}

function hostOnLeave(l: Link) {
  const s = session;
  if (!s || s.kind !== 'host' || !s.links.has(l.id)) return;
  s.links.delete(l.id);
  const mem = s.members.find((x) => x.id === l.id);
  s.members = s.members.filter((x) => x.id !== l.id);
  const g = s.game;
  g?.removePlayer(l.id);
  // a friends-only free-for-all cannot go on alone
  if (g && !g.over && g.settings.mode === 'dm' && !g.list.some((p) => p.bot) && g.list.length < 2) {
    g.emit({ e: 'msg', text: 'Alle Mitspieler sind weg' });
    g.finish();
  }
  broadcastLobby();
  if (mem && !g) ui.toast(`${mem.name} hat den Raum verlassen`);
}

function broadcastLobby() {
  const s = session;
  if (!s || s.kind !== 'host') return;
  const msg = { t: 'lobby', members: s.members, settings: s.settings, code: s.code, playing: !!s.game && !s.game.over };
  for (const l of s.links.values()) l.send(msg);
  if (ui.currentScreen() === 'lobby') renderLobbyScreen();
}

function showLobby() {
  renderLobbyScreen();
  ui.show('lobby');
}

function renderLobbyScreen() {
  const s = session;
  if (!s) return;
  const isHost = s.kind === 'host';
  ui.renderLobby(s.members, s.myId, isHost, s.code);
  ui.renderSettingsForm($('lobby-settings'), s.settings, isHost, s.members.length, (ns) => {
    if (!session) return;
    session.settings = ns;
    profile.host = ns;
    saveProfile(profile);
    broadcastLobby();
    renderLobbyScreen();
  }, true);
  const startBtn = $<HTMLButtonElement>('lobby-start');
  const needFriends = s.settings.mode === 'dm' && s.settings.bots === 0 && s.members.length < 2;
  startBtn.disabled = needFriends;
  startBtn.textContent = needFriends ? 'Warte auf Mitspieler …'
    : s.members.length > 1 ? `Spiel starten (${s.members.length} Spieler)` : 'Spiel starten (allein)';
}

$('lobby-start').onclick = () => {
  if (!session || session.kind !== 'host') return;
  audio.unlockAudio();
  startLocalMatch();
};
$('lobby-leave').onclick = () => {
  if (session?.kind === 'host' && session.links.size && !confirm('Raum schließen? Alle Mitspieler fliegen raus.')) return;
  leaveSession();
};

function inviteUrl(code: string) {
  const u = new URL(location.href);
  u.hash = 'r=' + code;
  return u.toString();
}
$('btn-share').onclick = async () => {
  if (!session) return;
  const url = inviteUrl(session.code);
  const text = `Komm in meinen Kistenkrieg-Raum! Code: ${session.code}`;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share && (input.touchMode || matchMedia('(pointer: coarse)').matches)) {
    try { await nav.share({ title: 'Kistenkrieg', text, url }); return; } catch { /* cancelled */ }
  }
  const ok = await copyText(`${text}\n${url}`);
  ui.toast(ok ? 'Einladungslink kopiert – schick ihn deinen Freunden!' : url, 3500);
};
$('btn-copy').onclick = async () => {
  if (!session) return;
  const ok = await copyText(session.code);
  ui.toast(ok ? `Code ${session.code} kopiert` : session.code);
};

// ---------------------------------------------------------------- online: client

$('btn-join').onclick = () => joinRoom(normCode($<HTMLInputElement>('join-code').value));
$<HTMLInputElement>('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

async function joinRoom(code: string) {
  audio.unlockAudio();
  const status = $('online-status');
  status.classList.remove('err');
  if (code.length < 4) { status.textContent = 'Bitte den 4-stelligen Code eingeben.'; status.classList.add('err'); return; }
  ui.busy(`Verbinde mit Raum ${code} …`);
  try {
    const t = await joinHost(code);
    const s = newSession('client', defaultSettings('team'));
    s.client = t;
    s.code = code;
    session = s;
    let welcomed = false;
    t.onMessage = (m) => clientOnMessage(m, () => { welcomed = true; });
    t.onClose = (reason) => {
      if (session !== s) return;
      leaveSession(reason);
    };
    t.send({ t: 'hello', v: PROTOCOL, prof: profMsg() });
    setTimeout(() => {
      if (session === s && !welcomed) leaveSession('Der Host antwortet nicht.');
    }, 8000);
  } catch (e) {
    ui.busy(null);
    status.textContent = (e as Error).message;
    status.classList.add('err');
  }
}

function clientOnMessage(m: Msg, onWelcome: () => void) {
  const s = session;
  if (!s || s.kind !== 'client') return;
  switch (m.t) {
    case 'welcome':
      s.myId = m.id;
      onWelcome();
      ui.busy(null);
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      if (!s.game) showLobby();
      break;
    case 'reject':
      leaveSession(m.reason);
      break;
    case 'lobby':
      s.members = m.members;
      s.settings = m.settings;
      s.code = m.code;
      if (ui.currentScreen() === 'lobby') renderLobbyScreen();
      break;
    case 'start': {
      const g = new Game({ authority: false, settings: m.settings, seed: m.seed, mapId: m.mapId, size: m.size, localId: m.you });
      g.applyFullState(m.full);
      const me = g.local;
      if (me) { me.primary = profile.primary; me.perk = profile.perk; }
      s.myId = m.you;
      s.game = g;
      s.ended = false;
      enterMatch(g);
      break;
    }
    case 's': {
      const g = s.game;
      if (!g) return;
      if (Array.isArray(m.ev)) for (const ev of m.ev) if (g.applyNetEvent(ev)) g.fx.push(ev);
      g.applySnapshot(m as never, performance.now() / 1000);
      break;
    }
    case 'toLobby':
      s.game = null;
      exitMatchView();
      showLobby();
      break;
    case 'pong':
      s.ping = performance.now() - m.n;
      break;
  }
}

function leaveSession(reason?: string) {
  const s = session;
  session = null;
  if (s) {
    if (s.kind === 'client') { s.client?.send({ t: 'leave' }); setTimeout(() => s.client?.close(), 100); }
    if (s.kind === 'host') s.host?.close();
  }
  ui.busy(null);
  exitMatchView();
  go('menu');
  if (reason) ui.toast(reason, 4000);
}

// ---------------------------------------------------------------- aim assist (touch)

function assist(raw: number | null): number | null {
  const g = session?.game;
  const me = g?.local;
  if (!g || !me || !me.alive) return raw;
  if (raw !== null && !profile.settings.aimAssist) return raw;
  const def = WEAPONS[me.wid];
  let best: { a: number; score: number } | null = null;
  for (const p of g.list) {
    if (p === me || !p.alive || sameTeam(p, me) || !g.visibleTo(me, p)) continue;
    const d = dist(me.x, me.y, p.x, p.y);
    if (d > Math.min(def.range * 0.95, 900)) continue;
    const a = Math.atan2(p.y - me.y, p.x - me.x);
    const off = raw === null ? 0 : Math.abs(angleDiff(raw, a));
    if (raw !== null && off > 0.25) continue;
    if (!g.map.los(me.x, me.y, p.x, p.y)) continue;
    const score = d + off * 700;
    if (!best || score < best.score) best = { a, score };
  }
  if (!best) return raw;
  return raw === null ? best.a : raw + angleDiff(raw, best.a) * 0.55;
}

// ---------------------------------------------------------------- main loop

let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;

function step(dt: number, draw: boolean) {
  const s = session;
  const g = s?.game;
  if (s && g) {
    const me = g.local;
    let inp: PlayerInput | null = null;
    if (input.pauseEdge) { input.pauseEdge = false; if (!g.over) setPaused(!paused); }
    if (me && me.alive && !paused && !g.over && draw) {
      const sp = renderer.toScreen(me.x, me.y);
      inp = input.read(sp.x, sp.y, dt, assist);
    } else if (me && me.alive && !g.over) {
      inp = { ...emptyInput(), aim: me.aim };
    }
    const frozen = paused && s.kind === 'solo';
    if (!frozen) {
      let rem = dt;
      let first = true;
      while (rem > 1e-4) {
        const st = Math.min(rem, 1 / 30);
        g.update(st, inp && !first ? { ...inp, reload: false, next: false, slot: -1 } : inp);
        rem -= st;
        first = false;
      }
    }
    netTick(s, g, dt);
    for (const ev of g.fx) fx.handle(ev, g);
    g.fx.length = 0;
    if (!draw) return;
    fx.listener.x = renderer.cam.x;
    fx.listener.y = renderer.cam.y;
    if (!frozen) fx.update(dt, g);
    renderer.updateCamera(g, dt, input);
    renderer.render(g, fx, {
      input, showScores: input.scoreHeld || input.scoreToggle, ping: s.kind === 'client' ? s.ping : null, fps,
      showFps: profile.settings.showFps, online: s.kind !== 'solo',
    }, frozen ? 0 : dt);
    if (ui.currentScreen()) drawPreviews();
    return;
  }
  if (s && s.kind !== 'solo') netTick(s, null, dt);
  if (!draw) return;
  // menu background: bots fighting
  if (!demo) startDemo();
  const d = demo!;
  d.update(Math.min(dt, 1 / 30), null);
  audio.setMuted(true);
  for (const ev of d.fx) demoFx.handle(ev, d);
  audio.setMuted(false);
  d.fx.length = 0;
  d.net.length = 0;
  demoFx.update(dt, d);
  demoFollowT -= dt;
  let follow = demoFollow ? d.players.get(demoFollow) : undefined;
  if (!follow || !follow.alive || demoFollowT <= 0) {
    const alive = d.list.filter((p) => p.alive);
    follow = alive.length ? pick(alive) : undefined;
    demoFollow = follow?.id ?? null;
    demoFollowT = 9;
  }
  if (follow) renderer.updateCamera(d, dt, input, follow);
  renderer.render(d, demoFx, { input, showScores: false, ping: null, fps, showFps: false, online: false, hud: false }, dt);
  if (d.over || d.time > 240) demo = null;
  drawPreviews();
}

function startDemo() {
  const mapId = pick(MAP_LIST);
  const s: MatchSettings = { ...defaultSettings('dm'), bots: 7, diff: 'normal', killLimit: 9999, timeLimit: 9999, map: mapId };
  demo = new Game({ authority: true, settings: s, seed: (Math.random() * 1e9) | 0, mapId, size: 1, localId: '-' });
  demo.populateBots();
  demoFx.reset();
  demoFollow = null;
}

function netTick(s: Session, g: Game | null, dt: number) {
  s.netT += dt;
  s.pingT += dt;
  if (s.kind === 'host') {
    if (g && s.netT >= 1 / 30) {
      s.netT = 0;
      const ev = g.net.splice(0);
      if (s.links.size) {
        const msg = { t: 's', ...g.snapshot(), ev };
        for (const l of s.links.values()) l.send(msg);
      }
    }
    if (!g && s.pingT > 3) {
      s.pingT = 0;
      for (const l of s.links.values()) l.send({ t: 'hb' });
    }
  } else if (s.kind === 'client') {
    if (g && s.netT >= 1 / 30 && !g.over) {
      s.netT = 0;
      const ci = g.clientInput();
      if (ci) s.client?.send({ t: 'i', ...ci });
    }
    if (s.pingT > 2) {
      s.pingT = 0;
      s.client?.send({ t: 'ping', n: performance.now() });
    }
  }
}

function frame(now: number) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  try {
    step(dt, true);
  } catch (e) {
    console.error(e);
  }
  requestAnimationFrame(frame);
}

// Keep a host's match running (and connections alive) while its tab is in the background.
let bgTimer = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (session?.kind === 'solo' && session.game && !session.game.over) setPaused(true);
    if (session && session.kind !== 'solo') {
      let t = performance.now();
      bgTimer = window.setInterval(() => {
        const n = performance.now();
        step(Math.min(0.25, (n - t) / 1000), false);
        t = n;
      }, 100);
    }
  } else {
    clearInterval(bgTimer);
    last = performance.now();
    if (session?.game) requestWakeLock();
  }
});

async function requestWakeLock() {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl && !wakeLock) {
      wakeLock = await wl.request('screen');
      (wakeLock as unknown as EventTarget).addEventListener?.('release', () => { wakeLock = null; });
    }
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function onResize() {
  renderer.resize();
  input.layout(renderer.W, renderer.H, renderer.safe.l, renderer.safe.r);
  if (session?.game) renderer.setMap(session.game.map);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));

// ---------------------------------------------------------------- boot

function boot() {
  onResize();
  ui.renderMenuProfile(profile);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('ios-hint').hidden = !ios || !!standalone;
  const m = location.hash.match(/r=([A-Za-z0-9]{4,6})/);
  if (m) {
    const code = normCode(m[1]);
    $<HTMLInputElement>('join-code').value = code;
    $('invite-code').textContent = code;
    $('invite-box').hidden = false;
    go('online');
  } else go('menu');
  requestAnimationFrame(frame);
}
boot();

// debug hook for automated tests
(window as unknown as { __kk: unknown }).__kk = { get session() { return session; }, get profile() { return profile; }, input, renderer };
