import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { buildEncodePlan, clipEnd, isProgressVisualizer, TRANSITION_PRESETS, type Project } from '../core';
import { getLoadedFontFile } from '../core/fonts';
import { getBlob } from './db';

const EXPORTABLE_EFFECTS = new Set([
  'brightness', 'contrast', 'saturation', 'exposure', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks',
  'hue', 'vibrance', 'gamma', 'lift', 'gain', 'vignette', 'filmGrain', 'blur', 'sharpen', 'glow',
  'chromaticAberration', 'rgbSplit', 'pixelation', 'noise', 'sepia', 'grayscale', 'invert', 'chromaKey', 'colorGrade', 'mask',
]);
const EXPORTABLE_TRANSITIONS = new Set(TRANSITION_PRESETS.map((preset) => preset.id));
const EXPORTABLE_TEXT_ANIMATIONS = new Set([
  'fade-in', 'fade-out', 'scale-pop', 'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'slide-up', 'slide-down',
  'flip-in', 'glitch-reveal', 'mask-wipe', 'pulse', 'floating', 'neon-flicker', 'shake', 'bounce', 'breathing',
  'glitch-loop', 'lower-third', 'caption-pop', 'glow-pulse', 'rubber-band', 'typewriter', 'letter-reveal', 'word-reveal',
  'per-character', 'per-word', 'animated-subtitles', 'text-on-path', 'kinetic-typography', 'rotation-3d', 'gradient-movement',
  'animated-gradient', 'caption-highlight', 'character-bounce', 'elastic-entrance', 'character-fall', 'rotate-in', 'rotate-away', 'wave', 'tracking-expansion', 'typewriter-loop',
  'slide-away-left', 'slide-away-right', 'blur-reveal', 'blur-out', 'text-mask', 'split-reveal', 'chromatic-glitch',
]);

export interface ExportProgress {
  phase: 'loading' | 'rendering' | 'complete';
  ratio: number;
}

export function canExportProject(project: Project): { ok: true } | { ok: false; reason: string } {
  const clips = Object.values(project.clips);
  if (!clips.length) return { ok: false, reason: 'Add at least one video, image, or audio clip to export.' };
  if (clips.some((clip) => !['video', 'image', 'audio', 'text', 'visualizer'].includes(clip.kind))) return { ok: false, reason: 'Effect clips need their export renderer before this project can be exported.' };
  if (clips.some((clip) => ['video', 'image', 'audio'].includes(clip.kind) && !clip.assetId)) return { ok: false, reason: 'Every media clip needs a source asset.' };
  const textClips = clips.filter((clip) => clip.kind === 'text');
  const visualizerClips = clips.filter((clip) => clip.kind === 'visualizer');
  if (visualizerClips.some((candidate) => !candidate.visualizer)) return { ok: false, reason: 'Every visualizer clip needs a visualizer configuration.' };
  if (visualizerClips.some((v) => !isProgressVisualizer(v.visualizer?.type ?? 'spectrum')) && !clips.some((source) => source.audio?.muted !== true && source.assetId && (source.kind === 'audio' || (source.kind === 'video' && project.assets[source.assetId]?.hasAudio)))) return { ok: false, reason: 'Visualizer clips need an audio or video source with audio.' };
  if (textClips.some((clip) => !clip.text || (clip.text.animationLoop && !EXPORTABLE_TEXT_ANIMATIONS.has(clip.text.animationLoop.presetId)) || (clip.text.animationIn && !EXPORTABLE_TEXT_ANIMATIONS.has(clip.text.animationIn.presetId)) || (clip.text.animationOut && !EXPORTABLE_TEXT_ANIMATIONS.has(clip.text.animationOut.presetId)))) return { ok: false, reason: 'This project contains a text animation whose export renderer is not available yet.' };
  if (clips.some((clip) => clip.effects.some((effect) => !EXPORTABLE_EFFECTS.has(effect.type)))) return { ok: false, reason: 'This project contains an effect that the FFmpeg exporter cannot render yet.' };
  if (clips.some((clip) => clip.transitionIn && !EXPORTABLE_TRANSITIONS.has(clip.transitionIn.type))) return { ok: false, reason: 'This project contains a transition whose export renderer is not available yet.' };
  if (clips.some((clip) => clip.audio.ducking?.enabled && !clip.audio.ducking.sidechainTrackId)) return { ok: false, reason: 'Enabled audio ducking needs a sidechain track.' };
  return { ok: true };
}

function exportExtension(asset: Project['assets'][string]): string {
  const mime = asset.mimeType.toLowerCase();
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave') return 'wav';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/mp4' || mime === 'audio/aac') return 'm4a';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm' || mime === 'audio/webm') return 'webm';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/svg+xml') return 'png';
  return mime.split('/')[1]?.split(';')[0] || 'media';
}

export { outputSize } from '../core';
import { outputSize } from '../core';

function fastRenderSize(output: { width: number; height: number }): { width: number; height: number } {
  // Keep the working canvas at the requested export dimensions. Rendering at
  // 960px and upscaling afterwards made text, gradients, transitions and
  // thumbnails visibly different from the editor preview.
  return { width: output.width, height: output.height };
}

async function backgroundFrame(project: Project, size: { width: number; height: number }): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the export background.');
  const background = project.settings.background;
  if (!background || background.type === 'solid') {
    ctx.fillStyle = background?.from ?? project.settings.backgroundColor;
  } else if (background.type === 'radial') {
    const gradient = ctx.createRadialGradient(size.width / 2, size.height / 2, 0, size.width / 2, size.height / 2, Math.max(size.width, size.height) / 1.2);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    ctx.fillStyle = gradient;
  } else {
    const angle = (background.angle * Math.PI) / 180;
    const x = Math.cos(angle) * size.width;
    const y = Math.sin(angle) * size.height;
    const gradient = ctx.createLinearGradient(size.width / 2 - x, size.height / 2 - y, size.width / 2 + x, size.height / 2 + y);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    ctx.fillStyle = gradient;
  }
  ctx.globalAlpha = background?.opacity ?? 1;
  ctx.fillRect(0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the export background.');
  return new Uint8Array(await blob.arrayBuffer());
}

function effectNumber(clip: Project['clips'][string], type: string, fallback: number): number {
  const effect = clip.effects.find((item) => item.type === type && item.enabled);
  return typeof effect?.params.value === 'number' ? effect.params.value : fallback;
}

function effectString(clip: Project['clips'][string], type: string, key: string, fallback: string): string {
  const effect = clip.effects.find((item) => item.type === type && item.enabled);
  return typeof effect?.params[key] === 'string' ? effect.params[key] as string : fallback;
}

function effectParamNumber(clip: Project['clips'][string], type: string, key: string, fallback: number): number {
  const effect = clip.effects.find((item) => item.type === type && item.enabled);
  return typeof effect?.params[key] === 'number' ? effect.params[key] as number : fallback;
}

function audioVolumeExpression(clip: Project['clips'][string], fps: number): string {
  const fallback = Math.max(0, Math.min(4, Number.isFinite(clip.audio?.volume) ? clip.audio.volume : 1));
  const keyframes = [...(clip.keyframes['audio.volume'] ?? [])].sort((a, b) => a.frame - b.frame);
  if (!keyframes.length) return String(fallback);
  const points = keyframes.map((keyframe) => ({ time: Math.max(0, keyframe.frame) / fps, value: Math.max(0, Math.min(4, keyframe.value)) }));
  let expression = String(points[points.length - 1]!.value);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const span = Math.max(0.0001, to.time - from.time);
    const interpolation = `${from.value}+(${to.value - from.value})*min(max((t-${from.time.toFixed(4)})/${span.toFixed(4)},0),1)`;
    expression = `if(lt(t\\,${to.time.toFixed(4)})\\,${interpolation}\\,${expression})`;
  }
  const first = points[0]!;
  return `if(lt(t\\,${first.time.toFixed(4)})\\,${first.value}\\,${expression})`;
}

