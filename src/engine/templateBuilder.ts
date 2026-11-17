import { addClip, createClip, createTrack, defaultAudio, type Clip, type Project } from '../core';
import { PROJECT_TEMPLATES } from '../core/templates';
import { animationRef } from '../core/animation/presets';
import { BACKDROPS, STICKERS, renderBackdropFile, renderStickerFile, renderedToFile } from './generate';
import { SONGS } from './synth';
import { importFile } from './media';

/** Adds the real media a template promises: generated backdrop (ken-burns), synth song (faded out) and animated stickers. */
export async function enrichTemplateProject(project: Project, templateId: string): Promise<Project> {
  const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return project;
  const fps = project.settings.fps;
  const total = Math.round(template.durationSec * fps);
  let next = project;

  const register = (asset: NonNullable<Awaited<ReturnType<typeof importFile>>['asset']>) => { next = { ...next, assets: { ...next.assets, [asset.id]: asset } }; return asset; };

  const backdrop = template.backdrop ? BACKDROPS.find((b) => b.id === template.backdrop) : undefined;
  if (backdrop) {
    const file = await renderBackdropFile(backdrop, project.settings.width, project.settings.height);
    const res = await importFile(file, { durationHintSec: template.durationSec });
    if (res.asset) {
      const asset = register(res.asset);
      const track = next.tracks.find((t) => t.kind === 'image');
      if (track) {
        const clip = createClip({ kind: 'image', trackId: track.id, assetId: asset.id, name: backdrop.name, start: 0, duration: total, animation: { loop: animationRef('ken-burns-in', total) } });
        const r = addClip(next, clip); if (r.ok) next = r.project;
      }
    }
  }

  const song = template.song ? SONGS.find((s) => s.id === template.song) : undefined;
  if (song) {
    const file = renderedToFile(song.render(44100), song.name.replace(/[^\w]+/g, '-').toLowerCase());
    const res = await importFile(file);
    if (res.asset) {
      const asset = register(res.asset);
      const track = next.tracks.find((t) => t.kind === 'audio');
      if (track) {
        const dur = Math.min(total, Math.floor(asset.durationSec * fps));
        const fade = Math.min(Math.round(1.6 * fps), Math.floor(dur / 3));
        const clip = createClip({ kind: 'audio', trackId: track.id, assetId: asset.id, name: song.name, start: 0, duration: dur, audio: { ...defaultAudio(), fadeInFrames: Math.round(0.4 * fps), fadeOutFrames: fade } });
        const r = addClip(next, clip); if (r.ok) next = r.project;
      }
    }
  }

  for (const st of template.stickers ?? []) {
    const def = STICKERS.find((s) => s.glyph === st.glyph) ?? { glyph: st.glyph, name: st.name };
    const file = await renderStickerFile(def.glyph, def.name);
    const res = await importFile(file, { durationHintSec: 5 });
    if (!res.asset) continue;
    const asset = register(res.asset);
    const start = Math.round(st.at * fps);
    const clip: Omit<Clip, 'trackId'> = createClip({ kind: 'image', trackId: '', assetId: asset.id, name: st.name, start, duration: Math.max(1, Math.min(Math.round(st.length * fps), total - start)), transform: { ...createClip({ kind: 'image', trackId: '', start: 0, duration: 1 }).transform, x: st.x, y: st.y, scaleX: st.scale, scaleY: st.scale },
      animation: { ...(st.animIn ? { in: animationRef(st.animIn, 14) } : {}), ...(st.animLoop ? { loop: animationRef(st.animLoop, 40) } : {}) } });
    // stickers sit above the footage: lanes go in front of the first video lane
    const vi = next.tracks.findIndex((t) => t.kind === 'video');
    const existing = next.tracks.find((t) => t.name === 'Stickers' || t.name.startsWith('Stickers'));
    let placed = false;
    if (existing) { const r = addClip(next, { ...clip, trackId: existing.id } as Clip); if (r.ok) { next = r.project; placed = true; } }
    if (!placed) {
      const lane = { ...createTrack('image', next.tracks.filter((t) => t.kind === 'image').length + 1), name: existing ? `Stickers ${next.tracks.filter((t) => t.name.startsWith('Stickers')).length + 1}` : 'Stickers' };
      const at = vi < 0 ? 0 : vi;
      next = { ...next, tracks: [...next.tracks.slice(0, at), lane, ...next.tracks.slice(at)] };
      const r = addClip(next, { ...clip, trackId: lane.id } as Clip); if (r.ok) next = r.project;
    }
  }
  return next;
}
