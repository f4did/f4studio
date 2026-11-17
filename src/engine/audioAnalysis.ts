/** Offline stand-in for AnalyserNode so exported visualizers move exactly like the preview. */
export class FrameAnalyser {
  private mono: Float32Array;
  private readonly size = 1024;
  private readonly window: Float32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint16Array;
  private smoothed = new Float32Array(512);
  private readonly tau: number;

  constructor(private readonly buffer: AudioBuffer, fps: number) {
    const a = buffer.getChannelData(0);
    const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
    this.mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 1) this.mono[i] = ((a[i] ?? 0) + (b[i] ?? 0)) / 2;
    const n = this.size;
    this.window = new Float32Array(n);
    for (let i = 0; i < n; i += 1) { const x = i / n; this.window[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x); }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i += 1) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
    this.rev = new Uint16Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i += 1) { let r = 0; for (let k = 0; k < bits; k += 1) r |= ((i >> k) & 1) << (bits - 1 - k); this.rev[i] = r; }
    // The preview analyser smooths per animation frame (~60/s); keep the same decay per second.
    this.tau = Math.pow(0.8, 60 / fps);
  }

  /** Byte spectrum + waveform for the window ending at `seconds`. Call with increasing times. */
  at(seconds: number): { frequency: Uint8Array; time: Uint8Array } {
    const n = this.size;
    const end = Math.min(this.mono.length, Math.max(n, Math.round(seconds * this.buffer.sampleRate)));
    const start = end - n;
    const re = new Float32Array(n); const im = new Float32Array(n);
    const time = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const v = this.mono[start + i] ?? 0;
      re[this.rev[i]!] = v * this.window[i]!;
      time[i] = Math.max(0, Math.min(255, Math.round(128 + v * 127)));
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size / 2; const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j += 1) {
          const wr = this.cos[j * step]!; const wi = this.sin[j * step]!;
          const a = i + j; const b = a + half;
          const tr = re[b]! * wr - im[b]! * wi; const ti = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        }
      }
    }
    const frequency = new Uint8Array(n / 2);
    for (let k = 0; k < n / 2; k += 1) {
      const mag = Math.hypot(re[k]!, im[k]!) / n;
      this.smoothed[k] = this.tau * this.smoothed[k]! + (1 - this.tau) * mag;
      const db = 20 * Math.log10(Math.max(1e-9, this.smoothed[k]!));
      frequency[k] = Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)));
    }
    return { frequency, time };
  }
}
