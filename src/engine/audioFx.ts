/**
 * Per-clip audio effect chain, shared by the live preview (AudioContext) and the
 * export mixer (OfflineAudioContext) so what you hear is what you export.
 *
 * source -> wobble(delay LFO) -> low/mid/high EQ -> warmth shelves -> drive(waveshaper)
 *        -> muffle(lowpass) -> compressor -> limiter -> gain -> pan -> out
 *                                  \-> echo \-> reverb   (sends into pan)
 *        vinyl noise -> vinylGain -> pan
 */
import type { AudioProcessing } from '../core';

export interface FxChain {
  input: GainNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  /** Apply processing values. `tc` is the smoothing time constant (0 = immediate). */
  apply(p: AudioProcessing, tc: number): void;
  start(when?: number): void;
  stop(when?: number): void;
  dispose(): void;
}

const clamp01 = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0));

export function createImpulse(context: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const length = Math.max(1, Math.round(context.sampleRate * duration));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  let seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = rand() * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

/** Looping vinyl bed: low hiss plus randomly timed pops and crackle. Deterministic. */
export function createVinylBuffer(context: BaseAudioContext, seconds = 5): AudioBuffer {
  const sr = context.sampleRate;
  const length = Math.round(sr * seconds);
  const buffer = context.createBuffer(2, length, sr);
  let seed = 0x1234abcd;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i += 1) {
      lp += ((rand() * 2 - 1) - lp) * 0.35; // softened hiss
      d[i] = lp * 0.03;
      if (rand() < 0.00016) { const amp = Math.pow(rand(), 2) * 0.55 + 0.05; const sign = rand() < 0.5 ? -1 : 1; for (let k = 0; k < 28 && i + k < length; k += 1) d[i + k] = (d[i + k] ?? 0) + sign * amp * Math.exp(-k / 5) * (k % 2 ? -0.6 : 1); }
    }
  }
  return buffer;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> | null {
  if (amount <= 0.001) return null;
  const k = amount * 60;
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i += 1) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return curve;
}

export function createFxChain(ctx: BaseAudioContext, out: AudioNode): FxChain {
  const input = ctx.createGain();
  const wobbleDelay = ctx.createDelay(0.1);
  wobbleDelay.delayTime.value = 0.006;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 5.3;
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 0;
  const flutterDepth = ctx.createGain(); flutterDepth.gain.value = 0;
  lfo.connect(wobbleDepth).connect(wobbleDelay.delayTime);
  lfo2.connect(flutterDepth).connect(wobbleDelay.delayTime);
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 160;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4200;
  const warmLow = ctx.createBiquadFilter(); warmLow.type = 'lowshelf'; warmLow.frequency.value = 220;
  const warmHigh = ctx.createBiquadFilter(); warmHigh.type = 'highshelf'; warmHigh.frequency.value = 6500;
  const shaper = ctx.createWaveShaper(); shaper.oversample = '2x';
  const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = Math.min(20000, ctx.sampleRate / 2 - 100); muffle.Q.value = 0.5;
  const compressor = ctx.createDynamicsCompressor();
  const limiter = ctx.createDynamicsCompressor(); limiter.attack.value = 0.001; limiter.release.value = 0.05;
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const echoDelay = ctx.createDelay(1);
  const echoFeedback = ctx.createGain();
  const echoSend = ctx.createGain();
  const reverb = ctx.createConvolver(); reverb.buffer = createImpulse(ctx, 1.8, 2.2);
  const reverbSend = ctx.createGain();
  const vinylSrc = ctx.createBufferSource(); vinylSrc.buffer = createVinylBuffer(ctx); vinylSrc.loop = true;
  const vinylGain = ctx.createGain(); vinylGain.gain.value = 0;
  const bus: AudioNode = pan ?? out;

  input.connect(wobbleDelay).connect(low).connect(mid).connect(high).connect(warmLow).connect(warmHigh).connect(shaper).connect(muffle).connect(compressor).connect(limiter).connect(gain);
  limiter.connect(echoDelay).connect(echoFeedback).connect(echoDelay);
  echoDelay.connect(echoSend);
  limiter.connect(reverb).connect(reverbSend);
  vinylSrc.connect(vinylGain);
  if (pan) { gain.connect(pan); pan.connect(out); } else gain.connect(out);
  echoSend.connect(bus); reverbSend.connect(bus); vinylGain.connect(bus);

  let lastDrive = -1;
  const set = (param: AudioParam, value: number, tc: number) => {
    if (tc > 0) param.setTargetAtTime(value, ctx.currentTime, tc); else param.setValueAtTime(value, 0);
  };
  let started = false;

  return {
    input, gain, pan,
    apply(p, tc) {
      set(low.gain, p.eqLow, tc); set(mid.gain, p.eqMid, tc); set(high.gain, p.eqHigh, tc);
      set(compressor.ratio, 1 + p.compressor * 11, tc); set(compressor.threshold, -8 - p.compressor * 32, tc);
      set(limiter.threshold, -1 - p.limiter * 18, tc); set(limiter.ratio, 8 + p.limiter * 12, tc);
      set(echoDelay.delayTime, 0.16 + p.echo * 0.32, tc); set(echoFeedback.gain, p.echo * 0.55, tc); set(echoSend.gain, p.echo * 0.45, tc);
      set(reverbSend.gain, p.reverb * 0.6, tc);
      const warmth = clamp01(p.warmth);
      set(warmLow.gain, warmth * 4, tc); set(warmHigh.gain, -warmth * 4, tc);
      const drive = Math.min(1, clamp01(p.drive) + warmth * 0.12);
      if (Math.abs(drive - lastDrive) > 0.01) { lastDrive = drive; shaper.curve = driveCurve(drive); }
      const wob = clamp01(p.wobble);
      set(wobbleDepth.gain, wob * 0.0045, tc); set(flutterDepth.gain, wob * 0.0009, tc);
      set(muffle.frequency, Math.min(20000, ctx.sampleRate / 2 - 100) * Math.pow(0.04, clamp01(p.muffle)), tc);
      set(vinylGain.gain, clamp01(p.vinyl) * 0.9, tc);
    },
    start(when = 0) {
      if (started) return;
      started = true;
      lfo.start(when); lfo2.start(when); vinylSrc.start(when);
    },
    stop(when = 0) { try { lfo.stop(when); lfo2.stop(when); vinylSrc.stop(when); } catch { /* already stopped */ } },
    dispose() {
      this.stop();
      for (const n of [input, wobbleDelay, lfo, lfo2, wobbleDepth, flutterDepth, low, mid, high, warmLow, warmHigh, shaper, muffle, compressor, limiter, gain, pan, echoDelay, echoFeedback, echoSend, reverb, reverbSend, vinylSrc, vinylGain]) { try { n?.disconnect(); } catch { /* ignore */ } }
    },
  };
}
