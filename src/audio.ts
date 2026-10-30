// Synthesized sound engine (no audio files needed).
// Gunshots are layered like real recordings: sharp muzzle crack + mid-range body + low thump + decaying tail,
// sent through a shared reverb. Distant shots are darker and wetter.
import { WeaponId } from './config';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let verbIn: GainNode | null = null;
let volume = 0.7;
let budget = 0;
let budgetT = 0;
let muted = false;

/** Temporarily silence effects (menu background demo). */
export function setMuted(m: boolean) {
  muted = m;
}

export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.value = v;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function impulse(c: AudioContext, dur: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Must be called from a user gesture (iOS). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      master.connect(comp);
      comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // shared reverb (open field / hall tail)
      verbIn = ctx.createGain();
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.7, 2.6);
      const wetOut = ctx.createGain();
      wetOut.gain.value = 0.55;
      verbIn.connect(conv);
      conv.connect(wetOut);
      wetOut.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    // play a silent buffer to fully unlock on iOS
    const b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, 22050);
    b.connect(ctx.destination);
    b.start(0);
  } catch {
    /* audio unavailable */
  }
}

function allow(): boolean {
  if (muted || !ctx || !master || ctx.state !== 'running' || volume <= 0) return false;
  const now = ctx.currentTime;
  if (now - budgetT > 0.05) { budgetT = now; budget = 0; }
  return budget++ < 6;
}

/** Output bus: volume, stereo position, reverb send (wet) and distance darkening (far 0..1). */
function bus(vol: number, pan = 0, wet = 0, far = 0): GainNode {
  const c = ctx!;
  const input = c.createGain();
  input.gain.value = vol;
  let node: AudioNode = input;
  if (far > 0.05) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + 14000 * Math.pow(1 - Math.min(1, far), 2);
    input.connect(lp);
    node = lp;
  }
  let end: AudioNode = node;
  if ('createStereoPanner' in c) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    end = p;
  }
  end.connect(master!);
  if (wet > 0 && verbIn) {
    const s = c.createGain();
    s.gain.value = wet * (1 + far * 0.9);
    node.connect(s);
    s.connect(verbIn);
  }
  return input;
}

function burst(dst: AudioNode, dur: number, f0: number, f1: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0) {
  const c = ctx!;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = rnd(0.85, 1.15);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dst);
  src.start(t, Math.random() * 0.8, dur * 1.2 + 0.05);
}

function tone(dst: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  const c = ctx!;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dst);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// mechanical one-shots used by reload / dry-fire sounds
const click = (o: AudioNode, delay: number, f = 2800, vol = 0.35) => {
  burst(o, 0.025, f, f * 0.55, 4, vol, 'bandpass', delay);
  tone(o, 'square', f * 0.45, f * 0.25, 0.015, vol * 0.2, delay);
};
const clack = (o: AudioNode, delay: number, vol = 0.5) => {
  burst(o, 0.06, 1600, 650, 2.5, vol, 'bandpass', delay);
  tone(o, 'triangle', 420, 190, 0.05, vol * 0.3, delay);
};
const thunk = (o: AudioNode, delay: number, vol = 0.6) => {
  tone(o, 'sine', 170, 62, 0.09, vol, delay);
  burst(o, 0.07, 950, 300, 1, vol * 0.5, 'lowpass', delay);
};

