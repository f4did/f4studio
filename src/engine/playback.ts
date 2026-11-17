/**
 * Playback + preview renderer.
 *
 * The timeline is the source of truth: on every frame we derive which clips are active from
 * (project, playhead) and map timeline time -> source time with core/timeline/time.ts.
 * Media elements are only slaves: they are seeked/played to match, never consulted for timing.
 * The playhead is advanced by performance.now() so it does not stall when a decoder does.
 */
import { clipEnd, effectivePitchSemitones, projectDuration, evaluateKeyframes, evaluateMediaAnimation, evaluateTextAnimation, evaluateTransition, formatTimecode, timelineToSource, type Clip, type Project, type TextAnimationFrame, type TransitionFrame, type Transform } from '../core';
import { assetUrl } from './media';
import { useEditor } from '../store/editor';
import { createFxChain, type FxChain } from './audioFx';

type MediaEl = HTMLVideoElement | HTMLAudioElement;
interface AudioRoute {
  source: MediaElementAudioSourceNode;
  pitch: AudioWorkletNode | null;
  chain: FxChain;
}
const DRIFT_SEC = 0.25;

export class PlaybackEngine {
  private els = new Map<string, MediaEl>();
  private raf = 0;
  private t0 = 0;
  private f0 = 0;
  private canvas: HTMLCanvasElement | null = null;
  private images = new Map<string, HTMLImageElement>();
  private chromaCanvas: HTMLCanvasElement | null = null;
  private transientTransforms = new Map<string, Transform>();
  private transientRefreshRaf = 0;
  private mediaNodes = new Map<string, AudioRoute>();
  private audioContext: AudioContext | null = null;
  private pitchWorklet: Promise<boolean> | null = null;
  private analyser: AnalyserNode | null = null;
  private visualizerLevels = new Map<string, number[]>();
  private textMeasure = new Map<string, { w: number; h: number }>();
  private effectsEnabled = true;
  private offlineAnalysis: { frequency: Uint8Array; time: Uint8Array } | null = null;
  private offlineEls = new Map<string, HTMLVideoElement>();
  private offlineReadyImages = new Set<string>();
  private offlineClock = 0;
  readonly missing = new Set<string>();

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.draw();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.transientRefreshRaf);
    this.transientRefreshRaf = 0;
    for (const el of this.els.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.els.clear();
    this.images.clear();
    this.chromaCanvas = null;
    this.transientTransforms.clear();
    for (const route of this.mediaNodes.values()) {
      try { route.source.disconnect(); route.pitch?.disconnect(); } catch { /* ignore */ }
      route.chain.dispose();
    }
    for (const el of this.offlineEls.values()) { el.removeAttribute('src'); el.load(); }
    this.offlineEls.clear();
    this.offlineReadyImages.clear();
    this.mediaNodes.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.analyser = null;
    this.visualizerLevels.clear();
    this.pitchWorklet = null;
  }

  play() {
    const s = useEditor.getState();
    const project = s.project();
    const end = projectDuration(project);
    if (end === 0) return;
    this.ensureAudioGraph();
    void this.audioContext?.resume();
    for (const [id, el] of this.els) this.connectMedia(id, el);
    if (s.playhead >= end) s.setPlayhead(0);
    s.setPlaying(true);
    this.t0 = performance.now();
    this.f0 = useEditor.getState().playhead;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    useEditor.getState().setPlaying(false);
    for (const el of this.els.values()) el.pause();
    this.draw();
  }

  /** Call after the playhead or project changes while paused. */
  refresh() {
    if (!useEditor.getState().playing) this.draw();
  }

  /** Redraw the current frame and return the preview canvas as a PNG (null when no canvas is attached). */
  async snapshotPng(): Promise<Blob | null> {
    const cv = this.canvas;
    if (!cv) return null;
    this.draw();
    // Give pending video seeks / image decodes a moment, then draw once more so the still is current.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    this.draw();
    return new Promise((resolve) => cv.toBlob((blob) => resolve(blob), 'image/png'));
  }

  setTransientTransform(id: string, transform: Transform | null) {
    if (transform) this.transientTransforms.set(id, transform);
    else this.transientTransforms.delete(id);
    if (!this.transientRefreshRaf) this.transientRefreshRaf = requestAnimationFrame(() => {
      this.transientRefreshRaf = 0;
      this.refresh();
    });
  }

  setEffectsEnabled(enabled: boolean) {
    this.effectsEnabled = enabled;
    this.refresh();
  }

  private tick = (now: number) => {
    const s = useEditor.getState();
    const p = s.project();
    const frame = this.f0 + Math.floor(((now - this.t0) / 1000) * p.settings.fps);
    const end = projectDuration(p);
    if (frame >= end) {
      s.setPlayhead(end);
      this.pause();
      return;
    }
    s.setPlayhead(frame);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private async elementFor(c: Clip, p: Project): Promise<MediaEl | null> {
    const existing = this.els.get(c.id);
    if (existing) return existing;
    const asset = c.assetId ? p.assets[c.assetId] : undefined;
    if (!asset) return null;
    const url = await assetUrl(asset);
    if (!url) {
      this.missing.add(asset.id);
      return null;
    }
    const el = document.createElement(c.kind === 'audio' ? 'audio' : 'video');
    el.preload = 'auto';
    el.src = url;
    // Prime muted playback so browser autoplay policy does not block the later
    // Web Audio-routed sound after the source has loaded asynchronously.
    el.muted = true;
    void el.play().catch(() => undefined);
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    this.els.set(c.id, el);
    this.connectMedia(c.id, el, c.audio.pitchSemitones);
    return el;
  }

  private ensureAudioGraph() {
    if (this.audioContext) return;
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    this.audioContext = new AudioContextCtor();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.connect(this.audioContext.destination);
  }

  private connectMedia(id: string, el: MediaEl, pitchSemitones = 0) {
    if (!this.audioContext || this.mediaNodes.has(id)) return;
    try {
      const source = this.audioContext.createMediaElementSource(el);
      const chain = createFxChain(this.audioContext, this.analyser ?? this.audioContext.destination);
      source.connect(chain.input);
      chain.start();
      const route: AudioRoute = { source, pitch: null, chain };
      this.mediaNodes.set(id, route);
      if (pitchSemitones) void this.enablePitch(id, route, pitchSemitones);
    } catch {
      // If a browser rejects the Web Audio source, fall back to the native element.
      el.muted = false;
    }
  }

  private loadPitchWorklet(): Promise<boolean> {
    if (this.pitchWorklet) return this.pitchWorklet;
    this.pitchWorklet = (async () => {
      if (!this.audioContext?.audioWorklet) return false;
      const source = `
        class F4PitchShifter extends AudioWorkletProcessor {
          static get parameterDescriptors() { return [{ name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }
          constructor() {
            super(); this.size = 32768; this.grain = 2048; this.write = 0; this.phase = 0;
            this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
          }
          read(buffer, position) {
            const p = (position + this.size) % this.size; const i = Math.floor(p); const f = p - i;
            return buffer[i] * (1 - f) + buffer[(i + 1) % this.size] * f;
          }
          process(inputs, outputs, parameters) {
            const input = inputs[0]; const output = outputs[0]; if (!input || !input.length) return true;
            const ratio = Math.max(0.25, Math.min(4, parameters.pitch[0] || 1));
            for (let i = 0; i < output[0].length; i++) {
              for (let channel = 0; channel < output.length; channel++) {
                const sample = input[channel]?.[i] || input[0]?.[i] || 0; this.buffers[channel][this.write] = sample;
                const base = this.write - 4096; const first = this.phase * this.grain; const second = ((this.phase + 0.5) % 1) * this.grain;
                const mix = Math.pow(Math.sin(Math.PI * this.phase), 2);
                output[channel][i] = this.read(this.buffers[channel], base + first) * mix + this.read(this.buffers[channel], base + second) * (1 - mix);
              }
              this.write = (this.write + 1) % this.size; this.phase = (((this.phase + (ratio - 1) / this.grain) % 1) + 1) % 1;
            }
            return true;
          }
        }
        registerProcessor('f4-pitch-shifter', F4PitchShifter);
      `;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try { await this.audioContext.audioWorklet.addModule(url); return true; } catch { return false; } finally { URL.revokeObjectURL(url); }
    })();
    return this.pitchWorklet;
  }

  private async enablePitch(id: string, route: AudioRoute, semitones: number) {
    if (!this.audioContext || route.pitch || !(await this.loadPitchWorklet())) return;
    if (this.mediaNodes.get(id) !== route) return;
    try {
      const node = new AudioWorkletNode(this.audioContext, 'f4-pitch-shifter', { outputChannelCount: [2], parameterData: { pitch: Math.pow(2, Math.max(-24, Math.min(24, semitones)) / 12) } });
      route.source.disconnect(route.chain.input);
      route.source.connect(node).connect(route.chain.input);
      route.pitch = node;
    } catch { /* AudioWorklet is optional; retain the ordinary audio route. */ }
  }

  private draw() {
    const cv = this.canvas;
    if (!cv) return;
    const s = useEditor.getState();
    const qualityScale = s.previewQuality === 'full' ? 1 : s.previewQuality === 'half' ? 0.5 : 0.25;
    this.paint(cv, s.project(), s.playhead, qualityScale, true, s.playing);
  }

  /**
   * Deterministic offline render used by export: seeks every media element to the
   * exact frame, then paints with the same code path as the live preview.
   */
  async renderOffline(cv: HTMLCanvasElement, p: Project, frame: number, analysis: { frequency: Uint8Array; time: Uint8Array } | null, options: { fast?: boolean } = {}): Promise<void> {
    this.offlineAnalysis = analysis;
    this.offlineClock = (frame / p.settings.fps) * 1000;
    const fps = p.settings.fps;
    const active = Object.values(p.clips).filter((c) => frame >= c.start && frame < clipEnd(c));
    await Promise.all(active.map(async (c) => {
      const track = p.tracks.find((t) => t.id === c.trackId);
      if (!track?.visible) return;
      if (c.kind === 'video') {
        const el = await this.offlineVideo(c, p);
        const src = timelineToSource(c, frame);
        if (el && src !== null) await seekTo(el, src / fps + 0.002, options.fast === true);
      } else if (c.kind === 'image') {
        const img = this.imageFor(c, p);
        if (img && !this.offlineReadyImages.has(c.id)) {
          if (!img.complete) await new Promise<void>((resolve) => { img.addEventListener('load', () => resolve(), { once: true }); img.addEventListener('error', () => resolve(), { once: true }); });
          else await img.decode().catch(() => undefined);
          this.offlineReadyImages.add(c.id);
        }
      }
    }));
    this.paint(cv, p, frame, 1, false, false);
  }

  private async offlineVideo(c: Clip, p: Project): Promise<HTMLVideoElement | null> {
    const existing = this.offlineEls.get(c.id);
    if (existing) return existing;
    const asset = c.assetId ? p.assets[c.assetId] : undefined;
    if (!asset) return null;
    const url = await assetUrl(asset);
    if (!url) return null;
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
    this.offlineEls.set(c.id, el);
    await new Promise<void>((resolve) => {
      if (el.readyState >= 2) return resolve();
      const done = () => resolve();
      el.addEventListener('loadeddata', done, { once: true });
      el.addEventListener('error', done, { once: true });
      window.setTimeout(done, 8000);
    });
    return el;
  }

  private paint(cv: HTMLCanvasElement, p: Project, frame: number, qualityScale: number, live: boolean, playing: boolean) {
    const fps = p.settings.fps;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const renderWidth = Math.max(2, Math.round(p.settings.width * qualityScale));
    const renderHeight = Math.max(2, Math.round(p.settings.height * qualityScale));
    if (cv.width !== renderWidth || cv.height !== renderHeight) {
      cv.width = renderWidth;
      cv.height = renderHeight;
    }
    ctx.globalAlpha = 1;
    const background = p.settings.background;
    if (!background || background.type === 'solid') {
      ctx.fillStyle = background?.from ?? p.settings.backgroundColor;
    } else {
      const angle = (background.angle * Math.PI) / 180;
      const x = Math.cos(angle) * cv.width;
      const y = Math.sin(angle) * cv.height;
      const gradient = background.type === 'radial' ? ctx.createRadialGradient(cv.width / 2, cv.height / 2, 0, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) / 1.2) : ctx.createLinearGradient(cv.width / 2 - x, cv.height / 2 - y, cv.width / 2 + x, cv.height / 2 + y);
      gradient.addColorStop(0, background.from);
      gradient.addColorStop(1, background.to);
      ctx.fillStyle = gradient;
    }
    ctx.globalAlpha = background?.opacity ?? 1;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;

    const soloed = p.tracks.some((t) => t.solo);
    // Track order is the compositing order: the first lane is visually on top,
    // so render the last lane first and the first lane last. This keeps the
    // preview faithful to the user's visible timeline order.
    const order = new Map(p.tracks.map((t, i) => [t.id, i] as const));
    const active = Object.values(p.clips)
      .filter((c) => frame >= c.start && frame < clipEnd(c))
      .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0));

    const activeIds = new Set(active.map((c) => c.id));
    if (live) for (const [id, el] of this.els) if (!activeIds.has(id)) el.pause();

    for (const c of active) {
      const renderClip = this.effectsEnabled || !c.effects.length ? c : { ...c, effects: [] };
      const track = p.tracks.find((t) => t.id === c.trackId);
      if (!track) continue;
      const audible = c.freezeFrame === undefined && !track.muted && !c.audio.muted && (!soloed || track.solo);
      if (live && (c.kind === 'audio' || c.kind === 'video')) {
        void this.syncMedia(c, p, frame, fps, playing, audible, track.volume);
      }
      if (!track.visible) continue;
      if (c.kind === 'video') {
        const el = live ? this.els.get(c.id) : this.offlineEls.get(c.id);
        const transition = withMotion(c.transitionIn ? evaluateTransition(c.transitionIn, (frame - c.start) / Math.max(1, c.transitionIn.durationFrames)) : undefined, c, frame);
        if (el instanceof HTMLVideoElement && el.readyState >= 2) this.blit(ctx, cv, renderClip, el, el.videoWidth, el.videoHeight, transition, this.transformAt(c, frame));
      } else if (c.kind === 'image') {
        const img = this.imageFor(c, p);
        const transition = withMotion(c.transitionIn ? evaluateTransition(c.transitionIn, (frame - c.start) / Math.max(1, c.transitionIn.durationFrames)) : undefined, c, frame);
        if (img?.complete && img.naturalWidth) this.blit(ctx, cv, renderClip, img, img.naturalWidth, img.naturalHeight, transition, this.transformAt(c, frame));
      } else if (c.kind === 'text' && c.text) {
        this.drawText(ctx, cv, renderClip, frame, fps, this.transformAt(c, frame));
      } else if (c.kind === 'visualizer' && c.visualizer) {
        this.drawVisualizer(ctx, cv, c, frame, this.transformAt(c, frame));
      }
    }
    ctx.globalAlpha = 1;
  }

  private async syncMedia(c: Clip, p: Project, frame: number, fps: number, playing: boolean, audible: boolean, trackVol: number) {
    const el = await this.elementFor(c, p);
    if (!el) return;
    const src = timelineToSource(c, frame);
    if (src === null) return;
    const target = src / fps;
    const route = this.mediaNodes.get(c.id);
    const clipFrame = frame - c.start;
    const duration = Math.max(1, c.duration);
    const fadeIn = c.audio.fadeInFrames > 0 ? Math.min(1, clipFrame / c.audio.fadeInFrames) : 1;
    const fadeOut = c.audio.fadeOutFrames > 0 ? Math.min(1, (duration - clipFrame) / c.audio.fadeOutFrames) : 1;
    const ducking = c.audio.ducking;
    const ducked = Boolean(ducking?.enabled && ducking.sidechainTrackId && Object.values(p.clips).some((other) => other.id !== c.id && other.trackId === ducking.sidechainTrackId && frame >= other.start && frame < clipEnd(other) && (other.kind === 'audio' || other.kind === 'video') && !other.audio.muted));
    const duckGain = ducked ? 1 - Math.max(0, Math.min(1, ducking?.amount ?? 0)) : 1;
    const clipVolume = Math.max(0, evaluateKeyframes(c.keyframes['audio.volume'], clipFrame, c.audio.volume));
    const gain = Math.max(0, clipVolume * trackVol * duckGain) * Math.max(0, Math.min(fadeIn, fadeOut));
    const semis = effectivePitchSemitones(c.audio);
    if (route && Math.abs(semis) > 0.001 && !route.pitch) void this.enablePitch(c.id, route, semis);
    if (route?.pitch && this.audioContext) {
      route.pitch.parameters.get('pitch')?.setTargetAtTime(Math.pow(2, Math.max(-24, Math.min(24, semis)) / 12), this.audioContext.currentTime, 0.02);
    }
    if (route && this.audioContext) {
      // Keep mute state in the route gain so clip/track mute toggles work and
      // the native element is not left permanently silent.
      el.muted = false;
      el.volume = 1;
      if (playing && this.audioContext.state === 'suspended') void this.audioContext.resume();
      const ramp = (ducked ? ducking?.attackFrames : ducking?.releaseFrames) ?? 15;
      route.chain.gain.gain.setTargetAtTime(audible ? gain : 0, this.audioContext.currentTime, Math.max(0.01, ramp / fps));
      if (route.chain.pan) route.chain.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, c.audio.pan)), this.audioContext.currentTime, 0.015);
      route.chain.apply(c.audio.processing ?? { eqLow: 0, eqMid: 0, eqHigh: 0, compressor: 0, limiter: 0, reverb: 0, echo: 0 }, 0.02);
    } else {
      el.muted = !audible;
      el.volume = Math.min(1, Math.max(0, gain));
    }
    el.playbackRate = Math.min(16, Math.max(0.0625, c.speed));
    (el as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = c.audio.preservePitch !== false;
    if (c.freezeFrame !== undefined) {
      el.pause();
      el.muted = true;
      if (Math.abs(el.currentTime - target) > 1 / fps / 2) el.currentTime = target;
      return;
    }
    if (c.reverse) {
      // Browsers cannot play media backwards. Preview shows the correct frame by seeking; audio is muted.
      el.pause();
      el.muted = true;
      if (Math.abs(el.currentTime - target) > 1 / fps / 2) el.currentTime = target;
      return;
    }
    if (!playing) {
      el.pause();
      if (Math.abs(el.currentTime - target) > 1 / (fps * 2)) el.currentTime = target;
    } else {
      if (Math.abs(el.currentTime - target) > DRIFT_SEC) el.currentTime = target;
      if (el.paused) void el.play().catch(() => undefined);
    }
  }

  private imageFor(c: Clip, p: Project): HTMLImageElement | null {
    const cached = this.images.get(c.id);
    if (cached) return cached;
    const asset = c.assetId ? p.assets[c.assetId] : undefined;
    if (!asset) return null;
    const img = new Image();
    this.images.set(c.id, img);
    void assetUrl(asset).then((u) => {
      if (u) {
        img.onload = () => this.refresh();
        img.src = u;
      } else this.missing.add(asset.id);
    });
    return img;
  }

  /** Last measured text size in canvas px (before the clip's scale), used for accurate selection boxes. */
  measuredText(id: string) { return this.textMeasure.get(id); }

  private transformAt(c: Clip, frame: number): Transform {
    const at = Math.max(0, frame - c.start);
    const t = this.transientTransforms.get(c.id) ?? c.transform;
    return {
      ...t,
      x: evaluateKeyframes(c.keyframes['transform.x'], at, t.x),
      y: evaluateKeyframes(c.keyframes['transform.y'], at, t.y),
      scaleX: evaluateKeyframes(c.keyframes['transform.scaleX'], at, t.scaleX),
      scaleY: evaluateKeyframes(c.keyframes['transform.scaleY'], at, t.scaleY),
      rotation: evaluateKeyframes(c.keyframes['transform.rotation'], at, t.rotation),
      opacity: evaluateKeyframes(c.keyframes['transform.opacity'], at, t.opacity),
    };
  }

  private blit(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, c: Clip, src: CanvasImageSource, sw: number, sh: number, transition?: TransitionFrame, animatedTransform = c.transform) {
    if (!sw || !sh) return;
    const keyed = this.processedSource(c, src, sw, sh);
    src = keyed.source;
    sw = keyed.width;
    sh = keyed.height;
    const t = animatedTransform;
    // "Contain" fit into the canvas, then apply the user's transform on top.
    const fit = Math.min(cv.width / sw, cv.height / sh);
    const w = sw * fit * t.width * t.scaleX * (transition?.scale ?? 1);
    const h = sh * fit * t.height * t.scaleY * (transition?.scale ?? 1);
    const cx = cv.width / 2 + ((t.x + (transition?.x ?? 0)) * cv.width) / 2;
    const cy = cv.height / 2 + ((t.y + (transition?.y ?? 0)) * cv.height) / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, t.opacity * (transition?.alpha ?? 1)));
    ctx.filter = mediaFilter(c, transition?.blur ?? 0);
    ctx.translate(cx, cy);
    ctx.rotate(((t.rotation + (transition?.rotation ?? 0)) * Math.PI) / 180);
    ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
    const { left, top, right, bottom } = t.crop;
    const sx = sw * left;
    const sy = sh * top;
    const cw = sw * (1 - left - right);
    const ch = sh * (1 - top - bottom);
    if (cw > 0 && ch > 0) {
      const dw = w * (1 - left - right);
      const dh = h * (1 - top - bottom);
      const dx = -w * t.anchorX + (w * left);
      const dy = -h * t.anchorY + (h * top);
      if (t.cornerRadius > 0) {
        roundedRectPath(ctx, dx, dy, dw, dh, Math.min(dw, dh) * Math.min(0.5, t.cornerRadius));
        ctx.clip();
      }
      this.applyMask(ctx, c, dw, dh);
      ctx.drawImage(src, sx, sy, cw, ch, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  private applyMask(ctx: CanvasRenderingContext2D, c: Clip, width: number, height: number): void {
    const effect = c.effects.find((item) => item.enabled && item.type === 'mask');
    if (!effect) return;
    const maskWidth = Math.max(0.05, Math.min(1, effectNumber(effect.params.width, 0.86)));
    const maskHeight = Math.max(0.05, Math.min(1, effectNumber(effect.params.height, 0.86)));
    const x = Math.max(-1, Math.min(1, effectNumber(effect.params.x, 0))) * width / 2;
    const y = Math.max(-1, Math.min(1, effectNumber(effect.params.y, 0))) * height / 2;
    const w = width * maskWidth;
    const h = height * maskHeight;
    ctx.beginPath();
    if (effect.params.shape === 'rectangle') ctx.rect(-w / 2 + x, -h / 2 + y, w, h);
    else ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }

  private processedSource(c: Clip, src: CanvasImageSource, sw: number, sh: number): { source: CanvasImageSource; width: number; height: number } {
    const keyEffect = c.effects.find((item) => item.enabled && item.type === 'chromaKey');
    const gradeEffect = c.effects.find((item) => item.enabled && item.type === 'colorGrade');
    if (!keyEffect && !gradeEffect) return { source: src, width: sw, height: sh };
    const color = parseHexColor(typeof keyEffect?.params.color === 'string' ? keyEffect.params.color : '#00ff00');
    const similarity = clampNumber(keyEffect?.params.similarity, 0.28);
    const smoothness = Math.max(0.001, clampNumber(keyEffect?.params.smoothness, 0.08));
    const spill = clampNumber(keyEffect?.params.spill, 0.35);
    const temperature = effectNumber(gradeEffect?.params.temperature, 0);
    const tint = effectNumber(gradeEffect?.params.tint, 0);
    const shadows = effectNumber(gradeEffect?.params.shadows, 0);
    const highlights = effectNumber(gradeEffect?.params.highlights, 0);
    const vignette = clampNumber(gradeEffect?.params.vignette, 0);
    const scale = Math.min(1, 1920 / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = this.chromaCanvas ?? (this.chromaCanvas = document.createElement('canvas'));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const keyCtx = canvas.getContext('2d');
    if (!keyCtx) return { source: src, width: sw, height: sh };
    try {
      keyCtx.clearRect(0, 0, width, height);
      keyCtx.drawImage(src, 0, 0, width, height);
      const pixels = keyCtx.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const r = pixels.data[i]! / 255;
        const g = pixels.data[i + 1]! / 255;
        const b = pixels.data[i + 2]! / 255;
        if (keyEffect) {
          const distance = Math.hypot(r - color.r, g - color.g, b - color.b) / Math.sqrt(3);
          pixels.data[i + 3] = Math.round(clampNumber((distance - similarity) / smoothness, 0));
        }
        let red = r;
        let green = g;
        let blue = b;
        if (gradeEffect) {
          const luminance = (red + green + blue) / 3;
          const shadowWeight = Math.max(0, 0.55 - luminance) / 0.55;
          const highlightWeight = Math.max(0, luminance - 0.45) / 0.55;
          red += temperature * 0.16 + tint * 0.07 + shadows * shadowWeight * 0.16 + highlights * highlightWeight * 0.16;
          green += -tint * 0.07 + shadows * shadowWeight * 0.04 + highlights * highlightWeight * 0.04;
          blue += -temperature * 0.16 + tint * 0.07 + shadows * shadowWeight * 0.1 + highlights * highlightWeight * 0.1;
          const px = (i / 4) % width;
          const py = Math.floor(i / 4 / width);
          const distance = Math.hypot((px / Math.max(1, width - 1)) * 2 - 1, (py / Math.max(1, height - 1)) * 2 - 1) / Math.sqrt(2);
          const vignetteAmount = Math.max(0, Math.min(1, (distance - 0.35) / 0.65)) * vignette;
          red *= 1 - vignetteAmount;
          green *= 1 - vignetteAmount;
          blue *= 1 - vignetteAmount;
        }
        if (keyEffect && green > Math.max(red, blue)) {
          const neutral = Math.max(red, blue);
          green = green * (1 - spill) + neutral * spill;
        }
        pixels.data[i] = Math.round(clampNumber(red, 0) * 255);
        pixels.data[i + 1] = Math.round(clampNumber(green, 0) * 255);
        pixels.data[i + 2] = Math.round(clampNumber(blue, 0) * 255);
      }
      keyCtx.putImageData(pixels, 0, 0);
      return { source: canvas, width, height };
    } catch {
      return { source: src, width: sw, height: sh };
    }
  }

  private drawText(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, c: Clip, frame: number, fps: number, animatedTransform = c.transform) {
    const tx = c.text;
    if (!tx) return;
    const t = animatedTransform;
    const st = tx.style;
    const local = frame - c.start;
    let animation: TextAnimationFrame = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0, letterSpacing: 0 };
    if (tx.animationIn) {
      const duration = Math.max(1, tx.animationIn.durationFrames);
      animation = mergeAnimation(animation, evaluateTextAnimation(tx.animationIn, local / duration));
    }
    if (tx.animationOut) {
      const duration = Math.max(1, tx.animationOut.durationFrames);
      const outStart = Math.max(0, c.duration - duration);
      if (local >= outStart) animation = mergeAnimation(animation, evaluateTextAnimation(tx.animationOut, (local - outStart) / duration, true));
    }
    if (tx.animationLoop) {
      const duration = Math.max(1, tx.animationLoop.durationFrames);
      animation = mergeAnimation(animation, evaluateTextAnimation(tx.animationLoop, (((local % duration) + duration) % duration) / duration));
    }
    ctx.save();
    const fx = new Map(c.effects.filter((effect) => effect.enabled).map((effect) => [effect.type, effect.params.value]));
    const number = (type: string, fallback: number) => typeof fx.get(type) === 'number' ? Number(fx.get(type)) : fallback;
    ctx.filter = `brightness(${Math.max(0, 1 + number('brightness', 0))}) contrast(${Math.max(0, number('contrast', 1))}) saturate(${Math.max(0, number('saturation', 1))}) hue-rotate(${number('hue', 0)}deg) grayscale(${Math.max(0, Math.min(1, number('grayscale', 0)))}) invert(${Math.max(0, Math.min(1, number('invert', 0)))}) blur(${Math.max(0, number('blur', 0))}px) sepia(${Math.max(0, Math.min(1, number('sepia', 0)))})`;
    ctx.globalAlpha = Math.min(1, Math.max(0, t.opacity * animation.opacity));
    if (animation.blur > 0) ctx.filter = `blur(${animation.blur}px)`;
    ctx.translate(cv.width / 2 + ((t.x + animation.x) * cv.width) / 2, cv.height / 2 + ((t.y + animation.y) * cv.height) / 2);
    ctx.rotate(((t.rotation + animation.rotation) * Math.PI) / 180);
    ctx.scale(t.scaleX * animation.scale, t.scaleY * animation.scale);
    ctx.font = `${st.italic ? 'italic ' : ''}${st.fontWeight} ${st.fontSize}px ${st.fontFamily}`;
    ctx.textAlign = st.align;
    ctx.textBaseline = 'middle';
    const textFill = st.gradient ? (() => { const angle = (st.gradient!.angle * Math.PI) / 180; const x = Math.cos(angle) * st.fontSize * 4; const y = Math.sin(angle) * st.fontSize * 4; const g = ctx.createLinearGradient(-x, -y, x, y); g.addColorStop(0, st.gradient!.from); g.addColorStop(1, st.gradient!.to); return g; })() : st.color;
    ctx.fillStyle = textFill;
    const timerFrames = Math.max(0, frame - c.start);
    const displayText = tx.timerMode === 'stopwatch' ? formatTimecode(timerFrames, fps).slice(3, 8) : tx.timerMode === 'countdown' ? formatTimecode(Math.max(0, c.duration - timerFrames), fps).slice(3, 8) : tx.text;
    const lines = displayText.split('\n');
    const lh = st.fontSize * st.lineHeight;
    const yOffset = (i: number) => (i - (lines.length - 1) / 2) * lh;
    {
      const pad = st.background ? st.background.padding * 2 : 0;
      const m = ctx.measureText(lines[0] ?? '');
      const glyphH = (m.actualBoundingBoxAscent || st.fontSize * 0.72) + (m.actualBoundingBoxDescent || st.fontSize * 0.2);
      this.textMeasure.set(c.id, { w: Math.max(1, ...lines.map((line) => ctx.measureText(line).width + Math.max(0, line.length - 1) * st.letterSpacing)) + pad, h: (lines.length - 1) * lh + glyphH + pad });
    }
    if (st.shadow) {
      ctx.shadowColor = st.shadow.color;
      ctx.shadowBlur = st.shadow.blur;
      ctx.shadowOffsetX = st.shadow.offsetX;
      ctx.shadowOffsetY = st.shadow.offsetY;
    }
    if (st.background) {
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
      const padding = st.background.padding;
      const boxW = widest + padding * 2;
      const boxH = lines.length * lh + padding * 2;
      const boxX = st.align === 'left' ? 0 : st.align === 'right' ? -boxW : -boxW / 2;
      roundedRectPath(ctx, boxX, -boxH / 2, boxW, boxH, st.background.radius);
      ctx.fillStyle = st.background.color;
      ctx.fill();
      ctx.fillStyle = st.color;
    }
    lines.forEach((line, i) => drawTextLine(ctx, line, yOffset(i), { ...st, fill: textFill }, st.letterSpacing));
    if (st.underline) {
      ctx.save();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = Math.max(1, st.fontSize / 18);
      ctx.globalAlpha = Math.min(1, Math.max(0, t.opacity * animation.opacity));
      lines.forEach((line, i) => {
        const lineWidth = ctx.measureText(line).width;
        const x = st.align === 'left' ? 0 : st.align === 'right' ? -lineWidth : -lineWidth / 2;
        const y = yOffset(i) + st.fontSize * 0.12;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + lineWidth, y); ctx.stroke();
      });
      ctx.restore();
    }
    ctx.restore();
  }

  private drawVisualizer(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, c: Clip, frame: number, t: Transform = c.transform) {
    const config = c.visualizer;
    if (!config) return;
    const analyser = this.offlineAnalysis ? null : this.analyser;
    const frequency = this.offlineAnalysis?.frequency ?? new Uint8Array(analyser?.frequencyBinCount ?? 512);
    const time = this.offlineAnalysis?.time ?? new Uint8Array(analyser?.fftSize ?? 1024);
    if (analyser) {
      analyser.getByteFrequencyData(frequency as Uint8Array<ArrayBuffer>);
      analyser.getByteTimeDomainData(time as Uint8Array<ArrayBuffer>);
    }
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    const radius = Math.min(cv.width, cv.height) * config.radius;
    const bars = Math.max(8, Math.min(128, config.bars));
    const color = () => {
      const gradient = ctx.createLinearGradient(0, 0, cv.width, cv.height);
      gradient.addColorStop(0, config.primaryColor);
      gradient.addColorStop(1, config.secondaryColor);
      return gradient;
    };
    ctx.save();
    {
      // move / scale / rotate around the visual's own centre so it can be placed and sized freely
      const box = visualizerBox(config, cv.width, cv.height);
      ctx.translate(box.cx + (t.x * cv.width) / 2, box.cy + (t.y * cv.height) / 2);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.scale(t.scaleX, t.scaleY);
      ctx.translate(-box.cx, -box.cy);
    }
    ctx.globalAlpha = Math.min(1, Math.max(0, t.opacity));
    ctx.strokeStyle = color();
    ctx.fillStyle = color();
    ctx.lineWidth = Math.max(2, cv.width / 500);
    if (config.type === 'oscilloscope') {
      ctx.beginPath();
      time.forEach((value, index) => {
        const x = (index / Math.max(1, time.length - 1)) * cv.width;
        const y = cy + ((value - 128) / 128) * radius * config.sensitivity;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (config.type === 'radial') {
      for (let i = 0; i < bars; i += 1) {
        const angle = (i / bars) * Math.PI * 2;
        const sample = frequency[Math.floor((i / bars) * frequency.length * config.frequencyMax)] ?? 0;
        const length = radius * (0.25 + (sample / 255) * config.sensitivity * 0.75);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); ctx.lineTo(cx + Math.cos(angle) * (radius + length), cy + Math.sin(angle) * (radius + length)); ctx.stroke();
      }
    } else if (config.type === 'heartbeat') {
      ctx.lineWidth = Math.max(2, cv.width / 420);
      ctx.beginPath();
      const center = cy;
      time.forEach((value, index) => {
        const x = (index / Math.max(1, time.length - 1)) * cv.width;
        const pulse = ((value - 128) / 128) * radius * config.sensitivity;
        const phase = index / Math.max(1, time.length - 1);
        const spike = Math.pow(Math.max(0, Math.sin(phase * Math.PI * 6)), 18) * radius * 0.9;
        const y = center + pulse * 0.22 - spike;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = color();
      ctx.fillRect(0, cy - 1, cv.width, 2);
    } else if (config.type === 'orbit') {
      for (let i = 0; i < bars; i += 1) {
        const angle = (i / bars) * Math.PI * 2 + (this.offlineAnalysis ? this.offlineClock : performance.now()) / 3500;
        const sample = frequency[Math.floor((i / bars) * frequency.length * config.frequencyMax)] ?? 0;
        const orbitRadius = radius + (sample / 255) * radius * 0.55 * config.sensitivity;
        ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * orbitRadius, cy + Math.sin(angle) * orbitRadius, Math.max(2, cv.width / 180), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.2;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    } else if (config.type === 'countdown') {
      const progress = Math.max(0, Math.min(1, (frame - c.start) / Math.max(1, c.duration)));
      const segments = Math.max(24, bars);
      for (let i = 0; i < segments; i += 1) {
        const active = i / segments <= progress;
        const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
        const inner = radius * 1.02;
        const outer = radius * (1.02 + (active ? 0.16 : 0.05));
        ctx.globalAlpha = active ? 0.95 : 0.16;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer); ctx.stroke();
      }
    } else if (config.type === 'linewave') {
      const baseY = cv.height * Math.max(0.55, Math.min(0.96, config.waveformY ?? 0.84));
      const startX = cv.width * 0.28;
      const endX = cv.width * 0.72;
      const width = endX - startX;
      const halfBars = Math.max(Math.ceil(bars / 2), 48);
      const gap = width / (halfBars * 2);
      ctx.lineWidth = Math.max(2, cv.width / 800);
      ctx.lineCap = 'round';
      const previous = this.visualizerLevels.get(c.id) ?? [];
      const levels: number[] = [];
      for (let i = 0; i < halfBars; i += 1) {
        const spectral = (frequency[Math.floor((i / halfBars) * frequency.length * 0.72)] ?? 0) / 255;
        const timeSample = Math.abs((time[Math.floor((i / halfBars) * time.length)] ?? 128) - 128) / 128;
        const raw = spectral * 0.82 + timeSample * 0.18;
        const smooth = Math.max(0.6, Math.min(0.94, config.smoothing ?? 0.82));
        levels[i] = (previous[i] ?? raw) * smooth + raw * (1 - smooth);
      }
      this.visualizerLevels.set(c.id, levels);
      const centerX = (startX + endX) / 2;
      for (let i = 0; i < halfBars; i += 1) {
        const level = levels[i] ?? 0;
        const height = Math.max(1.5, level * cv.height * 0.065 * config.sensitivity);
        const leftX = centerX - (i + 0.5) * gap;
        const rightX = centerX + (i + 0.5) * gap;
        ctx.globalAlpha = 0.28 + Math.min(0.72, level * 1.4);
        for (const x of [leftX, rightX]) { ctx.beginPath(); ctx.moveTo(x, baseY - height); ctx.lineTo(x, baseY + height); ctx.stroke(); }
      }
      if (config.showBorder) {
        drawProgressBorder(ctx, cv, c, frame, config);
      }
    } else if (config.type === 'framepulse') {
      drawProgressBorder(ctx, cv, c, frame, config);
    } else if (config.type === 'dotline') {
      drawDotLine(ctx, cv, config, frequency, time, this.visualizerLevels, c.id, this.offlineAnalysis ? this.offlineClock : performance.now());
    } else if (config.type === 'roundbars') {
      drawRoundBars(ctx, cv, config, frequency, this.visualizerLevels, c.id);
    } else if (config.type === 'dotmatrix') {
      drawDotMatrix(ctx, cv, config, frequency, this.visualizerLevels, c.id);
    } else if (config.type === 'ripple') {
      drawRipple(ctx, cv, config, frequency, this.visualizerLevels, c.id);
    } else if (config.type === 'progressline' || config.type === 'progressring' || config.type === 'progresssegments') {
      drawProgressStyle(ctx, cv, c, frame, config);
    } else {
      const mirrored = config.type === 'mirrored';
      const width = cv.width / bars;
      for (let i = 0; i < bars; i += 1) {
        const sample = frequency[Math.floor((i / bars) * frequency.length * config.frequencyMax)] ?? 0;
        const h = (sample / 255) * cv.height * 0.38 * config.sensitivity;
        const x = i * width;
        ctx.fillRect(x, mirrored ? cy - h : cv.height - h, Math.max(1, width - 2), h);
        if (mirrored) ctx.fillRect(x, cy, Math.max(1, width - 2), h);
      }
    }
    ctx.restore();
  }
}

/** Log-spaced band levels (0–1) with smoothing; low bands first. */
export function bandLevels(frequency: Uint8Array, count: number, smoothing: number, previous: number[], maxFraction = 0.6): number[] {
  const out: number[] = [];
  const top = Math.max(2, frequency.length * maxFraction);
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor(Math.pow(top, i / count));
    const to = Math.max(from + 1, Math.floor(Math.pow(top, (i + 1) / count)));
    let sum = 0;
    for (let k = from; k < to; k += 1) sum += frequency[k] ?? 0;
    const raw = sum / (to - from) / 255;
    out[i] = (previous[i] ?? raw) * smoothing + raw * (1 - smoothing);
  }
  return out;
}

function gradientAcross(ctx: CanvasRenderingContext2D, config: NonNullable<Clip['visualizer']>, x0: number, x1: number) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, config.primaryColor);
  g.addColorStop(1, config.secondaryColor);
  return g;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr); ctx.closePath();
}

