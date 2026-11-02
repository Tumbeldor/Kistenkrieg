// DOM menus: screens, settings forms, loadout, progress, lobby and results.
import {
  isFfa, GUN_TIERS, DIFFS, DIFF_LIST, HATS, MAP_LIST, MAP_SIZE_LIST, MAPS, MapSizeId, MAX_HUMANS, MAX_TOTAL, MODES, MODE_LIST, MatchSettings, PERKS, SKINS,
  TEAM_NAMES, WEAPONS, WEAPON_LIST, WeaponId, allUnlocks, defaultSettings, levelInfo, xpToNext, MAX_LEVEL,
} from './config';
import type { MatchResult } from './game';
import { Profile, XpReport, level } from './profile';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let current = '';
export function show(name: string | null) {
  current = name ?? '';
  document.querySelectorAll<HTMLElement>('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
}
export const currentScreen = () => current;

let toastTimer = 0;
export function toast(text: string, ms = 2400) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

export function busy(text: string | null) {
  $('busy').hidden = text === null;
  if (text) $('busy-text').textContent = text;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ---------------------------------------------------------------- settings form

/** online=true: friends lobby – "Jeder gegen jeden" can be played with or without bots. */
export function renderSettingsForm(root: HTMLElement, s: MatchSettings, editable: boolean, humans: number, onChange: (s: MatchSettings) => void, online = false) {
  root.innerHTML = '';
  const ffa = isFfa(s.mode);
  const noBots = ffa && s.bots === 0;
  const set = (patch: Partial<MatchSettings>) => onChange({ ...s, ...patch });

  const modeField = el('div', 'field');
  modeField.append(el('span', 'lbl', 'Modus'));
  const cards = el('div', 'mode-cards');
  for (const id of MODE_LIST) {
    const m = MODES[id];
    const desc = online && id === 'dm' ? 'Freie Schlacht – nur unter Freunden oder zusammen mit Bots.' : m.desc;
    const b = el('button', 'mode-card' + (s.mode === id ? ' on' : ''), `<b>${m.name}</b><span>${desc}</span>`);
    b.disabled = !editable;
    b.onclick = () => {
      if (s.mode === id) return;
      const d = defaultSettings(id);
      onChange({ ...d, map: s.map, mapSize: s.mapSize ?? 'auto', diff: s.diff });
    };
    cards.append(b);
  }
  modeField.append(cards);
  root.append(modeField);

  const seg = <T extends string | number>(label: string, opts: { v: T; t: string }[], cur: T, pick: (v: T) => void, parent: HTMLElement = root) => {
    const f = el('div', 'field');
    f.append(el('span', 'lbl', label));
    const g = el('div', 'seg');
    for (const o of opts) {
      const b = el('button', cur === o.v ? 'on' : '', esc(o.t));
      b.disabled = !editable;
      b.onclick = () => pick(o.v);
      g.append(b);
    }
    f.append(g);
    parent.append(f);
  };
  const stepper = (label: string, val: number, min: number, max: number, pick: (v: number) => void, parent: HTMLElement) => {
    const f = el('div', 'field');
    f.append(el('span', 'lbl', label));
    const st = el('div', 'stepper');
    const minus = el('button', '', '−');
    const plus = el('button', '', '+');
    const v = el('span', '', String(val));
    minus.disabled = !editable || val <= min;
    plus.disabled = !editable || val >= max;
    minus.onclick = () => pick(Math.max(min, val - 1));
    plus.onclick = () => pick(Math.min(max, val + 1));
    st.append(minus, v, plus);
    f.append(st);
    parent.append(f);
  };

  const two = el('div', 'two-col');
  root.append(two);
  seg('Karte', [{ v: 'random', t: 'Zufall' }, ...MAP_LIST.map((m) => ({ v: m, t: MAPS[m].name }))], s.map as string, (v) => set({ map: v as MatchSettings['map'] }), two);
  seg('Kartengröße', MAP_SIZE_LIST.map((z) => ({ v: z.id, t: z.name })), (s.mapSize ?? 'auto') as string, (v) => set({ mapSize: v as MapSizeId }), two);
  const room = Math.max(0, MAX_TOTAL - Math.max(humans, 1));
  if (online && ffa) {
    seg('Gegner', [{ v: 0, t: 'Nur Freunde' }, { v: 1, t: 'Mit Bots' }], noBots ? 0 : 1,
      (v) => set({ bots: v === 0 ? 0 : Math.max(1, Math.min(4, room)) }), two);
  }
  if (!noBots) seg('Schwierigkeit (Bots)', DIFF_LIST.map((d) => ({ v: d, t: DIFFS[d].name })), s.diff as string, (v) => set({ diff: v as MatchSettings['diff'] }), two);
  if (ffa) {
    if (noBots) two.append(el('p', 'muted', humans < 2 ? 'Nur ihr, ohne Bots. Es fehlen noch Mitspieler (mindestens 2).' : `Nur ihr ${humans}, ohne Bots.`));
    else stepper('Bots', s.bots, 1, Math.min(9, room), (v) => set({ bots: v }), two);
    if (s.mode === 'dm') seg('Kill-Limit', [10, 15, 20, 30].map((v) => ({ v, t: String(v) })), s.killLimit, (v) => set({ killLimit: v }), two);
    else two.append(el('p', 'muted', 'Waffenfolge: ' + GUN_TIERS.map((w) => WEAPONS[w].name).join(' → ')));
    seg('Zeitlimit', [180, 300, 480, 600].map((v) => ({ v, t: v / 60 + ' min' })), s.timeLimit, (v) => set({ timeLimit: v }), two);
  } else if (s.mode === 'team') {
    stepper('Gegner-Bots (Team Rot)', s.bots, 1, Math.min(8, room - s.allies), (v) => set({ bots: v }), two);
    stepper('Verbündete Bots (euer Team)', s.allies, 0, Math.min(MAX_HUMANS, room - s.bots), (v) => set({ allies: v }), two);
    seg('Team-Kill-Limit', [20, 30, 40, 50].map((v) => ({ v, t: String(v) })), s.killLimit, (v) => set({ killLimit: v }), two);
    seg('Zeitlimit', [300, 420, 600].map((v) => ({ v, t: v / 60 + ' min' })), s.timeLimit, (v) => set({ timeLimit: v }), two);
  } else {
    const info = el('p', 'muted', 'Endlose Wellen – mit jeder Welle kommen mehr und stärkere Bots. Wer fällt, steigt nach der Welle wieder ein. Ihr verliert, wenn alle gleichzeitig ausgeschaltet sind.');
    two.append(info);
  }
}

// ---------------------------------------------------------------- menu profile

export function nextUnlockText(p: Profile): string {
  const lv = level(p);
  const next = allUnlocks().filter((u) => u.level > lv);
  if (!next.length) return 'Alles freigeschaltet.';
  const n = next[0].level;
  const items = next.filter((u) => u.level === n).map((u) => `${u.kind} <b>${esc(u.name)}</b>`);
  return `Nächste Freischaltung bei Lv ${n}: ${items.join(', ')}`;
}

export function renderMenuProfile(p: Profile) {
  const li = levelInfo(p.xp);
  $('menu-level').textContent = `Lv ${li.level}`;
  $('menu-xp').textContent = li.level >= MAX_LEVEL ? `${p.xp.toLocaleString('de-DE')} XP · Max-Level` : `${li.into.toLocaleString('de-DE')} / ${li.need.toLocaleString('de-DE')} XP`;
  $('menu-xpfill').style.width = li.level >= MAX_LEVEL ? '100%' : `${(li.into / li.need) * 100}%`;
  $('menu-next').innerHTML = nextUnlockText(p);
  const inp = $<HTMLInputElement>('name-input');
  if (document.activeElement !== inp) inp.value = p.name;
}

// ---------------------------------------------------------------- loadout

export function renderLoadout(p: Profile, onChange: () => void, drawGun: (c: HTMLCanvasElement, w: WeaponId) => void,
  drawHat: (c: HTMLCanvasElement, hat: string, skin: string) => void, drawCamo: (c: HTMLCanvasElement, skin: string) => void) {
  const lv = level(p);
  const lockTag = (need: number) => (need > lv ? `<span class="lock">Lv ${need}</span>` : '');
  // weapons
  const wg = $('lo-weapons');
  wg.innerHTML = '';
  const maxDmg = 100;
  for (const id of WEAPON_LIST) {
    if (id === 'pistol') continue;
    const d = WEAPONS[id];
    const locked = d.unlock > lv;
    const b = el('button', 'item' + (p.primary === id ? ' on' : '') + (locked ? ' locked' : ''));
    const c = el('canvas');
    c.width = 120; c.height = 34; c.style.width = '120px'; c.style.height = '34px';
    b.append(c);
    const dmg = Math.min(1, (d.dmg * d.pellets) / maxDmg);
    const rate = Math.min(1, Math.log(1 + d.rate) / Math.log(26));
    const range = Math.min(1, d.range / 2000);
    b.insertAdjacentHTML('beforeend', `${lockTag(d.unlock)}<b>${d.name}</b><div class="desc">${d.desc}</div>
      <div class="bars"><span>Schaden</span><i style="--v:${dmg * 100}%"></i><span>Tempo</span><i style="--v:${rate * 100}%"></i><span>Reichweite</span><i style="--v:${range * 100}%"></i></div>`);
    b.onclick = () => {
      if (locked) return;
      p.primary = id;
      onChange();
    };
    wg.append(b);
    drawGun(c, id);
  }
  // perks
  const pg = $('lo-perks');
  pg.innerHTML = '';
  for (const k of PERKS) {
    const locked = k.unlock > lv;
    const b = el('button', 'item' + (p.perk === k.id ? ' on' : '') + (locked ? ' locked' : ''), `${lockTag(k.unlock)}<b>${k.name}</b><div class="desc">${k.desc}</div>`);
    b.onclick = () => { if (!locked) { p.perk = k.id; onChange(); } };
    pg.append(b);
  }
  // skins
  const sg = $('lo-skins');
  sg.innerHTML = '';
  for (const s of SKINS) {
    const locked = s.unlock > lv;
    const b = el('button', 'item swatch' + (p.skin === s.id ? ' on' : '') + (locked ? ' locked' : ''));
    const c = el('canvas', 'camo');
    c.width = 120; c.height = 72;
    b.append(c);
    b.insertAdjacentHTML('beforeend', `${lockTag(s.unlock)}<span>${s.name}</span>`);
    drawCamo(c, s.id);
    b.onclick = () => { if (!locked) { p.skin = s.id; onChange(); } };
    sg.append(b);
  }
  // hats
  const hg = $('lo-hats');
  hg.innerHTML = '';
  for (const h of HATS) {
    const locked = h.unlock > lv;
    const b = el('button', 'item hat-item' + (p.hat === h.id ? ' on' : '') + (locked ? ' locked' : ''));
    const c = el('canvas');
    c.width = 104; c.height = 104; c.style.width = '52px'; c.style.height = '52px';
    b.append(c);
    b.insertAdjacentHTML('beforeend', `${lockTag(h.unlock)}${h.name}`);
    b.onclick = () => { if (!locked) { p.hat = h.id; onChange(); } };
    hg.append(b);
    drawHat(c, h.id, p.skin);
  }
}

// ---------------------------------------------------------------- progress

export function renderProgress(p: Profile) {
  const li = levelInfo(p.xp);
  $('pr-level').textContent = String(li.level);
  $('pr-xp').textContent = li.level >= MAX_LEVEL ? `Max-Level erreicht · ${p.xp.toLocaleString('de-DE')} XP gesamt` : `Level ${li.level} → ${li.level + 1}: ${li.into.toLocaleString('de-DE')} / ${li.need.toLocaleString('de-DE')} XP`;
  $('pr-xpfill').style.width = li.level >= MAX_LEVEL ? '100%' : `${(li.into / li.need) * 100}%`;
  const st = p.stats;
  const kd = st.deaths ? (st.kills / st.deaths).toFixed(2) : st.kills.toFixed(0);
  const mins = Math.round(st.playTime / 60);
  $('pr-stats').innerHTML = [
    ['Eliminierungen', st.kills], ['Tode', st.deaths], ['K/D', kd], ['Matches', st.matches], ['Siege', st.wins],
    ['Beste Welle', st.bestWave], ['Spielzeit', mins + ' min'], ['Gesamt-XP', p.xp.toLocaleString('de-DE')],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  const rm = $('pr-roadmap');
  rm.innerHTML = allUnlocks()
    .map((u) => `<div class="road${u.level <= li.level ? ' done' : ''}"><span class="lv">${u.level <= li.level ? '✓' : 'Lv ' + u.level}</span><span><span class="kind">${u.kind}</span>${esc(u.name)}</span></div>`)
    .join('');
}

// ---------------------------------------------------------------- lobby

export interface LobbyMember { id: string; name: string; level: number; skin: string; hat: string; primary: WeaponId; perk: string; host: boolean }

export function renderLobby(members: LobbyMember[], myId: string, isHost: boolean, code: string) {
  $('lobby-code').textContent = code;
  $('lobby-count').textContent = `(${members.length}/${MAX_HUMANS})`;
  const ul = $('lobby-members');
  ul.innerHTML = '';
  for (const m of members) {
    const li = el('li');
    const dotBg = SKINS.find((s) => s.id === m.skin)?.color ?? '#888';
    li.innerHTML = `<span class="dot" style="background:${dotBg}"></span><span class="nm">${esc(m.name)}${m.id === myId ? ' (du)' : ''}</span>
      <span class="tag">Lv ${m.level} · ${WEAPONS[m.primary]?.name ?? ''}</span>${m.host ? '<span class="host">HOST</span>' : ''}`;
    ul.append(li);
  }
  $('lobby-start').hidden = !isHost;
  $('lobby-wait').hidden = isHost;
}

// ---------------------------------------------------------------- results

export function renderResults(res: MatchResult, myId: string, rep: XpReport | null, before: number, after: number, opts: { again: boolean; lobby: boolean; wait: string }) {
  const title = $('res-title');
  const row = res.rows.find((r) => r.id === myId);
  let t = 'Match vorbei';
  let cls = '';
  if (res.mode === 'dm' || res.mode === 'gungame') {
    if (row?.place === 1) { t = 'Sieg'; cls = 'win'; } else { t = `Platz ${row?.place ?? '-'}`; cls = row && row.place <= 3 ? '' : 'lose'; }
  } else if (res.mode === 'team') {
    if (res.winnerTeam === 0) { t = 'Teamsieg'; cls = 'win'; } else if (res.winnerTeam === null) t = 'Unentschieden'; else { t = 'Niederlage'; cls = 'lose'; }
  } else {
    t = `${res.wave} ${res.wave === 1 ? 'Welle' : 'Wellen'} überlebt`;
    cls = res.wave >= 5 ? 'win' : '';
  }
  title.textContent = t;
  title.className = 'result-title ' + cls;
  $('res-sub').textContent = `Dauer ${Math.floor(res.duration / 60)}:${String(res.duration % 60).padStart(2, '0')} min`;

  const tbl = $('res-table');
  const rows = [...res.rows].sort((a, b) => a.place - b.place);
  const rv = res.mode === 'survival' && rows.length > 1; // revives only exist with team mates
  tbl.innerHTML = `<tr><th>#</th><th>Spieler</th><th>Kills</th><th>Tode</th>${rv ? '<th>Rettungen</th>' : ''}<th>Punkte</th></tr>` + rows.map((r) => {
    const tc = r.team === 0 ? 't0' : r.team === 1 ? 't1' : '';
    return `<tr class="${r.id === myId ? 'me' : ''}"><td>${r.place}</td><td class="${tc}">${esc(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td>${rv ? `<td>${r.rv ?? 0}</td>` : ''}<td>${r.score}</td></tr>`;
  }).join('');
  if (res.mode === 'team') tbl.insertAdjacentHTML('afterbegin', `<caption class="muted">${TEAM_NAMES[0]} vs ${TEAM_NAMES[1]}</caption>`);

  // xp lines (animated)
  const ul = $('res-xp');
  ul.innerHTML = '';
  const lines = rep ? [...rep.lines.map((l) => ({ ...l, total: false })), { label: 'Gesamt', xp: rep.total, total: true }] : [];
  lines.forEach((l, i) => {
    const li = el('li', l.total ? 'total' : '', `<span>${esc(l.label)}</span><b>+${l.xp}</b>`);
    ul.append(li);
    setTimeout(() => li.classList.add('show'), 200 + i * 180);
  });
  const li0 = levelInfo(before);
  const li1 = levelInfo(after);
  const setBar = (xp: number) => {
    const li = levelInfo(xp);
    $('res-level').textContent = `Lv ${li.level}`;
    $('res-xptext').textContent = li.level >= MAX_LEVEL ? 'Max-Level' : `${li.into} / ${li.need} XP`;
    $('res-xpfill').style.width = li.level >= MAX_LEVEL ? '100%' : `${(li.into / li.need) * 100}%`;
  };
  setBar(before);
  setTimeout(() => setBar(after), 300 + lines.length * 180);
  const banner = $('res-unlocks');
  banner.hidden = true;
  if (li1.level > li0.level) {
    const unl = allUnlocks().filter((u) => u.level > li0.level && u.level <= li1.level);
    setTimeout(() => {
      banner.hidden = false;
      banner.innerHTML = `<b>LEVEL ${li1.level}!</b><br>` + (unl.length ? 'Neu freigeschaltet: ' + unl.map((u) => `${u.kind} <b>${esc(u.name)}</b>`).join(', ') : 'Weiter so!');
    }, 500 + lines.length * 180);
  }
  $('res-again').hidden = !opts.again;
  $('res-lobby').hidden = !opts.lobby;
  $('res-wait').textContent = opts.wait;
}

export { xpToNext };