export function sfxShot(w: WeaponId, vol: number, pan: number, far = 0) {
  if (vol < 0.03 || !allow()) return;
  const v = rnd(0.94, 1.06); // slight variation so repeated shots do not sound identical
  switch (w) {
    case 'pistol': {
      const o = bus(vol, pan, 0.22, far);
      burst(o, 0.045, 2300 * v, 1500, 0.7, 0.95, 'highpass');
      burst(o, 0.13, 1150 * v, 320, 0.9, 0.7);
      tone(o, 'sine', 195 * v, 70, 0.09, 0.55);
      burst(o, 0.3, 750, 200, 0.5, 0.12, 'lowpass', 0.012);
      break;
    }
    case 'smg': {
      const o = bus(vol * 0.9, pan, 0.1, far);
      burst(o, 0.032, 3200 * v, 2000, 0.7, 0.85, 'highpass');
      burst(o, 0.075, 1700 * v, 600, 1, 0.6);
      tone(o, 'sine', 250 * v, 120, 0.05, 0.4);
      break;
    }
    case 'rifle': {
      const o = bus(vol, pan, 0.38, far);
      burst(o, 0.06, 1900 * v, 1100, 0.7, 1.0, 'highpass');
      burst(o, 0.02, 5500, 3500, 1, 0.35, 'highpass');
      burst(o, 0.22, 850 * v, 220, 0.8, 0.85);
      tone(o, 'sine', 135 * v, 45, 0.16, 0.75);
      burst(o, 0.6, 550, 140, 0.5, 0.22, 'lowpass', 0.02);
      break;
    }
    case 'shotgun': {
      const o = bus(vol, pan, 0.5, far);
      burst(o, 0.08, 1000 * v, 500, 0.6, 1.0, 'highpass');
      burst(o, 0.38, 1700 * v, 110, 0.7, 1.25, 'lowpass');
      tone(o, 'sine', 100 * v, 32, 0.32, 1.05);
      burst(o, 0.85, 480, 120, 0.5, 0.3, 'lowpass', 0.03);
      if (vol > 0.25) {
        // pump action
        clack(o, 0.42, 0.28);
        burst(o, 0.1, 1800, 900, 2, 0.12, 'bandpass', 0.46);
        clack(o, 0.58, 0.32);
      }
      break;
    }
    case 'sniper': {
      const o = bus(vol, pan, 0.75, far);
      burst(o, 0.1, 1500 * v, 700, 0.6, 1.2, 'highpass');
      burst(o, 0.03, 6500, 4000, 1, 0.55, 'highpass');
      burst(o, 0.7, 2100 * v, 70, 0.6, 1.3, 'lowpass');
      tone(o, 'sine', 78 * v, 28, 0.55, 1.15);
      burst(o, 1.3, 420, 90, 0.5, 0.36, 'lowpass', 0.04);
      if (vol > 0.25) {
        // bolt action
        clack(o, 0.55, 0.3);
        click(o, 0.64, 2400, 0.2);
        clack(o, 0.82, 0.34);
      }
      break;
    }
    case 'minigun': {
      const o = bus(vol * 0.8, pan, 0.12, far);
      burst(o, 0.032, 2100 * v, 1300, 0.7, 0.75, 'highpass');
      burst(o, 0.085, 950 * v, 300, 0.9, 0.6);
      tone(o, 'sine', 155 * v, 70, 0.06, 0.5);
      break;
    }
    case 'flamer': {
      const o = bus(vol * 0.55, pan, 0.15, far);
      burst(o, 0.17, 950 * v, 350, 0.5, 0.55, 'lowpass');
      burst(o, 0.12, 2600, 800, 0.4, 0.17, 'bandpass');
      tone(o, 'sine', 62, 48, 0.13, 0.28);
      break;
    }
    case 'rocket': {
      const o = bus(vol, pan, 0.55, far);
      burst(o, 0.06, 1500, 700, 0.8, 0.6, 'highpass');
      tone(o, 'sine', 115 * v, 40, 0.38, 1.0);
      burst(o, 0.28, 300, 1800, 0.8, 0.7, 'bandpass');
      burst(o, 0.8, 1800, 200, 0.8, 0.6, 'bandpass', 0.14);
      break;
    }
    case 'rail': {
      const o = bus(vol, pan, 0.5, far);
      tone(o, 'sawtooth', 2800 * v, 180, 0.3, 0.28);
      tone(o, 'sine', 900, 3200, 0.18, 0.22);
      burst(o, 0.26, 6500, 2500, 2, 0.25, 'highpass');
      tone(o, 'sine', 105, 36, 0.38, 0.9);
      burst(o, 0.5, 900, 150, 0.6, 0.35, 'lowpass', 0.02);
      break;
    }
    case 'revolver': {
      const o = bus(vol, pan, 0.35, far);
      burst(o, 0.05, 2000 * v, 1200, 0.7, 1.05, 'highpass');
      burst(o, 0.2, 900 * v, 220, 0.8, 0.9);
      tone(o, 'sine', 120 * v, 42, 0.18, 0.85);
      burst(o, 0.55, 600, 150, 0.5, 0.22, 'lowpass', 0.02);
      break;
    }
    case 'smgsil': {
      // suppressed: dull thump, action clack, almost no crack
      const o = bus(vol * 0.55, pan, 0.03, far);
      burst(o, 0.05, 700 * v, 250, 0.8, 0.6, 'lowpass');
      tone(o, 'sine', 210 * v, 90, 0.04, 0.3);
      burst(o, 0.02, 3200, 2200, 3, 0.18, 'bandpass', 0.012);
      break;
    }
    case 'crossbow': {
      const o = bus(vol * 0.7, pan, 0.05, far);
      tone(o, 'triangle', 190 * v, 110, 0.16, 0.35);
      tone(o, 'sine', 95, 70, 0.12, 0.3);
      burst(o, 0.09, 2600, 900, 1.5, 0.3, 'bandpass');
      break;
    }
    case 'dmr': {
      const o = bus(vol, pan, 0.5, far);
      burst(o, 0.07, 1800 * v, 1000, 0.7, 1.1, 'highpass');
      burst(o, 0.025, 6000, 3800, 1, 0.45, 'highpass');
      burst(o, 0.4, 1200 * v, 140, 0.7, 1.0, 'lowpass');
      tone(o, 'sine', 105 * v, 36, 0.3, 0.95);
      burst(o, 0.9, 480, 120, 0.5, 0.28, 'lowpass', 0.03);
      break;
    }
    case 'lmg': {
      const o = bus(vol * 0.95, pan, 0.3, far);
      burst(o, 0.05, 1800 * v, 1000, 0.7, 0.95, 'highpass');
      burst(o, 0.16, 800 * v, 220, 0.8, 0.8);
      tone(o, 'sine', 125 * v, 45, 0.12, 0.75);
      break;
    }
    case 'autoshotgun': {
      const o = bus(vol, pan, 0.4, far);
      burst(o, 0.07, 1100 * v, 550, 0.6, 0.95, 'highpass');
      burst(o, 0.3, 1600 * v, 120, 0.7, 1.1, 'lowpass');
      tone(o, 'sine', 108 * v, 34, 0.24, 0.95);
      break;
    }
    case 'gl': {
      // "thoomp" of a grenade launcher
      const o = bus(vol * 0.9, pan, 0.25, far);
      tone(o, 'sine', 150 * v, 55, 0.2, 1.0);
      burst(o, 0.14, 600, 200, 0.8, 0.55, 'lowpass');
      burst(o, 0.04, 2400, 1500, 2, 0.15, 'bandpass', 0.02);
      break;
    }
    case 'grenade': {
      // pin + throw swoosh
      const o = bus(vol * 0.6, pan, 0.05, far);
      burst(o, 0.03, 3200, 2400, 3, 0.25, 'bandpass');
      burst(o, 0.22, 500, 1600, 0.8, 0.25, 'bandpass', 0.05);
      break;
    }
  }
}

