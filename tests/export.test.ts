import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addClip, createClip, createProject, effectsForFilter, FILTER_PRESETS, TEXT_ANIMATION_PRESETS } from '../src/core';
import { canExportProject } from '../src/engine/export';

function projectWithVideo() {
  const project = createProject();
  const track = project.tracks.find((item) => item.kind === 'video')!;
  const clip = createClip({ kind: 'video', trackId: track.id, start: 0, duration: 60, assetId: 'asset' });
  project.assets.asset = { id: 'asset', kind: 'video', name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 1, durationSec: 2, blobKey: 'blob', addedAt: 0 };
  return addClip(project, clip).project;
}

test('export capability accepts static text and supported color effects', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Title', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' } } });
  const withText = addClip(project, text).project;
  assert.equal(canExportProject(withText).ok, true);
});

test('every registered filter preset is export-capable', () => {
  for (const preset of FILTER_PRESETS) {
    const project = projectWithVideo();
    const clip = Object.values(project.clips)[0]!;
    clip.effects = effectsForFilter(preset.id);
    assert.ok(clip.effects.length > 0, `${preset.id} should create effects`);
    assert.equal(canExportProject(project).ok, true, `${preset.id} should be export-capable`);
  }
});

test('export capability accepts caption text with a rendered background box', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const caption = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Caption', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff', background: { color: '#000000', padding: 12, radius: 8 } } } });
  assert.equal(canExportProject(addClip(project, caption).project).ok, true);
});

test('export capability accepts fade and complex text animation presets', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const fade = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Fade', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId: 'fade-in', durationFrames: 15, speed: 1 } } });
  assert.equal(canExportProject(addClip(project, fade).project).ok, true);
  const complex = { ...fade, id: 'complex-text', text: { ...fade.text!, animationIn: { presetId: 'tracking-expansion', durationFrames: 15, speed: 1 } } };
  assert.equal(canExportProject(addClip(project, complex).project).ok, true);
});

test('export capability accepts expression-rendered text motion presets', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  for (const presetId of ['slide-left', 'scale-pop', 'pulse', 'floating', 'shake', 'glitch-loop', 'caption-pop']) {
    const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Motion', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId, durationFrames: 15, speed: 1 } } });
    assert.equal(canExportProject(addClip(project, text).project).ok, true, `${presetId} should have an export renderer`);
  }
});

test('export capability accepts timed text reveal presets', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  for (const presetId of ['typewriter', 'letter-reveal', 'word-reveal', 'per-character', 'per-word', 'animated-subtitles']) {
    const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Reveal this', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId, durationFrames: 15, speed: 1 } } });
    assert.equal(canExportProject(addClip(project, text).project).ok, true, `${presetId} should have a timed reveal renderer`);
  }
});

test('export capability accepts path, kinetic, and 3D-style text renderers', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  for (const presetId of ['text-on-path', 'kinetic-typography', 'rotation-3d']) {
    const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Path text', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId, durationFrames: 15, speed: 1 } } });
    assert.equal(canExportProject(addClip(project, text).project).ok, true, `${presetId} should have a path renderer`);
  }
});

test('export capability accepts animated gradient and caption highlight text', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  for (const presetId of ['gradient-movement', 'animated-gradient', 'caption-highlight']) {
    const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Colour', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId, durationFrames: 15, speed: 1 } } });
    assert.equal(canExportProject(addClip(project, text).project).ok, true, `${presetId} should have an animated colour renderer`);
  }
});

test('export capability accepts text outline and shadow decorations', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Styled', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff', outline: { color: '#000000', width: 3 }, shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2 } } } });
  assert.equal(canExportProject(addClip(project, text).project).ok, true);
});

test('export capability accepts text effect stacks and transitions', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, effects: [{ id: 'text-fx', type: 'glow', enabled: true, intensity: 1, params: { value: 0.35 } }], transitionIn: { id: 'text-transition', type: 'slide-left', durationFrames: 12, direction: 'left', intensity: 1, params: {} }, text: { text: 'Styled title', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' } } });
  assert.equal(canExportProject(addClip(project, text).project).ok, true);
});

