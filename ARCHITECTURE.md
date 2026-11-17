# Architecture

```
src/core/     Pure TS, no DOM/React. Project model + timeline engine + history. Fully unit tested.
  model/        types.ts (canonical Project), factory.ts (ids, defaults, aspect/size rules)
  timeline/     time.ts (frames<->seconds, timecode, timeline->source mapping)
                operations.ts (immutable edits returning EditResult), history.ts (undo/redo)
src/store/    Zustand store wrapping core ops; every edit goes through apply() => one undo step.
src/engine/   Browser side effects: db.ts (Dexie), media.ts (import/probe/object URLs/thumbnails), playback.ts (preview)
src/ui/       React components: layout, panels, preview, timeline, inspector
tests/        node:test suites run through tsx
```

Principles
- Time is integer frames at project fps. DOM geometry is never the source of truth; pointer deltas are converted to frames and committed through core ops.
- Edits are immutable; a rejected edit returns the original project reference so no-ops never enter history.
- Media elements are slaves of the timeline: playhead is advanced by the clock, elements are seeked to `timelineToSource()`.
- Blobs live in IndexedDB; project JSON stores only a blob key. One object URL per asset, revoked in `releaseAllUrls()`.
- Media thumbnails are decoded from the real image or midpoint video frame, cached by asset id as compact data URLs, and cleared with the asset URL cache.
- Startup recovery checks the latest IndexedDB project before showing the first-run chooser; command actions dispatch through the same Zustand/core operations as the visible UI.
- Chroma key is stored as a normal `EffectInstance`; preview applies a bounded pixel pass on an offscreen canvas, while export maps the same parameters to FFmpeg `colorkey` and advertises the capability through `canExportProject`.
- Rectangle and ellipse masks are stored as `EffectInstance` geometry, applied as canvas path clips after transforms/crops, and exported as FFmpeg `geq` alpha expressions.
- Audio analysis decodes imported blobs in a short-lived `AudioContext`; silence regions are thresholded by RMS, cached by asset/options, and converted into immutable timeline marker edits through the store.
- Beat analysis reuses decoded audio energy, detects local positive onsets with a sensitivity/minimum-gap gate, and writes separate coloured beat markers without mutating clips.
- Scene analysis samples a video through a hidden media element, reduces frames to compact RGB histograms, detects distance spikes, and writes yellow scene markers on matching clips.
- Export timing mirrors `timelineToSource`: video uses source trim plus `setpts`/`reverse`, and audio uses source trim plus chained `atempo`/`areverse` filters so speed and reverse edits are rendered rather than capability-rejected.
- Colour grading is stored as `colorGrade` effect parameters, applied in the preview pixel pass, and mapped to FFmpeg `colorbalance`/`vignette` filters for export.
- Advanced clip effects use typed registry keys in the canonical `EffectInstance` model; the inspector writes stackable values and the exporter maps exposure/gamma/vibrance, colour balance, vignette, grain/noise, sharpen, glow, RGB shift, and pixelation to explicit FFmpeg filters instead of silently dropping them.
- Text clips are rendered into transparent, full-canvas FFmpeg layers before effect-stack processing and overlay compositing; this keeps text filters, masks, and transition expressions isolated from the underlying video.
- Track duplication clones clips onto a new track with fresh ids; track deletion removes its unlocked clips in one history edit and refuses locked clips, preserving the store's immutable-edit invariant.
- Freeze frames are stored as a source-frame hold, override `timelineToSource` during preview, mute the frozen media element, and export as a one-frame FFmpeg `tpad` clone.
- Export transition support is capability-scoped: basic dissolve/fade transitions use FFmpeg alpha fades and slide/push transitions use time-based overlay offsets; creative presets remain rejected instead of being silently flattened.
- Ducking is stored per audio clip with a selected sidechain track and attack/release frames; preview computes active sidechain overlap and ramps Web Audio gain, while export mixes sidechain-track audio and applies FFmpeg `sidechaincompress` before the final audio mix.
- Supported audio processing is translated into FFmpeg equalizer, compressor, limiter, echo, and multi-tap reverb filters; pitch and sidechain ducking remain explicit capability gates.
- All 50 registered text presets and supported loops are translated into time-based `drawtext` alpha, position, size, glyph, path, colour, blur, and decoration expressions; arbitrary effects/transitions attached directly to text clips remain capability-gated to avoid silent visual loss.
- Pitch export uses the source sample rate, `asetrate`, `aresample`, and compensating `atempo` filters; live preview routes clips through an optional granular AudioWorklet so pitch changes do not alter clip speed, with the ordinary Web Audio path retained when AudioWorklet is unavailable.
- Visualizer export uses FFmpeg audio-reactive filters from the first audible audio/video source: `showspectrum` for spectrum/mirrored, `avectorscope` polar mode for radial, and `showwaves` for oscilloscope; each stream is trimmed and overlaid at the clip's timeline range.
- Exported transition capability is backed by filter graphs: zoom uses animated scale/crop, spin uses FFmpeg rotate, blur uses box blur, wipes use time-dependent alpha expressions, glitch uses `rgbashift`, pixel dissolve uses nearest-neighbour pixelation, and burn/light-leak use colour grading.
- Automatic captions use the browser's optional Speech Recognition API when available; finalized recognition results are converted into normal text clips at the current project playhead, so they remain editable and export through the existing text pipeline.
- Text export maps supported animation presets into FFmpeg `drawtext` expressions for alpha, position, and font-size motion; reveal presets emit timed prefix stages, path presets emit one timed character layer per glyph along a sine path, and rotation-3d uses cosine-scaled per-glyph flip motion.
- Plain transcript import normalizes sentences and eight-word chunks, then allocates cue duration proportionally by word count across the current project duration before creating ordinary text clips.
- Animated gradient and caption-highlight export uses FFmpeg `drawtext` `fontcolor_expr` with time-varying RGB channels, preserving colour motion in the rendered text.
- Text outline, shadow, and caption background boxes map to `drawtext` border, shadow, and box options; two-colour gradient styles are exported as individually interpolated glyph colours.
- Blur text presets render into a transparent canvas-sized layer, apply FFmpeg `boxblur` only to that layer, and overlay it over the unblurred composition.
- Letter spacing is exported by emitting one glyph layer per character with adjusted centered offsets, keeping spacing independent of FFmpeg's lack of a native letter-spacing option.
- Planned: render pipeline will reuse the same `timelineToSource()` mapping and a shared frame compositor so preview and export agree.