function ffmpegMaskFilter(clip: Project['clips'][string]): string | null {
  const effect = clip.effects.find((item) => item.type === 'mask' && item.enabled);
  if (!effect) return null;
  const width = Math.max(0.05, Math.min(1, effectParamNumber(clip, 'mask', 'width', 0.86))).toFixed(4);
  const height = Math.max(0.05, Math.min(1, effectParamNumber(clip, 'mask', 'height', 0.86))).toFixed(4);
  const x = Math.max(-1, Math.min(1, effectParamNumber(clip, 'mask', 'x', 0))).toFixed(4);
  const y = Math.max(-1, Math.min(1, effectParamNumber(clip, 'mask', 'y', 0))).toFixed(4);
  const cx = `(W/2+W*${x}/2)`;
  const cy = `(H/2+H*${y}/2)`;
  const condition = effect.params.shape === 'rectangle'
    ? `between(X\,${cx}-W*${width}/2\,${cx}+W*${width}/2)*between(Y\,${cy}-H*${height}/2\,${cy}+H*${height}/2)`
    : `lte(pow((X-${cx})/(W*${width}/2)\,2)+pow((Y-${cy})/(H*${height}/2)\,2)\,1)`;
  return `geq=alpha_expr='if(${condition}\,255\,0)'`;
}

function ffmpegVideoEffects(clip: Project['clips'][string]): string[] {
  const filters: string[] = [];
  if (clip.effects.some((effect) => effect.type === 'brightness')) filters.push(`eq=brightness=${effectNumber(clip, 'brightness', 0)}`);
  if (clip.effects.some((effect) => effect.type === 'contrast')) filters.push(`eq=contrast=${Math.max(0, effectNumber(clip, 'contrast', 1))}`);
  if (clip.effects.some((effect) => effect.type === 'saturation')) filters.push(`eq=saturation=${Math.max(0, effectNumber(clip, 'saturation', 1))}`);
  if (clip.effects.some((effect) => effect.type === 'exposure')) filters.push(`eq=brightness=${effectNumber(clip, 'exposure', 0)}`);
  if (clip.effects.some((effect) => effect.type === 'gamma')) filters.push(`eq=gamma=${Math.max(0.1, effectNumber(clip, 'gamma', 1))}`);
  if (clip.effects.some((effect) => effect.type === 'vibrance')) filters.push(`vibrance=intensity=${effectNumber(clip, 'vibrance', 0)}`);
  if (clip.effects.some((effect) => effect.type === 'hue')) filters.push(`hue=h=${effectNumber(clip, 'hue', 0)}`);
  if (clip.effects.some((effect) => effect.type === 'grayscale')) filters.push('hue=s=0');
  if (clip.effects.some((effect) => effect.type === 'invert')) filters.push('negate');
  const blur = effectNumber(clip, 'blur', 0);
  if (blur > 0) filters.push(`boxblur=luma_radius=${Math.max(1, Math.round(blur))}:luma_power=1`);
  const sepia = Math.max(0, Math.min(1, effectNumber(clip, 'sepia', 0)));
  if (sepia > 0) {
    const mix = (normal: number, toned: number) => (normal * (1 - sepia) + toned * sepia).toFixed(4);
    filters.push(`colorchannelmixer=rr=${mix(1, 0.393)}:rg=${mix(0, 0.769)}:rb=${mix(0, 0.189)}:gr=${mix(0, 0.349)}:gg=${mix(1, 0.686)}:gb=${mix(0, 0.168)}:br=${mix(0, 0.272)}:bg=${mix(0, 0.534)}:bb=${mix(1, 0.131)}`);
  }
  const temperature = effectNumber(clip, 'temperature', 0);
  const tint = effectNumber(clip, 'tint', 0);
  const shadows = effectNumber(clip, 'shadows', 0);
  const highlights = effectNumber(clip, 'highlights', 0);
  const lift = effectNumber(clip, 'lift', 0);
  const gain = effectNumber(clip, 'gain', 0);
  if ([temperature, tint, shadows, highlights, lift, gain].some((value) => value !== 0)) {
    filters.push(`colorbalance=rs=${(temperature * 0.3 + shadows * 0.2 + lift * 0.1).toFixed(4)}:gs=${(tint * 0.2 + shadows * 0.05).toFixed(4)}:bs=${(-temperature * 0.3 + shadows * 0.1 - lift * 0.1).toFixed(4)}:rh=${(temperature * 0.3 + highlights * 0.2 + gain * 0.1).toFixed(4)}:gh=${(tint * 0.2 + highlights * 0.05).toFixed(4)}:bh=${(-temperature * 0.3 + highlights * 0.1 + gain * 0.1).toFixed(4)}`);
  }
  const whites = effectNumber(clip, 'whites', 0);
  const blacks = effectNumber(clip, 'blacks', 0);
  if (whites || blacks) filters.push(`eq=brightness=${(whites * 0.08 + blacks * 0.08).toFixed(4)}:contrast=${Math.max(0.1, 1 + whites * 0.12 - blacks * 0.12).toFixed(4)}`);
  const vignette = effectNumber(clip, 'vignette', 0);
  if (vignette > 0) filters.push(`vignette=PI/${Math.max(2, Math.round(8 - vignette * 6))}`);
  const sharpen = effectNumber(clip, 'sharpen', 0);
  if (sharpen > 0) filters.push(`unsharp=5:5:${Math.min(5, sharpen * 5).toFixed(2)}:5:5:0`);
  const glow = effectNumber(clip, 'glow', 0);
  if (glow > 0) filters.push(`gblur=sigma=${Math.max(0.1, glow * 8).toFixed(2)}`);
  const rgbShift = Math.round(Math.max(0, Math.min(20, effectNumber(clip, 'chromaticAberration', effectNumber(clip, 'rgbSplit', 0)) * 8)));
  if (rgbShift > 0) filters.push(`rgbashift=rh=${rgbShift}:rv=0:gh=${-rgbShift}:gv=0:bh=0:bv=0`);
  const pixelation = effectNumber(clip, 'pixelation', 0);
  if (pixelation > 0) {
    const block = Math.max(2, Math.round(2 + pixelation * 30));
    filters.push(`scale=iw/${block}:ih/${block}:flags=neighbor,scale=iw*${block}:ih*${block}:flags=neighbor`);
  }
  const noise = Math.max(effectNumber(clip, 'noise', 0), effectNumber(clip, 'filmGrain', 0));
  if (noise > 0) filters.push(`noise=alls=${Math.round(Math.min(100, noise * 60))}:allf=t+u`);
  if (clip.effects.some((effect) => effect.type === 'chromaKey' && effect.enabled)) {
    const color = effectString(clip, 'chromaKey', 'color', '#00ff00').replace('#', '0x');
    const similarity = Math.max(0.01, Math.min(1, effectParamNumber(clip, 'chromaKey', 'similarity', 0.28)));
    const blend = Math.max(0.001, Math.min(1, effectParamNumber(clip, 'chromaKey', 'smoothness', 0.08)));
    filters.push(`colorkey=${color}:${similarity}:${blend}`);
  }
  if (clip.effects.some((effect) => effect.type === 'colorGrade' && effect.enabled)) {
    const temperature = effectParamNumber(clip, 'colorGrade', 'temperature', 0);
    const tint = effectParamNumber(clip, 'colorGrade', 'tint', 0);
    const shadows = effectParamNumber(clip, 'colorGrade', 'shadows', 0);
    const highlights = effectParamNumber(clip, 'colorGrade', 'highlights', 0);
    const vignette = effectParamNumber(clip, 'colorGrade', 'vignette', 0);
    filters.push(`colorbalance=rs=${(temperature * 0.3 + shadows * 0.2).toFixed(4)}:gs=${(tint * 0.2 + shadows * 0.05).toFixed(4)}:bs=${(-temperature * 0.3 + shadows * 0.1).toFixed(4)}:rh=${(temperature * 0.3 + highlights * 0.2).toFixed(4)}:gh=${(tint * 0.2 + highlights * 0.05).toFixed(4)}:bh=${(-temperature * 0.3 + highlights * 0.1).toFixed(4)}`);
    if (vignette > 0) filters.push(`vignette=PI/${Math.max(2, Math.round(8 - vignette * 6))}`);
  }
  return filters;
}