test('export capability accepts letter-spaced text through glyph positioning', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Spaced', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 8, lineHeight: 1, align: 'center', color: '#ffffff' } } });
  assert.equal(canExportProject(addClip(project, text).project).ok, true);
});

test('export capability accepts arbitrary two-colour text gradients', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Gradient', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff', gradient: { from: '#ff4ecd', to: '#42d9ff', angle: 0 } } } });
  assert.equal(canExportProject(addClip(project, text).project).ok, true);
});

test('export capability accepts supported looping text motion', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Loop', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationLoop: { presetId: 'pulse', durationFrames: 15, speed: 1 } } });
  assert.equal(canExportProject(addClip(project, text).project).ok, true);
});

test('export capability accepts blur and advanced text alias presets', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  for (const presetId of ['blur-reveal', 'blur-out', 'slide-away-left', 'character-bounce', 'text-mask', 'chromatic-glitch', 'wave', 'tracking-expansion', 'typewriter-loop']) {
    const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Advanced', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId, durationFrames: 15, speed: 1 } } });
    assert.equal(canExportProject(addClip(project, text).project).ok, true, `${presetId} should have a renderer`);
  }
});

test('export capability accepts chroma key with the FFmpeg colorkey renderer', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.effects.push({ id: 'key', type: 'chromaKey', enabled: true, intensity: 1, params: { color: '#00ff00', similarity: 0.28, smoothness: 0.08, spill: 0.35 } });
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts speed and reverse timing', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.speed = 1.75;
  clip.reverse = true;
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts the colour grade renderer', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.effects.push({ id: 'grade', type: 'colorGrade', enabled: true, intensity: 1, params: { temperature: 0.2, tint: -0.1, shadows: 0.15, highlights: -0.1, vignette: 0.3 } });
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts advanced colour and texture effects', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  for (const type of ['exposure', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'gamma', 'lift', 'gain', 'vignette', 'filmGrain', 'sharpen', 'glow', 'chromaticAberration', 'rgbSplit', 'pixelation', 'noise']) {
    clip.effects = [{ id: `fx-${type}`, type, enabled: true, intensity: 1, params: { value: type === 'gamma' ? 1.2 : 0.5 } }];
    assert.equal(canExportProject(project).ok, true, `${type} should be export-capable`);
  }
});

test('export capability accepts freeze-frame timing', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.freezeFrame = 24;
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts basic and creative transitions', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.transitionIn = { id: 'trn', type: 'slide-left', durationFrames: 15, direction: 'left', intensity: 1, params: {} };
  assert.equal(canExportProject(project).ok, true);
  clip.transitionIn = { ...clip.transitionIn, type: 'glitch' };
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts rendered zoom, spin, and blur transitions', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  for (const type of ['zoom-in', 'zoom-out', 'punch-zoom', 'radial-zoom', 'spin', 'blur-dissolve']) {
    clip.transitionIn = { id: `trn-${type}`, type, durationFrames: 15, direction: 'none', intensity: 1, params: {} };
    assert.equal(canExportProject(project).ok, true, `${type} should have an export renderer`);
  }
});

test('export capability accepts wipe and creative transition renderers', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  for (const type of ['linear-wipe', 'circular-wipe', 'iris', 'diagonal-wipe', 'clock-wipe', 'glitch', 'rgb-split', 'pixel-dissolve', 'film-burn', 'light-leak']) {
    clip.transitionIn = { id: `trn-${type}`, type, durationFrames: 15, direction: 'right', intensity: 1, params: {} };
    assert.equal(canExportProject(project).ok, true, `${type} should have an export renderer`);
  }
});