/** Rounded, mirrored bars with floating peak caps. */
function drawRoundBars(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, config: NonNullable<Clip['visualizer']>, frequency: Uint8Array, store: Map<string, number[]>, id: string) {
  const count = Math.max(12, Math.min(64, config.bars));
  const smooth = Math.max(0.3, Math.min(0.9, config.smoothing ?? 0.55));
  const levels = bandLevels(frequency, count, smooth, store.get(id) ?? []);
  store.set(id, levels);
  const peaks = store.get(id + ':peaks') ?? levels.map(() => 0);
  const x0 = cv.width * 0.2; const x1 = cv.width * 0.8; const slot = (x1 - x0) / count;
  const baseY = cv.height * (config.waveformY ?? 0.82);
  const barW = Math.max(3, slot * 0.58);
  ctx.fillStyle = gradientAcross(ctx, config, x0, x1);
  for (let i = 0; i < count; i += 1) {
    const level = Math.min(1, (levels[i] ?? 0) * config.sensitivity * 1.15);
    const h = Math.max(barW, level * cv.height * 0.2);
    const x = x0 + i * slot + (slot - barW) / 2;
    roundRect(ctx, x, baseY - h, barW, h, barW / 2); ctx.fill();
    roundRect(ctx, x, baseY + barW * 0.4, barW, h * 0.45, barW / 2); ctx.globalAlpha *= 0.35; ctx.fill(); ctx.globalAlpha /= 0.35;
    peaks[i] = Math.max(h, (peaks[i] ?? 0) - cv.height * 0.0035);
    ctx.beginPath(); ctx.arc(x + barW / 2, baseY - (peaks[i] ?? h) - barW, barW * 0.32, 0, Math.PI * 2); ctx.fill();
  }
  store.set(id + ':peaks', peaks);
  ctx.shadowBlur = 0;
}