function ffmpegText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%').replace(/\n/g, '\\n');
}

function textFontFile(text: NonNullable<Project['clips'][string]['text']>, importedFonts: Map<string, string>): string {
  const family = text.style.fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return importedFonts.get(family ?? '') ?? 'f4-export-font.ttf';
}

function ffmpegColor(value: string): string {
  // FFmpeg accepts 6- and 8-digit hexadecimal colors. The editor commonly
  // stores translucent fills as #RRGGBBAA; rejecting those used to turn a
  // black text panel into an opaque white box in the export.
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{8}$/i.test(value)) return `0x${value.slice(1)}`;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const expanded = value.slice(1).split('').map((channel) => channel + channel).join('');
    return `#${expanded}`;
  }
  return '#ffffff';
}

function gradientColor(text: Project['clips'][string]['text'], index: number, count: number): string | null {
  const gradient = text?.style.gradient;
  if (!gradient) return null;
  const parse = (value: string) => {
    const match = value.match(/^#([0-9a-f]{6})$/i);
    return match ? [Number.parseInt(match[1]!.slice(0, 2), 16), Number.parseInt(match[1]!.slice(2, 4), 16), Number.parseInt(match[1]!.slice(4, 6), 16)] : null;
  };
  const from = parse(gradient.from);
  const to = parse(gradient.to);
  if (!from || !to) return null;
  const amount = count <= 1 ? 0.5 : Math.max(0, Math.min(1, index / (count - 1)));
  return `#${from.map((channel, channelIndex) => Math.round(channel + (to[channelIndex]! - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function ffmpegTextColor(text: Project['clips'][string]['text'], gradientIndex = 0, gradientCount = 1): string {
  const gradient = gradientColor(text, gradientIndex, gradientCount);
  if (gradient) return `fontcolor=${gradient}`;
  const preset = text?.animationIn?.presetId ?? text?.animationLoop?.presetId;
  if (preset !== 'gradient-movement' && preset !== 'animated-gradient' && preset !== 'caption-highlight') return `fontcolor=${ffmpegColor(text?.style.color ?? '#ffffff')}`;
  const phase = preset === 'caption-highlight' ? 't*3.2' : 't*1.8';
  return `fontcolor_expr=0x%{eif\\:255*(0.5+0.5*sin(${phase}))\\:x\\:2}%{eif\\:255*(0.5+0.5*sin(${phase}+2.094))\\:x\\:2}%{eif\\:255*(0.5+0.5*sin(${phase}+4.188))\\:x\\:2}`;
}

function ffmpegTextDecorations(text: Project['clips'][string]['text'], scale: number): string {
  const style = text?.style;
  if (!style) return '';
  const outline = style.outline ? `:borderw=${Math.max(1, Math.round(style.outline.width * scale))}:bordercolor=${ffmpegColor(style.outline.color)}` : '';
  // FFmpeg 5.1's drawtext filter supports offset/color shadows, but not shadowblur.
  const shadow = style.shadow ? `:shadowx=${Math.round(style.shadow.offsetX * scale)}:shadowy=${Math.round(style.shadow.offsetY * scale)}:shadowcolor=${ffmpegColor(style.shadow.color)}` : '';
  return `${outline}${shadow}`;
}

function atempoFilters(speed: number): string[] {
  let remaining = Math.max(0.0625, speed);
  const filters: string[] = [];
  while (remaining > 2) { filters.push('atempo=2'); remaining /= 2; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 0.001) filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters;
}

function ffmpegAudioEffects(clip: Project['clips'][string]): string[] {
  const processing = clip.audio.processing;
  if (!processing) return [];
  const filters: string[] = [];
  if (processing.eqLow) filters.push(`equalizer=f=160:width_type=o:width=1:g=${processing.eqLow.toFixed(2)}`);
  if (processing.eqMid) filters.push(`equalizer=f=1000:width_type=o:width=1:g=${processing.eqMid.toFixed(2)}`);
  if (processing.eqHigh) filters.push(`equalizer=f=4200:width_type=o:width=1:g=${processing.eqHigh.toFixed(2)}`);
  if (processing.compressor > 0) filters.push(`acompressor=threshold=${(-8 - processing.compressor * 32).toFixed(2)}dB:ratio=${(1 + processing.compressor * 11).toFixed(2)}:attack=20:release=180`);
  if (processing.limiter > 0) filters.push(`alimiter=limit=${(1 - processing.limiter * 0.65).toFixed(3)}:attack=1:release=50`);
  if (processing.echo > 0) {
    const delay = Math.round(160 + processing.echo * 320);
    filters.push(`aecho=1:1:${delay}:${(processing.echo * 0.45).toFixed(3)}`);
  }
  if (processing.reverb > 0) {
    const delays = `${Math.round(37 + processing.reverb * 35)}|${Math.round(71 + processing.reverb * 55)}|${Math.round(113 + processing.reverb * 80)}`;
    const decays = `${(processing.reverb * 0.24).toFixed(3)}|${(processing.reverb * 0.16).toFixed(3)}|${(processing.reverb * 0.1).toFixed(3)}`;
    filters.push(`aecho=1:1:${delays}:${decays}`);
  }
  return filters;
}

function pitchFilters(clip: Project['clips'][string], sampleRate: number): string[] {
  if (!clip.audio.pitchSemitones) return [];
  const factor = Math.pow(2, Math.max(-24, Math.min(24, clip.audio.pitchSemitones)) / 12);
  return [`asetrate=${Math.max(8000, Math.round(sampleRate * factor))}`, `aresample=${Math.round(sampleRate)}`, ...atempoFilters(1 / factor)];
}

async function sourceSampleRate(blob: Blob): Promise<number> {
  const AudioContextCtor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AudioContextCtor) return 48000;
  let context: AudioContext | undefined;
  try {
    context = new AudioContextCtor();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return buffer.sampleRate || 48000;
  } catch {
    return 48000;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

function transitionPreset(clip: Project['clips'][string]) {
  return clip.transitionIn ? TRANSITION_PRESETS.find((preset) => preset.id === clip.transitionIn?.type) : undefined;
}

function ffmpegTransitionFilters(clip: Project['clips'][string], start: number, duration: number, size: { width: number; height: number }): string[] {
  const preset = transitionPreset(clip);
  if (!preset) return [];
  const intensity = Math.max(0, Math.min(2, clip.transitionIn?.intensity ?? 1));
  const progress = `min(max((t-${start})/${Math.max(0.01, duration)},0),1)`;
  if (preset.behavior === 'zoom') {
    const amount = Math.max(0.08, 0.65 * intensity);
    const expression = preset.id === 'zoom-out' ? `1+(${progress})*${amount}` : `1+(1-${progress})*${amount}`;
    return [`scale=w='iw*(${expression})':h='ih*(${expression})':eval=frame`, `crop=w=${size.width}:h=${size.height}:x='(iw-ow)/2':y='(ih-oh)/2'`];
  }
  if (preset.behavior === 'spin') {
    return [`rotate=a='(1-${progress})*2*PI*${intensity}':ow='rotw(iw)':oh='roth(ih)':c=none`];
  }
  if (preset.behavior === 'blur') return ['boxblur=luma_radius=16:luma_power=1'];
  if (preset.behavior === 'glitch') return ['rgbashift=rh=5:gh=-5:bh=3'];
  if (preset.behavior === 'mosaic') return ['scale=iw/24:ih/24:flags=neighbor', 'scale=iw*24:ih*24:flags=neighbor'];
  if (preset.behavior === 'burn') return ['eq=brightness=0.25:saturation=1.35', 'colorbalance=rs=0.2:gs=0.05:bs=-0.1'];
  return [];
}

function ffmpegTransitionAlpha(clip: Project['clips'][string], start: number, duration: number): string | null {
  const preset = transitionPreset(clip);
  if (!preset || preset.behavior !== 'wipe') return null;
  const p = `min(max((t-${start})/${Math.max(0.01, duration)},0),1)`;
  const condition = preset.id === 'circular-wipe' || preset.id === 'iris'
    ? `lte(pow((X-W/2)/(W/2)\,2)+pow((Y-H/2)/(H/2)\,2)\,${p}*${p})`
    : preset.direction === 'left'
      ? `gte(X\,W*(1-${p}))`
      : preset.direction === 'up'
        ? `gte(Y\,H*(1-${p}))`
        : preset.direction === 'down'
          ? `lte(Y\,H*${p})`
          : `lte(X\,W*${p})`;
  return `geq=alpha_expr='if(${condition}\,255\,0)'`;
}

function ffmpegVisualizerFilter(type: NonNullable<Project['clips'][string]['visualizer']>['type'], size: { width: number; height: number }, fps: number): string {
  const canvas = `${size.width}x${size.height}`;
  // Render the reactive layer at a smaller working size, then key out its black
  // background so it behaves like the transparent canvas preview.
  const working = `${Math.min(size.width, 960)}x${Math.min(size.height, 540)}`;
  const source = type === 'dotline' || type === 'roundbars'
    ? `showwaves=s=${Math.round(Math.min(size.width, 960) * 0.4)}x${Math.round(Math.min(size.height, 540) * 0.15)}:mode=cline:draw=full:scale=sqrt:colors=white:r=${fps}`
    : type === 'linewave'
    ? `showwaves=s=${working}:mode=line:draw=full:scale=sqrt:r=${fps}`
    : type === 'oscilloscope'
      ? `showwaves=s=${working}:mode=line:draw=full:scale=sqrt:r=${fps}`
      : type === 'radial'
        ? `avectorscope=s=${working}:mode=polar:draw=line:scale=lin:r=${fps}`
        : `showspectrum=s=${working}:mode=${type === 'mirrored' ? 'separate' : 'combined'}:color=rainbow:scale=sqrt:slide=replace`;
  if (type === 'dotline' || type === 'roundbars') {
    const stripW = Math.round(size.width * (type === 'roundbars' ? 0.6 : 0.4));
    const stripH = Math.round(size.height * (type === 'roundbars' ? 0.2 : 0.15));
    return `${source},format=rgba,colorkey=0x000000:0.08:0.03,scale=${stripW}:${stripH}:flags=bilinear,pad=${size.width}:${size.height}:${Math.round((size.width - stripW) / 2)}:${Math.round(size.height * 0.86 - stripH / 2)}:color=0x00000000`;
  }
  return `${source},format=rgba,colorkey=0x000000:0.08:0.03,scale=${canvas}:flags=bilinear`;
}

type VisualizerConfig = NonNullable<Project['clips'][string]['visualizer']>;

/** Audio-free progress layers (line, segments, ring) as transparent RGBA sources built with geq. */
export function ffmpegProgressStyleSource(config: VisualizerConfig, size: { width: number; height: number }, fps: number, duration: number): string {
  if (config.type === 'framepulse') return ffmpegProgressBorderSource(config, size, fps, duration);
  const scale = Math.min(1, 960 / size.width);
  const W = Math.max(64, Math.round(size.width * scale));
  const H = Math.max(64, Math.round(size.height * scale));
  const th = Math.max(2, Math.round(((config.borderWidth ?? 8) * H) / 1080));
  const opacity = Math.max(0.1, Math.min(1, config.borderOpacity ?? 0.9));
  const track = Math.round(255 * opacity * 0.28);
  const fill = Math.round(255 * opacity);
  const cy = Math.round(H * (config.waveformY ?? 0.94));
  const p = `min(1,T/${Math.max(0.01, duration)})`;
  let expr: string;
  if (config.type === 'progressline') {
    const x0 = Math.round(W * 0.06); const x1 = Math.round(W * 0.94);
    expr = `if(gte(Y,${cy - th / 2})*lte(Y,${cy + th / 2})*gte(X,${x0})*lte(X,${x1}),if(lte(X,${x0}+${x1 - x0}*${p}),${fill},${track}),0)`;
  } else if (config.type === 'progresssegments') {
    const n = Math.max(8, Math.min(64, config.bars));
    const x0 = Math.round(W * 0.2); const x1 = Math.round(W * 0.8); const slot = (x1 - x0) / n; const segH = th * 1.4;
    expr = `if(gte(Y,${cy - segH / 2})*lte(Y,${cy + segH / 2})*gte(X,${x0})*lte(X,${x1})*lt(mod(X-${x0},${slot}),${slot * 0.72}),if(lt(floor((X-${x0})/${slot}),${n}*${p}),${fill},${track}),0)`;
  } else {
    const cx = Math.round(W / 2); const R = Math.round(Math.min(W, H) * config.radius);
    const angle = `(atan2(X-${cx},${cy}-Y)+if(lt(atan2(X-${cx},${cy}-Y),0),2*PI,0))/(2*PI)`;
    expr = `if(lte(abs(hypot(X-${cx},Y-${cy})-${R}),${th / 2}),if(lte(${angle},${p}),${fill},${track}),0)`;
  }
  const { r, g, b } = hexToRgb(config.primaryColor);
  return `color=c=black@0:s=${W}x${H}:r=${fps}:d=${duration},format=rgba,geq=r=${r}:g=${g}:b=${b}:a='${expr.replace(/,/g, '\\,')}',scale=${size.width}:${size.height}:flags=bilinear`;
}

function hexToRgb(value: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const hex = match ? match[1]! : 'ffffff';
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

/**
 * Progress frame that fills clockwise from the bottom-left corner, generated
 * as a transparent RGBA layer (no audio needed). Mirrors the preview renderer.
 */
export function ffmpegProgressBorderSource(config: VisualizerConfig, size: { width: number; height: number }, fps: number, duration: number): string {
  const scale = Math.min(1, 960 / size.width);
  const W = Math.max(64, Math.round(size.width * scale));
  const H = Math.max(64, Math.round(size.height * scale));
  const x0 = Math.round(W * 0.012);
  const y0 = Math.round(H * 0.018);
  const w = Math.round(W * 0.976);
  const h = Math.round(H * 0.964);
  const bw = Math.max(1, Math.round((config.borderWidth ?? 2) * scale));
  const perimeter = 2 * (w + h);
  const opacity = Math.max(0.04, Math.min(1, config.borderOpacity ?? 0.3));
  const track = Math.round(255 * opacity * 0.35);
  const fill = Math.round(255 * Math.min(1, opacity * 1.6));
  const inOuter = `gte(X,${x0})*lte(X,${x0 + w})*gte(Y,${y0})*lte(Y,${y0 + h})`;
  const inInner = `gte(X,${x0 + bw})*lte(X,${x0 + w - bw})*gte(Y,${y0 + bw})*lte(Y,${y0 + h - bw})`;
  const along = `if(lt(X,${x0 + bw}),${y0 + h}-Y,if(lt(Y,${y0 + bw}),${h}+X-${x0},if(gt(X,${x0 + w - bw}),${h + w}+Y-${y0},${2 * h + w + x0 + w}-X)))`;
  const alpha = `if(${inOuter}*(1-${inInner}),if(lte(${along},${perimeter}*min(1,T/${Math.max(0.01, duration)})),${fill},${track}),0)`.replace(/,/g, '\\,');
  const { r, g, b } = hexToRgb(config.primaryColor);
  return `color=c=black@0:s=${W}x${H}:r=${fps}:d=${duration},format=rgba,geq=r=${r}:g=${g}:b=${b}:a='${alpha}',scale=${size.width}:${size.height}:flags=bilinear`;
}

interface TextAnimationExpressions { alpha: string; x: string; y: string; scale: string }

function textAnimationExpressions(clip: Project['clips'][string], start: number, end: number, fps: number): TextAnimationExpressions {
  const text = clip.text;
  if (!text) return { alpha: '1', x: '0', y: '0', scale: '1' };
  const alpha: string[] = [];
  const x: string[] = [];
  const y: string[] = [];
  const scale: string[] = [];
  const apply = (presetId: string, durationFrames: number, reverse: boolean) => {
    const duration = Math.max(0.01, durationFrames / fps);
    const p = reverse ? `min(max((${end}-t)/${duration}\,0)\,1)` : `min(max((t-${start})/${duration}\,0)\,1)`;
    const loop = `((t-${start})/${duration})`;
    if (presetId === 'fade-in' || presetId === 'fade-out' || presetId === 'glitch-reveal' || presetId === 'mask-wipe' || presetId === 'text-mask' || presetId === 'split-reveal' || presetId === 'blur-reveal' || presetId === 'blur-out') alpha.push(p);
    if (presetId === 'scale-pop' || presetId === 'zoom-in' || presetId === 'caption-pop' || presetId === 'glow-pulse') { scale.push(`(0.65+${p}*0.35)`); alpha.push(p); }
    if (presetId === 'zoom-out') { scale.push(`(1.35-${p}*0.35)`); alpha.push(p); }
    if (presetId === 'slide-left' || presetId === 'slide-away-left' || presetId === 'lower-third') { x.push(`((1-${p})*-0.35*main_w)`); alpha.push(p); }
    if (presetId === 'slide-right' || presetId === 'slide-away-right') { x.push(`((1-${p})*0.35*main_w)`); alpha.push(p); }
    if (presetId === 'slide-up') { y.push(`((1-${p})*-0.25*main_h)`); alpha.push(p); }
    if (presetId === 'slide-down') { y.push(`((1-${p})*0.25*main_h)`); alpha.push(p); }
    if (presetId === 'flip-in') { scale.push(`max(0.05\,sin(${p}*PI/2))`); alpha.push(p); }
    if (presetId === 'pulse' || presetId === 'breathing' || presetId === 'rubber-band') scale.push(`(1+sin(${loop}*PI*2)*0.04)`);
    if (presetId === 'floating') y.push(`sin(${loop}*PI*2)*0.04*main_h`);
    if (presetId === 'neon-flicker') alpha.push(`(0.7+(sin(${loop}*71)+1)*0.15)`);
    if (presetId === 'shake' || presetId === 'glitch-loop') { x.push(`sin(${loop}*PI*16)*0.025*main_w`); y.push(`cos(${loop}*PI*13)*0.025*main_h`); }
    if (presetId === 'bounce' || presetId === 'character-bounce' || presetId === 'elastic-entrance' || presetId === 'character-fall') { y.push(`sin(${p}*PI)*-0.08*main_h`); scale.push(`(0.85+sin(${p}*PI)*0.15)`); }
  };
  if (text.animationIn) apply(text.animationIn.presetId, text.animationIn.durationFrames, false);
  if (text.animationOut) apply(text.animationOut.presetId, text.animationOut.durationFrames, true);
  if (text.animationLoop) apply(text.animationLoop.presetId, text.animationLoop.durationFrames, false);
  const transition = transitionPreset(clip);
  if (transition && clip.transitionIn) {
    const duration = Math.max(0.01, clip.transitionIn.durationFrames / fps);
    const p = `min(max((t-${start})/${duration}\\,0)\\,1)`;
    alpha.push(p);
    const intensity = Math.max(0, Math.min(2, clip.transitionIn.intensity));
    if (transition.behavior === 'slide' || transition.behavior === 'push') {
      if (transition.direction === 'left') x.push(`((1-${p})*-0.35*main_w*${intensity})`);
      if (transition.direction === 'right') x.push(`((1-${p})*0.35*main_w*${intensity})`);
      if (transition.direction === 'up') y.push(`((1-${p})*-0.25*main_h*${intensity})`);
      if (transition.direction === 'down') y.push(`((1-${p})*0.25*main_h*${intensity})`);
    }
    if (transition.behavior === 'zoom') scale.push(`(${1.35 - intensity * 0.35}+${p}*${intensity * 0.35})`);
  }
  return { alpha: alpha.length ? alpha.join('*') : '1', x: x.length ? x.join('+') : '0', y: y.length ? y.join('+') : '0', scale: scale.length ? scale.join('*') : '1' };
}

interface TextRevealSegment { text: string; start: number; end: number; enable: string }

function textRevealSegments(clip: Project['clips'][string], start: number, fps: number): TextRevealSegment[] {
  const text = clip.text;
  const ref = text?.animationIn ?? (text?.animationLoop?.presetId === 'typewriter-loop' ? text.animationLoop : undefined);
  if (!text || !ref || !['typewriter', 'letter-reveal', 'word-reveal', 'per-character', 'per-word', 'animated-subtitles', 'typewriter-loop'].includes(ref.presetId)) return [];
  const wordMode = ['word-reveal', 'per-word'].includes(ref.presetId);
  const parts = wordMode ? text.text.trim().split(/\s+/) : Array.from(text.text);
  if (!parts.length || !parts.some(Boolean)) return [];
  const duration = Math.max(0.01, ref.durationFrames / fps);
  const looping = ref.presetId === 'typewriter-loop';
  return parts.map((_, index) => {
    const segmentStart = duration * index / parts.length;
    const segmentEnd = duration * (index + 1) / parts.length;
    return {
      text: wordMode ? parts.slice(0, index + 1).join(' ') : parts.slice(0, index + 1).join(''),
      start: looping ? start : start + segmentStart,
      end: looping ? (clip.start + clip.duration) / fps : start + segmentEnd,
      enable: looping ? `between(mod(t-${start}\,${duration})\,${segmentStart}\,${segmentEnd})` : `between(t\,${start + segmentStart}\,${start + segmentEnd})`,
    };
  });
}

function textPathCharacters(clip: Project['clips'][string]): string[] {
  const presetId = clip.text?.animationIn?.presetId;
  if (presetId !== 'text-on-path' && presetId !== 'kinetic-typography' && !['rotation-3d', 'rotate-in', 'rotate-away', 'wave', 'tracking-expansion'].includes(presetId ?? '') && !(clip.text?.style.letterSpacing) && !clip.text?.style.gradient) return [];
  return Array.from(clip.text?.text ?? '').filter((character) => character !== '\n');
}

/** Render a supported project using the real FFmpeg.wasm worker and return its MP4 bytes. */
export async function exportProject(project: Project, onProgress?: (progress: ExportProgress) => void, signal?: AbortSignal): Promise<Blob> {
  const supported = canExportProject(project);
  if (!supported.ok) throw new Error(supported.reason);
  const clips = Object.values(project.clips);
  const trackOrder = new Map(project.tracks.map((track, index) => [track.id, index] as const));
  // The first timeline lane is the top-most compositing layer. FFmpeg overlays
  // are built bottom-to-top, so render higher-index lanes first.
  const bottomToTop = (a: Project['clips'][string], b: Project['clips'][string]) => (trackOrder.get(b.trackId) ?? 0) - (trackOrder.get(a.trackId) ?? 0);
  const visibleTrackIds = new Set(project.tracks.filter((track) => track.visible).map((track) => track.id));
  const visualizerClips = clips.filter((clip) => clip.kind === 'visualizer' && visibleTrackIds.has(clip.trackId)).sort(bottomToTop);
  const media = clips.filter((clip) => (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') && visibleTrackIds.has(clip.trackId)).sort(bottomToTop);
  const assets = await Promise.all(media.map(async (clip) => {
    const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
    if (!asset) throw new Error(`Source asset is missing for ${clip.name}.`);
    const blob = await getBlob(asset.blobKey);
    if (!blob) throw new Error(`Source media is no longer available for ${clip.name}.`);
    return { clip, asset, blob };
  }));
  const sampleRates = new Map<string, number>();
  for (const item of assets) if (item.clip.audio.pitchSemitones) sampleRates.set(item.clip.id, await sourceSampleRate(item.blob));

  const ffmpeg = new FFmpeg();
  let cancelled = false;
  const ffmpegLogs: string[] = [];
  const cancel = () => { cancelled = true; ffmpeg.terminate(); };
  signal?.addEventListener('abort', cancel, { once: true });
  const onFfmpegProgress = ({ progress }: { progress: number }) => onProgress?.({ phase: 'rendering', ratio: Math.min(0.99, Math.max(0, progress)) });
  const onFfmpegLog = ({ message }: { message: string }) => {
    if (message) {
      ffmpegLogs.push(message);
      if (ffmpegLogs.length > 8) ffmpegLogs.shift();
    }
  };
  ffmpeg.on('progress', onFfmpegProgress);
  ffmpeg.on('log', onFfmpegLog);
  try {
    onProgress?.({ phase: 'loading', ratio: 0 });
    // The editor is shipped as a static index.html. Keep the large FFmpeg
    // runtime out of the project folder and fetch it only when export starts.
    // All composition work still happens in-browser; Node is not required at
    // runtime.
    const runtimeAsset = (name: string) => name === 'ffmpeg-core.js' || name === 'ffmpeg-core.wasm'
      ? `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/${name}`
      : new URL(name, document.baseURI).href;
    let coreURL: string;
    let wasmURL: string;
    try {
      coreURL = await toBlobURL(runtimeAsset('ffmpeg-core.js'), 'text/javascript');
      wasmURL = await toBlobURL(runtimeAsset('ffmpeg-core.wasm'), 'application/wasm');
    } catch {
      throw new Error('FFmpeg runtime files could not be loaded. Restart the dev server and try export again.');
    }
    await ffmpeg.load({
      coreURL,
      wasmURL,
    }, { signal });
    if (cancelled) throw new DOMException('Export cancelled', 'AbortError');
    const fontResponse = await fetch(runtimeAsset('f4-export-font.ttf'));
    if (!fontResponse.ok) throw new Error(`Export font could not be loaded (HTTP ${fontResponse.status}).`);
    await ffmpeg.writeFile('f4-export-font.ttf', new Uint8Array(await fontResponse.arrayBuffer()), { signal });
    const importedFonts = new Map<string, string>();
    let importedFontIndex = 0;
    for (const clip of clips) {
      if (clip.kind !== 'text' || !clip.text) continue;
      const family = clip.text.style.fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
      if (!family || importedFonts.has(family)) continue;
      const bytes = getLoadedFontFile(clip.text.style.fontFamily);
      if (!bytes) continue;
      const filename = `f4-imported-font-${importedFontIndex++}.ttf`;
      await ffmpeg.writeFile(filename, bytes, { signal });
      importedFonts.set(family, filename);
    }
    const totalDuration = Math.max(0.01, Math.max(...clips.map(clipEnd)) / project.settings.fps);
    const outputDimensions = outputSize(project);
    // Render the filter graph at the requested output size so the exported
    // composition has the same geometry and sharpness as the preview.
    const size = fastRenderSize(outputDimensions);
    const inputNames = assets.map(({ asset }, index) => `input-${index}.${exportExtension(asset)}`);
    for (const [index, item] of assets.entries()) {
      const inputName = inputNames[index];
      if (!inputName) throw new Error('Could not create an FFmpeg input name.');
      await ffmpeg.writeFile(inputName, new Uint8Array(await item.blob.arrayBuffer()), { signal });
    }
    const backgroundBytes = await backgroundFrame(project, size);
    await ffmpeg.writeFile('f4-export-background.png', backgroundBytes, { signal });
    const args: string[] = ['-threads', '0', '-filter_threads', '0', '-filter_complex_threads', '0', '-loop', '1', '-i', 'f4-export-background.png'];
    assets.forEach(({ asset }, index) => {
      const inputName = inputNames[index];
      if (!inputName) return;
      if (asset.kind === 'image') args.push('-loop', '1');
      args.push('-i', inputName);
    });
    const filters: string[] = [`[0:v]setpts=PTS-STARTPTS[base]`];
    let currentVideo = 'base';
    const audioLabels: string[] = [];
    const audioEntries: Array<{ clip: Project['clips'][string]; label: string }> = [];
    const inputIndexByClip = new Map<string, number>();
    assets.forEach((item, index) => inputIndexByClip.set(item.clip.id, index + 1));
    const soloed = project.tracks.some((track) => track.solo);
    assets.forEach(({ clip, asset }, index) => {
      const inputIndex = index + 1;
      const start = clip.start / project.settings.fps;
      const duration = clip.duration / project.settings.fps;
      if (clip.kind === 'video' || clip.kind === 'image') {
        const visualLabel = `visual${index}`;
        const t = clip.transform;
        const crop = t.crop;
        const cropFilter = `crop=w=iw*${Math.max(0.01, 1 - crop.left - crop.right)}:h=ih*${Math.max(0.01, 1 - crop.top - crop.bottom)}:x=iw*${crop.left}:y=ih*${crop.top}`;
        const scaleFactor = Math.max(0.01, t.width * t.scaleX);
        const scaleYFactor = Math.max(0.01, t.height * t.scaleY);
        const effects = ffmpegVideoEffects(clip);
        const mask = ffmpegMaskFilter(clip);
        const sourceDuration = duration * Math.max(0.0625, clip.speed);
        const sourceStart = clip.kind === 'video' ? clip.sourceIn / project.settings.fps : 0;
        const transition = transitionPreset(clip);
        const transitionDuration = Math.max(0.01, (clip.transitionIn?.durationFrames ?? 0) / project.settings.fps);
        const visualFilters = [
          ...(clip.freezeFrame !== undefined ? [`trim=start=${clip.freezeFrame / project.settings.fps}:duration=${1 / project.export.fps}`, 'setpts=PTS-STARTPTS', `tpad=stop_mode=clone:stop_duration=${duration}`] : clip.kind === 'video' ? [`trim=start=${sourceStart}:duration=${sourceDuration}`, 'setpts=PTS-STARTPTS'] : [`trim=duration=${sourceDuration}`, 'setpts=PTS-STARTPTS']),
          ...(clip.freezeFrame === undefined && clip.reverse && clip.kind === 'video' ? ['reverse', 'setpts=PTS-STARTPTS'] : []),
          ...(clip.freezeFrame === undefined && clip.speed !== 1 ? [`setpts=PTS/${Math.max(0.0625, clip.speed)}`] : []),
          cropFilter,
          `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
          `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`,
          ...ffmpegTransitionFilters(clip, start, transitionDuration, size),
          ...effects,
          `scale=iw*${scaleFactor}:ih*${scaleYFactor}`,
          ...(mask ? ['format=rgba', mask] : []),
          `format=rgba,colorchannelmixer=aa=${Math.max(0, Math.min(1, t.opacity))}`,
          ...(ffmpegTransitionAlpha(clip, start, transitionDuration) ? [ffmpegTransitionAlpha(clip, start, transitionDuration)!] : []),
          ...(transition ? [`fade=t=in:st=0:d=${transitionDuration}:alpha=1`] : []),
          `trim=duration=${duration},setpts=PTS-STARTPTS+${start}/TB`,
        ];
        filters.push(`[${inputIndex}:v]${visualFilters.join(',')}[${visualLabel}]`);
        const next = `mix${index}`;
        // The visual source is already scaled to the full project canvas. The
        // old formula added a full half-canvas offset here and then added the
        // overlay centering offset again, shifting every media layer to the
        // lower-right quadrant in exported files. Transform x/y are normalized
        // around zero, matching the browser preview.
        let x = `${(t.x * size.width / 2).toFixed(3)}`;
        let y = `${(t.y * size.height / 2).toFixed(3)}`;
        if (transition && (transition.behavior === 'slide' || transition.behavior === 'push')) {
          const progress = `min(max((t-${start})/${transitionDuration},0),1)`;
          const intensity = Math.max(0, Math.min(2, clip.transitionIn?.intensity ?? 1));
          if (transition.direction === 'left') x += `+((1-${progress})*main_w*${intensity})`;
          if (transition.direction === 'right') x += `-((1-${progress})*main_w*${intensity})`;
          if (transition.direction === 'up') y += `+((1-${progress})*main_h*${intensity})`;
          if (transition.direction === 'down') y += `-((1-${progress})*main_h*${intensity})`;
        }
        filters.push(`[${currentVideo}][${visualLabel}]overlay=x='(main_w-overlay_w)/2+(${x})':y='(main_h-overlay_h)/2+(${y})':eof_action=pass:enable='between(t,${start},${start + duration})'[${next}]`);
        currentVideo = next;
      }
      const track = project.tracks.find((item) => item.id === clip.trackId);
      const audible = clip.freezeFrame === undefined && (asset.kind === 'audio' || asset.hasAudio);
      if (audible && clip.audio?.muted !== true && !track?.muted && (!soloed || track?.solo)) {
        const audioLabel = `audio${index}`;
        const volume = audioVolumeExpression(clip, project.settings.fps);
        const trackVolume = Math.max(0, Math.min(4, track?.volume ?? 1));
        const fadeIn = Math.max(0, (clip.audio?.fadeInFrames ?? 0) / project.settings.fps);
        const fadeOut = Math.max(0, (clip.audio?.fadeOutFrames ?? 0) / project.settings.fps);
        const fadeOutStart = Math.max(0, duration - fadeOut);
        const sourceIn = clip.sourceIn / project.settings.fps;
        const sourceDuration = duration * Math.max(0.0625, clip.speed);
        const audioTiming = [`atrim=start=${sourceIn}:duration=${sourceDuration}`, 'asetpts=PTS-STARTPTS', ...(clip.reverse ? ['areverse', 'asetpts=PTS-STARTPTS'] : []), ...atempoFilters(clip.speed)];
        const audioEffects = ffmpegAudioEffects(clip);
        const pitch = pitchFilters(clip, sampleRates.get(clip.id) ?? 48000);
        const audioInput = `[${inputIndex}:a]${audioTiming.join(',')}${pitch.length ? `,${pitch.join(',')}` : ''},aresample=48000,adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)},volume='${volume}*${trackVolume}'${audioEffects.length ? `,${audioEffects.join(',')}` : ''}`;
        const fades = `${fadeIn > 0 ? `,afade=t=in:st=0:d=${fadeIn}` : ''}${fadeOut > 0 ? `,afade=t=out:st=${fadeOutStart}:d=${fadeOut}` : ''}`;
        filters.push(`${audioInput}${fades}[${audioLabel}]`);
        audioLabels.push(audioLabel);
        audioEntries.push({ clip, label: audioLabel });
      }
    });
    for (const [index, entry] of audioEntries.entries()) {
      const ducking = entry.clip.audio.ducking;
      if (!ducking?.enabled || !ducking.sidechainTrackId) continue;
      const sidechain = audioEntries.filter((candidate) => candidate.clip.trackId === ducking.sidechainTrackId && candidate.clip.id !== entry.clip.id);
      if (!sidechain.length) continue;
      const sideLabel = `duckside${index}`;
      if (sidechain.length === 1) filters.push(`[${sidechain[0]!.label}]anull[${sideLabel}]`);
      else filters.push(`${sidechain.map((candidate) => `[${candidate.label}]`).join('')}amix=inputs=${sidechain.length}:duration=longest:dropout_transition=0[${sideLabel}]`);
      const duckedLabel = `ducked${index}`;
      const threshold = Math.max(0.02, 1 - Math.max(0, Math.min(1, ducking.amount)));
      const ratio = 1 + Math.max(0, Math.min(1, ducking.amount)) * 19;
      const attack = Math.max(1, Math.round((ducking.attackFrames / project.settings.fps) * 1000));
      const release = Math.max(1, Math.round((ducking.releaseFrames / project.settings.fps) * 1000));
      filters.push(`[${entry.label}][${sideLabel}]sidechaincompress=threshold=${threshold.toFixed(4)}:ratio=${ratio.toFixed(2)}:attack=${attack}:release=${release}[${duckedLabel}]`);
      const labelIndex = audioLabels.indexOf(entry.label);
      if (labelIndex >= 0) audioLabels[labelIndex] = duckedLabel;
    }
    for (const [index, clip] of clips.filter((item) => item.kind === 'text' && item.text && visibleTrackIds.has(item.trackId)).sort(bottomToTop).entries()) {
      const text = clip.text!;
      const t = clip.transform;
      const start = clip.start / project.settings.fps;
      const end = clipEnd(clip) / project.settings.fps;
      const fontSize = Math.max(8, Math.round(text.style.fontSize * size.width / project.settings.width * t.scaleY));
      const x = `(main_w-text_w)/2+${(t.x * size.width / 2).toFixed(3)}`;
      const y = `(main_h-text_h)/2+${(t.y * size.height / 2).toFixed(3)}`;
      const background = text.style.background ? `:box=1:boxcolor=${ffmpegColor(text.style.background.color)}:boxborderw=${Math.max(0, Math.round(text.style.background.padding * size.width / project.settings.width))}` : '';
      const revealSegments = textRevealSegments(clip, start, project.settings.fps);
      const pathCharacters = textPathCharacters(clip);
      const animation = textAnimationExpressions(clip, start, end, project.settings.fps);
      const blurPreset = text.animationIn?.presetId === 'blur-reveal' || text.animationOut?.presetId === 'blur-out' || text.animationLoop?.presetId === 'blur-reveal';
      const textPostFilters = [...ffmpegVideoEffects(clip), ...(ffmpegMaskFilter(clip) ? ['format=rgba', ffmpegMaskFilter(clip)!] : [])];
      const directText = !blurPreset && !pathCharacters.length && !revealSegments.length && !textPostFilters.length && animation.scale === '1';
      const base = `textlayerbase${index}`;
      if (!directText) filters.push(`color=c=black@0.0:s=${size.width}x${size.height}:r=${project.export.fps}:d=${totalDuration},format=rgba[${base}]`);
      const textInput = directText ? currentVideo : base;
      let textLayer = textInput;
      if (blurPreset) {
        const base = `textlayerbase${index}`;
        const drawn = `textlayerdraw${index}`;
        const blurred = `textlayerblur${index}`;
        const draw = `drawtext=fontfile='${textFontFile(text, importedFonts)}':text='${ffmpegText(text.text)}':${ffmpegTextColor(text)}${ffmpegTextDecorations(text, size.width / project.settings.width)}:fontsize=${fontSize}:x='${x}+${animation.x}':y='${y}+${animation.y}':alpha='${Math.max(0, Math.min(1, t.opacity))}*${animation.alpha}'${background}:enable='between(t,${start},${end})'`;
        filters.push(`[${base}]${draw}[${drawn}]`, `[${drawn}]boxblur=luma_radius=14:luma_power=1[${blurred}]`);
        textLayer = blurred;
      } else if (pathCharacters.length) {
        let pathInput = base;
        const center = (pathCharacters.length - 1) / 2;
        pathCharacters.forEach((character, characterIndex) => {
          const label = `textpath${index}_${characterIndex}`;
          const isPath = ['text-on-path', 'kinetic-typography', 'wave'].includes(text.animationIn?.presetId ?? '');
          const spacing = Number(text.style.letterSpacing ?? 0) * size.width / project.settings.width;
          const offset = (characterIndex - center) * (fontSize * 0.62 + spacing);
          const wave = isPath ? `(sin(${(characterIndex - center).toFixed(3)}*0.55)*${(fontSize * 0.72).toFixed(3)})` : '0';
          const tracking = text.animationIn?.presetId === 'tracking-expansion' ? `*(0.35+0.65*min(max((t-${start})/${Math.max(0.01, (text.animationIn.durationFrames / project.settings.fps))}\,0)\,1))` : '';
          const glyphSize = String(fontSize);
          const draw = `drawtext=fontfile='${textFontFile(text, importedFonts)}':text='${ffmpegText(character)}':${ffmpegTextColor(text, characterIndex, pathCharacters.length)}${ffmpegTextDecorations(text, size.width / project.settings.width)}:fontsize=${glyphSize}:x='main_w/2+${offset.toFixed(3)}${tracking}-text_w/2+${animation.x}':y='main_h/2+${wave}+${animation.y}':alpha='${Math.max(0, Math.min(1, t.opacity))}*${animation.alpha}':enable='between(t,${start},${end})'`;
          filters.push(`[${pathInput}]${draw}[${label}]`);
          pathInput = label;
        });
        textLayer = pathInput;
      } else if (revealSegments.length) {
        let revealInput = base;
        revealSegments.forEach((segment, segmentIndex) => {
          const label = `text${index}_${segmentIndex}`;
          const draw = `drawtext=fontfile='${textFontFile(text, importedFonts)}':text='${ffmpegText(segment.text)}':${ffmpegTextColor(text)}${ffmpegTextDecorations(text, size.width / project.settings.width)}:fontsize=${fontSize}:x='${x}+${animation.x}':y='${y}+${animation.y}':alpha='${Math.max(0, Math.min(1, t.opacity))}*${animation.alpha}'${background}:enable='between(t,${segment.start},${segment.end})'`;
          filters.push(`[${revealInput}]${draw.replace(`between(t,${segment.start},${segment.end})`, segment.enable)}[${label}]`);
          revealInput = label;
        });
        textLayer = revealInput;
      } else {
        const label = `text${index}`;
        const draw = `drawtext=fontfile='${textFontFile(text, importedFonts)}':text='${ffmpegText(text.text)}':${ffmpegTextColor(text)}${ffmpegTextDecorations(text, size.width / project.settings.width)}:fontsize=${fontSize}:x='${x}+${animation.x}':y='${y}+${animation.y}':alpha='${Math.max(0, Math.min(1, t.opacity))}*${animation.alpha}'${background}:enable='between(t,${start},${end})'`;
        filters.push(`[${textInput}]${draw}[${label}]`);
        textLayer = label;
      }
      if (animation.scale !== '1') {
        const scaled = `textlayerscale${index}`;
        filters.push(`[${textLayer}]scale=w='iw*(${animation.scale})':h='ih*(${animation.scale})':eval=frame,format=rgba[${scaled}]`);
        textLayer = scaled;
      }
      if (textPostFilters.length) {
        const styled = `textlayerstyled${index}`;
        filters.push(`[${textLayer}]${textPostFilters.join(',')}[${styled}]`);
        textLayer = styled;
      }
      if (directText) {
        currentVideo = textLayer;
      } else {
        const label = `textcomposite${index}`;
        filters.push(`[${currentVideo}][${textLayer}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${start},${end})'[${label}]`);
        currentVideo = label;
      }
    }
    // Visualizer clips are normally on the top overlay lane, so composite them
    // after text and media in the same bottom-to-top order as the timeline.
    for (const [index, visualizer] of visualizerClips.entries()) {
      const start = visualizer.start / project.settings.fps;
      const duration = visualizer.duration / project.settings.fps;
      const label = `visualizer${index}`;
      const visualizerType = visualizer.visualizer?.type ?? 'spectrum';
      if (isProgressVisualizer(visualizerType) && visualizer.visualizer) {
        filters.push(`${ffmpegProgressStyleSource(visualizer.visualizer, size, project.export.fps, duration)},setpts=PTS-STARTPTS+${start}/TB[${label}]`);
        const framed = `mixviz${index}`;
        filters.push(`[${currentVideo}][${label}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${start},${start + duration})'[${framed}]`);
        currentVideo = framed;
        continue;
      }
      const source = clips.find((clip) => clip.assetId && clip.audio?.muted !== true && (clip.kind === 'audio' || (clip.kind === 'video' && project.assets[clip.assetId]?.hasAudio)));
      const inputIndex = source ? inputIndexByClip.get(source.id) : undefined;
      if (inputIndex === undefined) continue;
      filters.push(`[${inputIndex}:a]${ffmpegVisualizerFilter(visualizerType, size, project.export.fps)},format=rgba,trim=duration=${duration},setpts=PTS-STARTPTS+${start}/TB[${label}]`);
      const next = `mixviz${index}`;
      filters.push(`[${currentVideo}][${label}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${start},${start + duration})'[${next}]`);
      currentVideo = next;
    }
    const hasAudio = audioLabels.length > 0;
    if (hasAudio) {
      const audioInputs = audioLabels.map((label) => `[${label}]`).join('');
      const mix = audioLabels.length === 1
        ? `${audioInputs}anull`
        : `${audioInputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0`;
      filters.push(`${mix},aresample=48000:async=1:first_pts=0,atrim=duration=${totalDuration},asetpts=PTS-STARTPTS[aout]`);
    }
    const exportVideo = 'exportvideo';
    // The preview is rendered at the project canvas size. Use a high quality
    // final scaler so the MP4 does not soften text, thumbnails, or transition
    // edges after compositing.
    filters.push(`[${currentVideo}]scale=${outputDimensions.width}:${outputDimensions.height}:flags=lanczos[${exportVideo}]`);
    const plan = buildEncodePlan(project.export, hasAudio);
    const output = plan.output;
    args.push(
      '-filter_complex', filters.join(';'), '-map', `[${exportVideo}]`, ...(hasAudio ? ['-map', '[aout]'] : ['-an']),
      '-t', String(totalDuration), '-r', String(project.export.fps), '-threads', '0', ...plan.args,
    );
    const exitCode = await ffmpeg.exec(args, -1, { signal });
    if (exitCode !== 0) {
      const detail = ffmpegLogs.filter((line) => /error|invalid|failed|unable|unknown/i.test(line)).pop() ?? ffmpegLogs.at(-1);
      const context = ffmpegLogs.slice(-4).join(' | ');
      throw new Error(detail ? `FFmpeg stopped with code ${exitCode}: ${detail}${context && context !== detail ? ` [${context}]` : ''}` : `FFmpeg stopped with code ${exitCode}.`);
    }
    const data = await ffmpeg.readFile(output, 'binary');
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    onProgress?.({ phase: 'complete', ratio: 1 });
    const stableBytes = new Uint8Array(bytes.byteLength);
    stableBytes.set(bytes);
    return new Blob([stableBytes.buffer], { type: plan.mime });
  } finally {
    ffmpeg.off('progress', onFfmpegProgress);
    ffmpeg.off('log', onFfmpegLog);
    signal?.removeEventListener('abort', cancel);
    ffmpeg.terminate();
  }
}