export function sfxBoom(vol: number, pan: number, far = 0) {
  if (vol < 0.03 || !allow()) return;
  const o = bus(vol, pan, 0.8, far);
  burst(o, 0.12, 800, 400, 0.6, 1.0, 'highpass');
  burst(o, 1.3, 1500, 50, 0.5, 1.6, 'lowpass');
  tone(o, 'sine', 88, 26, 0.95, 1.1);
  burst(o, 1.5, 220, 60, 0.5, 0.4, 'lowpass', 0.1);
  for (let i = 0; i < 6; i++) burst(o, rnd(0.04, 0.1), rnd(900, 2500), 400, 2, rnd(0.08, 0.2), 'bandpass', rnd(0.12, 1.0));
}

export function sfxHit(vol: number, pan: number, mine: boolean) {
  if (!allow()) return;
  const o = bus(vol, pan);
  if (mine) tone(o, 'square', 1500, 1100, 0.045, 0.1);
  tone(o, 'sine', 150, 70, 0.07, 0.35);
  burst(o, 0.07, 1400, 500, 2, 0.35);
}

export function sfxHurt() {
  if (!allow()) return;
  const o = bus(0.7, 0);
  tone(o, 'sawtooth', 230, 90, 0.18, 0.2);
  tone(o, 'sine', 120, 55, 0.14, 0.4);
  burst(o, 0.1, 800, 300, 1, 0.3);
}