/** LED matrix: columns of dots that light up from the bottom. */
function drawDotMatrix(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, config: NonNullable<Clip['visualizer']>, frequency: Uint8Array, store: Map<string, number[]>, id: string) {
  const cols = Math.max(12, Math.min(56, config.bars));
  const rows = 10;
  const smooth = Math.max(0.3, Math.min(0.9, config.smoothing ?? 0.55));
  const levels = bandLevels(frequency, cols, smooth, store.get(id) ?? []);
  store.set(id, levels);
  const x0 = cv.width * 0.25; const x1 = cv.width * 0.75; const gx = (x1 - x0) / (cols - 1);
  const gy = Math.min(gx * 1.1, cv.height * 0.022);
  const baseY = cv.height * (config.waveformY ?? 0.8);
  const radius = Math.max(1.5, Math.min(gx, gy) * 0.34);
  for (let i = 0; i < cols; i += 1) {
    const lit = Math.round(Math.min(1, (levels[i] ?? 0) * config.sensitivity * 1.2) * rows);
    for (let r = 0; r < rows; r += 1) {
      const on = r < lit;
      ctx.globalAlpha = on ? 1 : 0.14;
      ctx.fillStyle = r / rows > 0.7 ? config.secondaryColor : config.primaryColor;
      ctx.beginPath(); ctx.arc(x0 + i * gx, baseY - r * gy, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Expanding rings driven by the bass, around a pulsing core. */
function drawRipple(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, config: NonNullable<Clip['visualizer']>, frequency: Uint8Array, store: Map<string, number[]>, id: string) {
  const bands = bandLevels(frequency, 6, 0.6, store.get(id) ?? [], 0.08);
  store.set(id, bands);
  const bass = Math.min(1, ((bands[0] ?? 0) + (bands[1] ?? 0)) / 2 * config.sensitivity * 1.3);
  const cx = cv.width / 2; const cy = cv.height * (config.waveformY ?? 0.5);
  const base = Math.min(cv.width, cv.height) * config.radius;
  const t = performance.now() / 2600;
  ctx.lineWidth = Math.max(2, cv.width / 420);
  for (let i = 0; i < 4; i += 1) {
    const phase = (t + i / 4) % 1;
    ctx.globalAlpha = (1 - phase) * (0.25 + bass * 0.6);
    ctx.strokeStyle = i % 2 ? config.secondaryColor : config.primaryColor;
    ctx.beginPath(); ctx.arc(cx, cy, base * (1 + phase * 2.6 + bass * 0.3), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = gradientAcross(ctx, config, cx - base, cx + base);
  ctx.beginPath(); ctx.arc(cx, cy, base * (0.55 + bass * 0.35), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

/** Audio-free progress styles: line with knob, ring with percentage, segmented pill. */
function drawProgressStyle(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, c: Clip, frame: number, config: NonNullable<Clip['visualizer']>) {
  const p = Math.max(0, Math.min(1, (frame - c.start) / Math.max(1, c.duration)));
  const thick = Math.max(2, (config.borderWidth ?? 8) * (cv.height / 1080));
  const opacity = Math.max(0.1, Math.min(1, config.borderOpacity ?? 0.9));
  const y = cv.height * (config.waveformY ?? 0.94);
  if (config.type === 'progressline') {
    const x0 = cv.width * 0.06; const x1 = cv.width * 0.94; const w = x1 - x0;
    ctx.globalAlpha = opacity * 0.28; ctx.fillStyle = config.primaryColor;
    roundRect(ctx, x0, y - thick / 2, w, thick, thick / 2); ctx.fill();
    ctx.globalAlpha = opacity; ctx.fillStyle = gradientAcross(ctx, config, x0, x1);
    if (p > 0) { roundRect(ctx, x0, y - thick / 2, Math.max(thick, w * p), thick, thick / 2); ctx.fill(); }
    ctx.fillStyle = config.primaryColor;
    ctx.beginPath(); ctx.arc(x0 + Math.max(thick / 2, w * p), y, thick * 1.35, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  } else if (config.type === 'progresssegments') {
    const count = Math.max(8, Math.min(64, config.bars));
    const x0 = cv.width * 0.2; const x1 = cv.width * 0.8; const slot = (x1 - x0) / count; const segW = slot * 0.72; const segH = thick * 1.4;
    const filled = p * count;
    for (let i = 0; i < count; i += 1) {
      const amount = Math.max(0, Math.min(1, filled - i));
      ctx.fillStyle = i / count > 0.5 ? config.secondaryColor : config.primaryColor;
      ctx.globalAlpha = opacity * (0.2 + amount * 0.8);
      roundRect(ctx, x0 + i * slot, y - segH / 2, segW, segH, segW / 2); ctx.fill();
    }
  } else {
    const cx = cv.width / 2; const cy = y; const R = Math.min(cv.width, cv.height) * config.radius;
    ctx.lineWidth = thick; ctx.lineCap = 'round';
    ctx.globalAlpha = opacity * 0.25; ctx.strokeStyle = config.primaryColor;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = opacity; ctx.strokeStyle = config.primaryColor;
    if (p > 0) { ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.fillStyle = config.secondaryColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(R * 0.62)}px Arial, sans-serif`;
    ctx.fillText(`${Math.round(p * 100)}%`, cx, cy);
  }
  ctx.globalAlpha = 1;
}

/**
 * Lofi-style visualizer levels. Every position (left → right) is driven by its own slice of the spectrum
 * (log-spaced, treble-compensated) and lightly blended with its neighbours, so energy is spread evenly
 * across the whole width instead of piling up in the middle.
 */
export function dotLineLevels(frequency: Uint8Array, time: Uint8Array, count: number, smoothing: number, previous: number[]): number[] {
  const raw: number[] = [];
  const top = Math.max(4, frequency.length * 0.6);
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor(Math.pow(top, i / count));
    const to = Math.max(from + 1, Math.floor(Math.pow(top, (i + 1) / count)));
    let sum = 0;
    for (let k = from; k < to; k += 1) sum += frequency[k] ?? 0;
    const spectral = sum / (to - from) / 255;
    const tilt = 1 + 1.6 * (i / Math.max(1, count - 1)); // highs carry less energy: lift them
    const timeSample = Math.abs((time[Math.floor((i / count) * time.length)] ?? 128) - 128) / 128;
    raw[i] = Math.min(1, spectral * tilt * 0.88 + timeSample * 0.12);
  }
  const levels: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const blurred = ((raw[i - 1] ?? raw[i]!) + raw[i]! * 2 + (raw[i + 1] ?? raw[i]!)) / 4;
    levels[i] = (previous[i] ?? blurred) * smoothing + blurred * (1 - smoothing);
  }
  return levels;
}

const mixHex = (a: string, b: string, t: number) => {
  const pa = /^#?([0-9a-f]{6})$/i.exec(a)?.[1]; const pb = /^#?([0-9a-f]{6})$/i.exec(b)?.[1];
  if (!pa || !pb) return t > 0.5 ? b : a;
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const m = (i: number) => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t).toString(16).padStart(2, '0');
  return `#${m(0)}${m(2)}${m(4)}`;
};

/**
 * Lofi dotted-line visualizer: a row of small dots with thin round bars that swell out of them — small, then big, then small
 * again as a slow sequence travels along the line. Edge colour at both ends blends into the centre colour in the middle.
 */
function drawDotLine(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, config: NonNullable<Clip['visualizer']>, frequency: Uint8Array, time: Uint8Array, store: Map<string, number[]>, id: string, clock: number) {
  const box = visualizerBox(config, cv.width, cv.height);
  const baseY = box.cy;
  const startX = box.cx - box.w / 2;
  const count = Math.max(40, Math.min(160, config.bars));
  const gap = box.w / (count - 1);
  const dot = Math.max(1.6, cv.width / 760);
  const smooth = Math.max(0.35, Math.min(0.9, config.smoothing ?? 0.55));
  const levels = dotLineLevels(frequency, time, count, smooth, store.get(id) ?? []);
  store.set(id, levels);
  const reach = (config.radius ?? 0.28) / 0.28;
  const maxHalf = cv.height * 0.03 * reach;
  const t = clock / 1000;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, cv.width / 640);
  for (let i = 0; i < count; i += 1) {
    const u = i / (count - 1);
    const centre = 1 - Math.abs(u - 0.5) * 2; // 0 at the ends → 1 in the middle
    const color = mixHex(config.secondaryColor, config.primaryColor, Math.pow(centre, 0.8));
    const x = startX + i * gap;
    // two slow waves travelling in opposite directions make the bars grow and shrink in sequence
    const swell = 0.5 + 0.25 * Math.sin(i * 0.23 - t * 2.1) + 0.25 * Math.sin(i * 0.11 + t * 1.3);
    const level = Math.min(1, (levels[i] ?? 0) * config.sensitivity);
    const half = Math.pow(level, 1.35) * swell * 1.6 * maxHalf;
    ctx.globalAlpha = 0.45 + 0.55 * Math.pow(centre, 0.6);
    ctx.strokeStyle = ctx.fillStyle = color;
    if (half < dot * 1.4) {
      ctx.beginPath(); ctx.arc(x, baseY, dot, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(x, baseY - Math.min(half, maxHalf)); ctx.lineTo(x, baseY + Math.min(half, maxHalf)); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Design-space box (canvas px) a visualizer/progress clip occupies before its transform. Selection handles and scaling pivot on it. */
export function visualizerBox(config: NonNullable<Clip['visualizer']>, w: number, h: number): { cx: number; cy: number; w: number; h: number } {
  const y = h * (config.waveformY ?? 0.84);
  const R = Math.min(w, h) * config.radius;
  switch (config.type) {
    case 'dotline': return { cx: w / 2, cy: h * Math.max(0.55, Math.min(0.96, config.waveformY ?? 0.86)), w: w * 0.4, h: h * 0.07 * ((config.radius ?? 0.28) / 0.28) };
    case 'linewave': return { cx: w / 2, cy: h * Math.max(0.55, Math.min(0.96, config.waveformY ?? 0.84)), w: w * 0.44, h: h * 0.07 };
    case 'roundbars': return { cx: w / 2, cy: y - h * 0.06, w: w * 0.6, h: h * 0.3 };
    case 'dotmatrix': return { cx: w / 2, cy: y - h * 0.11, w: w * 0.5, h: h * 0.24 };
    case 'progressline': return { cx: w / 2, cy: y, w: w * 0.88, h: h * 0.03 };
    case 'progresssegments': return { cx: w / 2, cy: y, w: w * 0.6, h: h * 0.03 };
    case 'progressring': return { cx: w / 2, cy: y, w: R * 2.3, h: R * 2.3 };
    case 'ripple': return { cx: w / 2, cy: y, w: R * 7, h: R * 7 };
    case 'framepulse': return { cx: w / 2, cy: h / 2, w, h };
    case 'radial': case 'orbit': case 'countdown': return { cx: w / 2, cy: h / 2, w: R * 3.4, h: R * 3.4 };
    case 'heartbeat': case 'oscilloscope': return { cx: w / 2, cy: h / 2, w, h: R * 2 };
    default: return { cx: w / 2, cy: h * 0.72, w, h: h * 0.4 };
  }
}

/** Progress frame: a faint rounded track with a bright stroke that fills clockwise from the bottom-left corner. */
export function progressBorderGeometry(width: number, height: number) {
  const x = width * 0.012;
  const y = height * 0.018;
  const w = width * 0.976;
  const h = height * 0.964;
  const r = Math.min(width, height) * 0.035;
  const perimeter = 2 * (w + h - 4 * r) + 2 * Math.PI * r;
  return { x, y, w, h, r, perimeter };
}

/** Position and direction of the point `distance` px along the frame, clockwise from the bottom-left start. */
export function progressBorderPoint(g: ReturnType<typeof progressBorderGeometry>, distance: number): { x: number; y: number } {
  const { x, y, w, h, r } = g;
  const arc = (Math.PI * r) / 2;
  const segments: Array<{ len: number; at: (t: number) => { x: number; y: number } }> = [
    { len: h - 2 * r, at: (t) => ({ x, y: y + h - r - t }) },
    { len: arc, at: (t) => ({ x: x + r - r * Math.cos(t / r), y: y + r - r * Math.sin(t / r) }) },
    { len: w - 2 * r, at: (t) => ({ x: x + r + t, y }) },
    { len: arc, at: (t) => ({ x: x + w - r + r * Math.sin(t / r), y: y + r - r * Math.cos(t / r) }) },
    { len: h - 2 * r, at: (t) => ({ x: x + w, y: y + r + t }) },
    { len: arc, at: (t) => ({ x: x + w - r + r * Math.cos(t / r), y: y + h - r + r * Math.sin(t / r) }) },
    { len: w - 2 * r, at: (t) => ({ x: x + w - r - t, y: y + h }) },
    { len: arc, at: (t) => ({ x: x + r - r * Math.sin(t / r), y: y + h - r + r * Math.cos(t / r) }) },
  ];
  let left = ((distance % g.perimeter) + g.perimeter) % g.perimeter;
  for (const segment of segments) {
    if (left <= segment.len) return segment.at(left);
    left -= segment.len;
  }
  return { x, y: y + h - r };
}

function traceClockwiseFromBottomLeft(ctx: CanvasRenderingContext2D, g: ReturnType<typeof progressBorderGeometry>) {
  const { x, y, w, h, r } = g;
  ctx.beginPath();
  ctx.moveTo(x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.closePath();
}

function drawProgressBorder(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, c: Clip, frame: number, config: NonNullable<Clip['visualizer']>) {
  const g = progressBorderGeometry(cv.width, cv.height);
  const progress = Math.max(0, Math.min(1, (frame - c.start) / Math.max(1, c.duration)));
  const opacity = Math.max(0.04, Math.min(1, config.borderOpacity ?? 0.3));
  ctx.lineWidth = Math.max(1, config.borderWidth ?? 2);
  ctx.lineCap = 'round';
  ctx.strokeStyle = config.primaryColor;
  ctx.globalAlpha = opacity * 0.35;
  traceClockwiseFromBottomLeft(ctx, g);
  ctx.stroke();
  if (progress > 0) {
    ctx.globalAlpha = Math.min(1, opacity * 1.6);
    ctx.setLineDash([Math.max(0.01, g.perimeter * progress), g.perimeter * 2]);
    ctx.lineDashOffset = 0;
    traceClockwiseFromBottomLeft(ctx, g);
    ctx.stroke();
    ctx.setLineDash([]);
    // glowing head at the leading edge of the fill
    const head = progressBorderPoint(g, g.perimeter * progress);
    ctx.globalAlpha = Math.min(1, opacity * 2.2);
    ctx.fillStyle = config.primaryColor;
    ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(2, (config.borderWidth ?? 2) * 1.25), 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function mediaFilter(c: Clip, transitionBlur: number): string {
  const number = (type: string, fallback: number) => {
    const value = c.effects.find((effect) => effect.enabled && effect.type === type)?.params.value;
    return typeof value === 'number' ? value : fallback;
  };
  return `brightness(${Math.max(0, 1 + number('brightness', 0))}) contrast(${Math.max(0, number('contrast', 1))}) saturate(${Math.max(0, number('saturation', 1))}) hue-rotate(${number('hue', 0)}deg) grayscale(${Math.max(0, Math.min(1, number('grayscale', 0)))}) invert(${Math.max(0, Math.min(1, number('invert', 0)))}) blur(${Math.max(0, number('blur', 0) + transitionBlur)}px) sepia(${Math.max(0, Math.min(1, number('sepia', 0)))})`;
}

function effectNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, number));
}

function parseHexColor(value: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  if (!match) return { r: 0, g: 1, b: 0 };
  const hex = match[1]!;
  return { r: parseInt(hex.slice(0, 2), 16) / 255, g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 };
}

function mergeAnimation(base: TextAnimationFrame, next: TextAnimationFrame): TextAnimationFrame {
  return {
    opacity: base.opacity * next.opacity,
    x: base.x + next.x,
    y: base.y + next.y,
    scale: base.scale * next.scale,
    rotation: base.rotation + next.rotation,
    blur: base.blur + next.blur,
    letterSpacing: base.letterSpacing + next.letterSpacing,
  };
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, Math.min(Math.abs(width), Math.abs(height)) / 2));
  const maybeCtx = ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, width: number, height: number, radii?: number | number[]) => void };
  if (typeof maybeCtx.roundRect === 'function') {
    ctx.beginPath();
    maybeCtx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTextLine(ctx: CanvasRenderingContext2D, text: string, y: number, style: { align: CanvasTextAlign; letterSpacing: number; color: string; fill?: string | CanvasGradient; outline?: { color: string; width: number } }, spacing: number) {
  if (!spacing) {
    if (style.outline) { ctx.strokeStyle = style.outline.color; ctx.lineWidth = style.outline.width * 2; ctx.strokeText(text, 0, y); }
    ctx.fillStyle = style.fill ?? style.color;
    ctx.fillText(text, 0, y);
    return;
  }
  const widths = [...text].map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, text.length - 1) * spacing;
  let x = style.align === 'left' ? 0 : style.align === 'right' ? -total : -total / 2;
  ctx.textAlign = 'left';
  [...text].forEach((char, index) => {
    if (style.outline) { ctx.strokeStyle = style.outline.color; ctx.lineWidth = style.outline.width * 2; ctx.strokeText(char, x, y); }
    ctx.fillStyle = style.fill ?? style.color;
    ctx.fillText(char, x, y);
    x += (widths[index] ?? 0) + spacing;
  });
}

export const engine = new PlaybackEngine();



function seekTo(el: HTMLVideoElement, time: number, fast = false): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(time, Number.isFinite(el.duration) ? el.duration : time));
    if (el.readyState >= 2 && Math.abs(el.currentTime - target) < 0.0005) return resolve();
    if (fast && el.readyState >= 3 && Math.abs(el.currentTime - target) < 0.25 && 'requestVideoFrameCallback' in el) {
      let finished = false;
      const done = () => { if (finished) return; finished = true; resolve(); };
      el.requestVideoFrameCallback(() => done());
      el.currentTime = target;
      window.setTimeout(done, 80);
      return;
    }
    let finished = false;
    const done = () => { if (finished) return; finished = true; el.removeEventListener('seeked', done); resolve(); };
    el.addEventListener('seeked', done, { once: true });
    el.currentTime = target;
    // The fast export profile avoids getting stuck behind a slow seek event on
    // long recordings. WebCodecs only needs the decoded frame before the next
    // encode call; the normal profile keeps the more conservative timeout.
    window.setTimeout(done, fast ? 120 : 2500);
  });
}

/** Fold a clip's motion preset into its transition frame so blit() applies both. */
function withMotion(transition: TransitionFrame | undefined, clip: Clip, frame: number): TransitionFrame | undefined {
  if (!clip.animation) return transition;
  const m = evaluateMediaAnimation(clip, frame);
  const t = transition ?? { alpha: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0 };
  return { ...t, alpha: t.alpha * m.opacity, x: t.x + m.x, y: t.y + m.y, scale: t.scale * m.scale, rotation: t.rotation + m.rotation, blur: Math.max(t.blur, m.blur) };
}