test('export capability accepts rectangle and ellipse masks', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.effects.push({ id: 'mask', type: 'mask', enabled: true, intensity: 1, params: { shape: 'ellipse', width: 0.8, height: 0.8 } });
  assert.equal(canExportProject(project).ok, true);
  clip.effects[0]!.params.shape = 'rectangle';
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts sidechain ducking with a selected sidechain track', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.audio.ducking = { enabled: true, sidechainTrackId: project.tracks[0]!.id, amount: 0.5, attackFrames: 6, releaseFrames: 15 };
  assert.equal(canExportProject(project).ok, true);
});

test('export capability rejects enabled ducking without a sidechain track', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.audio.ducking = { enabled: true, amount: 0.5, attackFrames: 6, releaseFrames: 15 };
  const result = canExportProject(project);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Ducking without a sidechain should be rejected.');
  assert.match(result.reason, /sidechain track/i);
});

test('export capability accepts supported audio processing', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.audio.processing = { eqLow: 3, eqMid: -2, eqHigh: 4, compressor: 0.4, limiter: 0.5, reverb: 0.3, echo: 0.2 };
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts clip volume automation keyframes', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.keyframes['audio.volume'] = [
    { frame: 0, value: 1, easing: 'linear' },
    { frame: 15, value: 0.25, easing: 'easeInOut' },
    { frame: 45, value: 0.9, easing: 'linear' },
  ];
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts pitch-shifted audio for the rate/tempo renderer', () => {
  const project = projectWithVideo();
  const clip = Object.values(project.clips)[0]!;
  clip.audio.pitchSemitones = 7;
  assert.equal(canExportProject(project).ok, true);
});

test('export capability accepts a configured visualizer with an audio source', () => {
  const project = projectWithVideo();
  project.assets.asset!.hasAudio = true;
  const overlay = project.tracks.find((item) => item.kind === 'overlay')!;
  const visualizer = createClip({ kind: 'visualizer', trackId: overlay.id, start: 0, duration: 60, visualizer: { type: 'spectrum', primaryColor: '#a78bfa', secondaryColor: '#22d3ee', bars: 48, sensitivity: 1, smoothing: 0.8, radius: 0.28, frequencyMin: 0, frequencyMax: 1 } });
  assert.equal(canExportProject(addClip(project, visualizer).project).ok, true);
});

test('export capability accepts every visualizer mode with an audio source', () => {
  const project = projectWithVideo();
  project.assets.asset!.hasAudio = true;
  const overlay = project.tracks.find((item) => item.kind === 'overlay')!;
  for (const type of ['spectrum', 'mirrored', 'radial', 'oscilloscope'] as const) {
    const visualizer = createClip({ kind: 'visualizer', trackId: overlay.id, start: 0, duration: 60, visualizer: { type, primaryColor: '#a78bfa', secondaryColor: '#22d3ee', bars: 48, sensitivity: 1, smoothing: 0.8, radius: 0.28, frequencyMin: 0, frequencyMax: 1 } });
    assert.equal(canExportProject(addClip(project, visualizer).project).ok, true, `${type} should be exportable`);
  }
});

test('export capability accepts advanced animated text rather than omitting it', () => {
  const project = projectWithVideo();
  const textTrack = project.tracks.find((item) => item.kind === 'text')!;
  const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'Title', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId: 'tracking-expansion', durationFrames: 15, speed: 1 } } });
  assert.equal(canExportProject(addClip(project, text).project).ok, true);
});

test('every registered text animation preset is export-capable', () => {
  for (const preset of TEXT_ANIMATION_PRESETS) {
    const project = projectWithVideo();
    const textTrack = project.tracks.find((item) => item.kind === 'text')!;
    const text = createClip({ kind: 'text', trackId: textTrack.id, start: 0, duration: 60, text: { text: 'All presets', style: { fontFamily: 'sans-serif', fontSize: 48, fontWeight: 700, letterSpacing: 0, lineHeight: 1, align: 'center', color: '#ffffff' }, animationIn: { presetId: preset.id, durationFrames: 15, speed: 1 } } });
    assert.equal(canExportProject(addClip(project, text).project).ok, true, `${preset.id} should be export-capable`);
  }
});
