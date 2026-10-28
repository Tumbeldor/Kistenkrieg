// Tiny synthesized sound engine (no audio files needed).
import { WeaponId } from './config';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
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
      master.connect(comp);
      comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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

function out(vol: number, pan: number): AudioNode {
  const g = ctx!.createGain();
  g.gain.value = vol;
  if ('createStereoPanner' in ctx!) {
    const p = ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(master!);
  } else g.connect(master!);
  return g;
}

function burst(dst: AudioNode, dur: number, f0: number, f1: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0) {
  const c = ctx!;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dst);
  src.start(t, Math.random() * 0.5, dur + 0.05);
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
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dst);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfxShot(w: WeaponId, vol: number, pan: number) {
  if (vol < 0.03 || !allow()) return;
  const o = out(vol, pan);
  switch (w) {
    case 'pistol': burst(o, 0.12, 3200, 600, 1.2, 0.8); tone(o, 'square', 420, 90, 0.06, 0.15); break;
    case 'smg': burst(o, 0.08, 3600, 900, 1.4, 0.6); break;
    case 'rifle': burst(o, 0.13, 2600, 500, 1, 0.8); tone(o, 'sawtooth', 300, 60, 0.07, 0.15); break;
    case 'shotgun': burst(o, 0.32, 1800, 200, 0.7, 1.2); tone(o, 'square', 160, 40, 0.18, 0.3); break;
    case 'sniper': burst(o, 0.45, 2400, 150, 0.6, 1.2); tone(o, 'sawtooth', 900, 40, 0.3, 0.25); break;
    case 'minigun': burst(o, 0.06, 4200, 1200, 1.6, 0.5); break;
    case 'flamer': burst(o, 0.12, 900, 400, 0.5, 0.18, 'lowpass'); break;
    case 'rocket': burst(o, 0.5, 700, 120, 0.6, 0.9, 'lowpass'); tone(o, 'triangle', 220, 80, 0.4, 0.2); break;
    case 'rail': tone(o, 'sawtooth', 2400, 120, 0.35, 0.35); tone(o, 'sine', 1200, 3000, 0.25, 0.25); burst(o, 0.2, 6000, 2000, 2, 0.3); break;
  }
}

export function sfxBoom(vol: number, pan: number) {
  if (vol < 0.03 || !allow()) return;
  const o = out(vol, pan);
  burst(o, 0.9, 900, 40, 0.4, 1.6, 'lowpass');
  tone(o, 'sine', 120, 30, 0.6, 0.8);
}

export function sfxHit(vol: number, pan: number, mine: boolean) {
  if (!allow()) return;
  const o = out(vol, pan);
  if (mine) tone(o, 'square', 1500, 1100, 0.05, 0.12);
  burst(o, 0.07, 1400, 500, 2, 0.4);
}

export function sfxHurt() {
  if (!allow()) return;
  const o = out(0.7, 0);
  tone(o, 'sawtooth', 240, 90, 0.18, 0.25);
  burst(o, 0.1, 800, 300, 1, 0.3);
}

export function sfxKill(mine: boolean) {
  if (!allow()) return;
  const o = out(mine ? 0.6 : 0.25, 0);
  if (mine) {
    tone(o, 'triangle', 880, 880, 0.08, 0.35);
    tone(o, 'triangle', 1320, 1320, 0.14, 0.35, 0.07);
  } else tone(o, 'sine', 300, 120, 0.2, 0.2);
}

export function sfxCrate(vol: number, pan: number) {
  if (vol < 0.03 || !allow()) return;
  const o = out(vol, pan);
  burst(o, 0.35, 900, 150, 0.8, 0.9);
  tone(o, 'square', 140, 60, 0.15, 0.15);
}

export function sfxPickup(kind: string) {
  if (!allow()) return;
  const o = out(0.5, 0);
  if (kind === 'weapon') { tone(o, 'square', 300, 300, 0.06, 0.15); tone(o, 'square', 450, 450, 0.1, 0.15, 0.06); burst(o, 0.15, 2000, 800, 2, 0.3, 'bandpass', 0.03); }
  else if (kind === 'armor') { tone(o, 'triangle', 500, 1000, 0.2, 0.3); }
  else { tone(o, 'sine', 600, 600, 0.08, 0.3); tone(o, 'sine', 900, 900, 0.12, 0.3, 0.08); }
}

export function sfxReload() {
  if (!allow()) return;
  const o = out(0.35, 0);
  burst(o, 0.04, 3000, 2000, 3, 0.4);
  burst(o, 0.05, 2500, 1500, 3, 0.4, 'bandpass', 0.25);
}

export function sfxEmpty() {
  if (!allow()) return;
  tone(out(0.3, 0), 'square', 1800, 1700, 0.03, 0.2);
}

export function sfxUi(kind: 'click' | 'level' | 'wave' | 'start' | 'win' | 'lose') {
  if (!ctx || !master) return;
  const o = out(0.5, 0);
  if (kind === 'click') tone(o, 'sine', 700, 500, 0.06, 0.2);
  else if (kind === 'level') [523, 659, 784, 1046].forEach((f, i) => tone(o, 'triangle', f, f, 0.18, 0.3, i * 0.1));
  else if (kind === 'wave') { tone(o, 'sawtooth', 110, 110, 0.5, 0.2); tone(o, 'sawtooth', 165, 165, 0.5, 0.15, 0.25); }
  else if (kind === 'start') [392, 523, 659].forEach((f, i) => tone(o, 'square', f, f, 0.12, 0.15, i * 0.12));
  else if (kind === 'win') [523, 659, 784, 1046, 1318].forEach((f, i) => tone(o, 'triangle', f, f, 0.2, 0.3, i * 0.12));
  else [392, 330, 262].forEach((f, i) => tone(o, 'triangle', f, f, 0.25, 0.3, i * 0.18));
}