export function sfxKill(mine: boolean) {
  if (!allow()) return;
  const o = bus(mine ? 0.55 : 0.22, 0);
  if (mine) {
    tone(o, 'triangle', 880, 880, 0.08, 0.3);
    tone(o, 'triangle', 1320, 1320, 0.14, 0.3, 0.07);
  } else tone(o, 'sine', 300, 120, 0.2, 0.2);
}

export function sfxCrate(vol: number, pan: number, far = 0) {
  if (vol < 0.03 || !allow()) return;
  const o = bus(vol, pan, 0.15, far);
  burst(o, 0.3, 1100, 220, 0.8, 0.9);
  tone(o, 'square', 140, 55, 0.14, 0.15);
  for (let i = 0; i < 4; i++) burst(o, 0.04, rnd(1500, 3000), 800, 3, rnd(0.1, 0.25), 'bandpass', rnd(0.03, 0.3));
}

export function sfxPickup(kind: string) {
  if (!allow()) return;
  const o = bus(0.5, 0);
  if (kind === 'weapon') { clack(o, 0, 0.4); clack(o, 0.09, 0.35); }
  else if (kind === 'armor') { thunk(o, 0, 0.5); burst(o, 0.12, 2000, 600, 1, 0.2, 'bandpass', 0.03); }
  else { tone(o, 'sine', 600, 600, 0.08, 0.28); tone(o, 'sine', 900, 900, 0.12, 0.28, 0.08); }
}

/** Weapon-specific reload; `dur` is the reload time so the clicks line up with the reload ring. */
export function sfxReload(w: WeaponId = 'rifle', dur = 1.5) {
  if (!allow()) return;
  const o = bus(0.55, 0, 0.06);
  const at = (f: number) => f * dur;
  switch (w) {
    case 'pistol':
      click(o, 0.02);
      burst(o, 0.12, 1200, 500, 1, 0.1, 'bandpass', 0.08);
      thunk(o, at(0.5), 0.5);
      clack(o, at(0.82), 0.4);
      click(o, at(0.9), 3500, 0.2);
      break;
    case 'smg':
      click(o, 0.02);
      burst(o, 0.12, 1300, 500, 1, 0.1, 'bandpass', 0.08);
      thunk(o, at(0.5), 0.5);
      clack(o, at(0.8), 0.4);
      click(o, at(0.88), 3000, 0.25);
      break;
    case 'rifle':
      click(o, 0.02);
      burst(o, 0.15, 1000, 400, 1, 0.12, 'bandpass', 0.1);
      thunk(o, at(0.5), 0.6);
      clack(o, at(0.78), 0.45);
      clack(o, at(0.86), 0.5);
      break;
    case 'shotgun':
      for (let i = 0; i < 4; i++) {
        click(o, at(0.08 + i * 0.17), rnd(1900, 2400), 0.5);
        tone(o, 'triangle', 700, 400, 0.05, 0.14, at(0.08 + i * 0.17));
        thunk(o, at(0.1 + i * 0.17), 0.18);
      }
      clack(o, at(0.86), 0.45);
      clack(o, at(0.94), 0.5);
      break;
    case 'sniper':
      clack(o, at(0.1), 0.4);
      burst(o, 0.15, 1000, 450, 1, 0.1, 'bandpass', at(0.2));
      thunk(o, at(0.5), 0.55);
      clack(o, at(0.78), 0.45);
      click(o, at(0.9), 2500, 0.25);
      break;
    case 'minigun':
      for (let i = 0; i < 7; i++) click(o, at(0.08 + i * 0.055), rnd(1500, 2100), 0.25);
      thunk(o, at(0.55), 0.9);
      clack(o, at(0.86), 0.55);
      break;
    case 'flamer':
      burst(o, 0.4, 3000, 1000, 0.8, 0.22, 'bandpass', 0.02);
      thunk(o, at(0.45), 0.6);
      click(o, at(0.85), 2200, 0.3);
      break;
    case 'rocket':
      clack(o, at(0.15), 0.55);
      burst(o, 0.3, 650, 300, 1, 0.3, 'bandpass', at(0.28));
      thunk(o, at(0.62), 0.9);
      clack(o, at(0.88), 0.55);
      break;
    case 'revolver':
      clack(o, 0.03, 0.35);
      for (let i = 0; i < 6; i++) click(o, at(0.25 + i * 0.07), rnd(2600, 3200), 0.25);
      clack(o, at(0.88), 0.45);
      break;
    case 'crossbow':
      burst(o, at(0.6), 1200, 400, 1.5, 0.18, 'bandpass', 0.05);
      tone(o, 'triangle', 160, 260, at(0.6), 0.08, 0.05);
      clack(o, at(0.75), 0.5);
      click(o, at(0.9), 2600, 0.3);
      break;
    case 'gl':
      clack(o, 0.05, 0.5);
      for (let i = 0; i < 6; i++) thunk(o, at(0.18 + i * 0.1), 0.35);
      clack(o, at(0.9), 0.55);
      break;
    case 'smgsil':
    case 'dmr':
    case 'lmg':
    case 'autoshotgun':
      click(o, 0.02);
      burst(o, 0.15, 1000, 400, 1, 0.12, 'bandpass', 0.1);
      thunk(o, at(0.5), w === 'lmg' ? 0.8 : 0.6);
      clack(o, at(0.8), 0.5);
      if (w === 'lmg') clack(o, at(0.9), 0.5);
      break;
    case 'rail':
      tone(o, 'sine', 280, 1900, dur * 0.85, 0.14);
      tone(o, 'triangle', 140, 950, dur * 0.85, 0.08);
      click(o, at(0.92), 3600, 0.3);
      break;
  }
}

export function sfxEmpty() {
  if (!allow()) return;
  const o = bus(0.7, 0);
  click(o, 0, 2300, 0.7);
  tone(o, 'triangle', 600, 300, 0.03, 0.12);
}

export function sfxUi(kind: 'click' | 'level' | 'wave' | 'start' | 'win' | 'lose') {
  if (!ctx || !master) return;
  const o = bus(0.5, 0);
  if (kind === 'click') tone(o, 'sine', 700, 500, 0.06, 0.2);
  else if (kind === 'level') [523, 659, 784, 1046].forEach((f, i) => tone(o, 'triangle', f, f, 0.18, 0.3, i * 0.1));
  else if (kind === 'wave') { tone(o, 'sawtooth', 110, 110, 0.5, 0.2); tone(o, 'sawtooth', 165, 165, 0.5, 0.15, 0.25); }
  else if (kind === 'start') [392, 523, 659].forEach((f, i) => tone(o, 'square', f, f, 0.12, 0.15, i * 0.12));
  else if (kind === 'win') [523, 659, 784, 1046, 1318].forEach((f, i) => tone(o, 'triangle', f, f, 0.2, 0.3, i * 0.12));
  else [392, 330, 262].forEach((f, i) => tone(o, 'triangle', f, f, 0.25, 0.3, i * 0.18));
}
