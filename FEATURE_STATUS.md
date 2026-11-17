# F4 Clip Editor — Feature Status

Legend: ✅ implemented and verified · 🟡 written but NOT compiled/run (needs `npm install`) · ❌ not started

**Verification so far:** the core and UI are type-checked under strict mode, covered by 74 capability tests, and production-built with Vite.

## Foundation
| Item | Status |
|---|---|
| Vite + React + strict TS + Tailwind scaffold | ✅ type-checked and production-built |
| Canonical project model (frames, tracks, clips, assets, markers, export settings) | ✅ |
| Canvas sizes capped at 1920×1080 class, even dimensions, 6 aspect ratios | ✅ tested |

## Timeline engine (`src/core/timeline`)
| Item | Status |
|---|---|
| Add / delete / duplicate / move / multi-move | ✅ tested |
| Trim left/right (source, speed, reverse, neighbour limits) | ✅ tested |
| Split (speed, reverse, keyframes) | ✅ tested |
| Ripple delete, ripple insert, magnetic gap closing | ✅ tested |
| Slip, slide | ✅ engine tested and available as Alt-drag / Shift+Alt-drag gestures |
| Group / ungroup, copy / paste | ✅ tested |
| Snapping (playhead, clip edges, markers) | ✅ tested |
| Undo/redo (one step per edit, 200 limit) | ✅ tested |
| Randomised invariant test (no overlaps, integer frames, source bounds) | ✅ |

## UI
| Item | Status |
|---|---|
| Top bar: name, save status, undo/redo, shortcut help, command palette, cancellable MP4 export, completion dialog | ✅ |
| Resizable panels | ✅ |
| Media import (video/image/audio), drag-drop, error reporting, decoded image/video thumbnails, silence/beat/scene detection markers | ✅ |
| Timeline UI: clips, drag, trim, snap, scrub, zoom, add/duplicate/delete/reorder tracks, lock/hide/mute/solo, cached audio waveforms, per-track height resize | ✅ |
| Preview canvas, play/pause, frame step, timecode, aspect ratio, grid, safe area, before/after effects toggle, direct transform dragging | ✅ |
| Inspector: transform/crop/rounding, opacity, speed/reverse/freeze timing, text typography/styling, keyframe controls, volume/pan/fades/pitch, EQ/compressor/limiter/echo/reverb, sidechain ducking, 40 filter presets, advanced colour/texture effects, effect-stack copy/paste, colour grading, 50 text animation presets, 30 transition presets, chroma key and mask controls, visualizer controls | ✅ |
| SRT subtitle import/export | ✅ |
| Optional browser Speech Recognition caption capture with editable timed text clips | ✅ browser capability |
| Offline plain-transcript automatic timing into editable subtitle clips | ✅ |
| Keyboard shortcuts and searchable command palette (Ctrl/Cmd+K) | ✅ |
| IndexedDB autosave, reload, 30-version recovery history (Dexie), and first-run startup screen | ✅ |

## Known limitations of the written code
- Preview audio now uses Web Audio gain/pan/fade routing plus EQ, compressor, limiter, echo, reverb, sidechain ducking, and an optional granular AudioWorklet pitch shifter; browser-side silence and energy-onset analysis can place labelled markers on audio clips, while sampled video-frame analysis can mark scene cuts; reverse clips show video but are silent in preview.
- Preview draws video/image/text, crop and rounded corners, text backgrounds/outlines/shadows/letter spacing, live effects and 40 filter looks (brightness, contrast, saturation, hue, blur, sepia, monochrome), temperature/tint/shadows/highlights/vignette grading, adjustable chroma key pixel removal, rectangle/ellipse masks with editable bounds, deterministic text entrance/exit/loop animation presets, transition-in motion, four Web Audio-driven visualizer modes, and interpolated transform/opacity keyframes.
- Timeline is not virtualised; track headers support drag-reorder and video/image thumbnails are decoded and cached from imported media.
- The top bar exposes preview quality, project settings, and capability-aware export with progress, cancellation, automatic download, and a completion dialog; unsupported effect-heavy export is rejected explicitly.
- The real FFmpeg exporter supports timed video/image overlays, transparent text-layer compositing with text effects and transitions, static text plus expression-rendered fade, scale, slide, pulse, float, flicker, shake, bounce, glitch, mask, flip, typewriter, letter/word reveal, per-character, per-word, animated-subtitle, text-on-path, kinetic-typography, 3D-style glyph flip, animated-colour text motion, two-colour gradient styles, blur-reveal/blur-out, letter spacing, outline, shadow, and background-box styling, crop/position/scale/opacity transforms, speed/reverse/freeze timing, all 30 transition presets through timed fades, slides, zoom/rotate/blur, geometric wipes, RGB shift, pixelation, or colour grading, all 40 filter presets through their brightness/contrast/saturation/hue/blur/sepia effect stacks, advanced colour/texture effects through FFmpeg `eq`, `colorbalance`, `vibrance`, `unsharp`, `gblur`, `rgbashift`, `scale`, and `noise`, rectangle/ellipse masks, colour grading, supported color effects including chroma key, mixed audio, EQ/compression/limiting/echo/reverb filters, pitch shifting via sample-rate/tempo compensation, all four visualizer modes through FFmpeg audio-reactive filters, and sidechain ducking through `sidechaincompress`; unsupported styling is rejected until its renderer is connected.
- Media, Audio, Text, Templates, Transitions, Effects and Backgrounds are visible in the sidebar; unfinished modules show an explicit status panel rather than fake controls. The command palette exposes the implemented editor actions and workspace navigation, first-run startup offers a blank project or functional templates, audio assets expose real silence/beat marker analysis, and the Text workspace can capture optional browser speech recognition or automatically time a plain transcript into editable captions.

## Not started
Browser speech caption capture and offline transcript timing are implemented; local-file speech
recognition still depends on a future local speech model integration.

## Added in the "next level" pass

| Feature | Where | Verified |
|---|---|---|
| Screen / camera / voice-over recording (pause, countdown, level meter, device pickers, auto-add to timeline; camera becomes a PiP overlay when footage exists) | `engine/recorder.ts`, `ui/panels/RecordPanel.tsx` | Headless Chromium with fake devices: camera + voice recorded, imported, played in preview. Screen capture uses the same pipeline but needs a real share picker. |
| WebM duration fix (MediaRecorder files report `Infinity`) | `engine/media.ts` | Recorded clips get the correct length |
| Generated library: 5 music beds, 10 SFX, 14 backdrops, 24 stickers — offline, royalty-free | `engine/synth.ts`, `engine/generate.ts`, `ui/panels/LibraryPanel.tsx` | Unit tests (levels, length, determinism, WAV header) + browser add-to-timeline |
| Auto-cut silences (video or audio clips, threshold + min-gap, single undo) | `core/timeline/autocut.ts`, `engine/smart.ts`, Inspector | Unit tests + real cut in browser |
| Export presets (YouTube, 60 fps, TikTok/Reels/Shorts, IG square/portrait, cinema, 720p, draft) | `core/exportPresets.ts`, Project menu | Unit tests + browser |
| `.f4proj` project bundle (project + all media in one file) | `engine/projectfile.ts`, `engine/projectio.ts` | Round-trip tests + opened in a fresh browser profile |
| Frame snapshot (PNG download / add to media) | `engine/playback.ts` | Browser |
| Installable PWA (manifest, offline service worker, icons, `.f4proj` file handler, Record shortcut) | `public/`, `engine/pwa.ts` | Files validated; service worker only registers in production builds over https/localhost |
| Electron desktop shell | `desktop/` | **Not run** (needs `npm i`); syntax-checked only |
| Phone/tablet layout (bottom tool bar, bottom-sheet panels) | `App.tsx`, end of `styles/index.css` | Pixel 7 emulation |
| Shortcuts: J/K/L, `[` `]` edge jump, F fit, Ctrl+E/S/Shift+S | `App.tsx` | Documented in the shortcuts dialog |
| Timeline "fit to project" button | `Timeline.tsx` | — |

Bug fixes: first-run "Open editor"/"New project" never dismissed the home screen; `index.html` pointed at missing built assets (now a proper Vite entry); new overlay/text/effect lanes were created *under* the footage; silence detection ignored video files; the old CSS hid every side panel below 760 px.

## Desktop app

* **Installable web app:** deploy `dist/` over https (with the COOP/COEP headers from `vite.config.ts`), then use *Project → Install as desktop app* (Chrome/Edge). `.f4proj` files then open straight into the app.
* **Electron:** `npm run desktop` builds and launches; `npm run desktop:dist` produces an installer (NSIS / dmg / AppImage).


## Added in the "Clipchamp redesign + lofi" pass

| Feature | Where | Verified |
|---|---|---|
| Lofi "Slowed + Reverb" template: title, subtitle, artist, channel, dotted-spike visualizer + progress-frame on named lanes | `core/templates.ts` | Unit tests + browser screenshot |
| `dotline` visualizer (dots at rest, thin white spikes with the music, Spike height slider) | `engine/playback.ts`, Inspector | Unit tests (levels), canvas preview; **not heard with real audio in the harness** |
| Progress frame fills clockwise from the bottom-left, translucent track, glowing head | `engine/playback.ts` | Unit tests (geometry / head path) + preview |
| Export honours every setting: format (MP4/WebM), resolution, fps, quality (CRF), speed, rate control, bitrate, audio bitrate, file name | `core/exportOptions.ts`, `engine/export.ts` | 6 unit tests on the encoder arguments; dialog interaction in browser; **real ffmpeg.wasm encode not run (no network)** |
| ffmpeg export of the new visualizer and progress frame (approximation of the preview) | `engine/export.ts` | Filter strings unit-tested only |
| New Export page (presets, estimate, preview frame), progress and "ready" screens | `ui/layout/ExportDialog.tsx` | Browser |
| Clipchamp-style UI: labelled tool rail, colour-coded timeline lanes with track gutter, purple Export button, cleaned theme | `styles/index.css`, `App.tsx`, `Timeline.tsx` | Desktop + phone screenshots |
| Dark (black/purple) and Light (white/purple) theme, synced between home page and editor | home page, `TopBar.tsx` | Browser |
| Premium minimal home page: 3 cards, animated visualizer preview, recent projects | `f4-studio-home-enhanced.html` | Browser |
| Removed the 50 KB legacy "brutal" dashboard CSS from `index.html` (it forced square corners everywhere) | `index.html` | Browser |

## Progress bars and visualizers (pass 3)

| Style | Kind | Notes |
|---|---|---|
| Lofi dotted spikes, Round bars + peaks, LED dot matrix, Bass ripples | Audio visualizers (new) | Seen reacting to the generated "Lo-Fi Chill" track in the browser harness |
| Frame border, Line + knob, Segmented pill, Ring + percent | Progress bars (4 new/updated) | Fill over the clip's length; no audio needed; thickness / opacity / position / size / segments in the Inspector |

Export: progress bars render through ffmpeg `geq` (unit-tested expression strings, **not run in real ffmpeg.wasm**); Round bars reuse the dotted-strip approximation; Dot matrix and Ripple fall back to the generic spectrum filter in exports.

## Pass 9 — real templates
- All 11 templates now ship real content: generated backdrop (Ken-Burns loop), synthesized song with fade-in/out, animated stickers (pop/drop/float/sway), animated text (entrance/exit/loop presets), visualizer / progress bars, and a working countdown timer (Countdown Hype).
- New: Birthday Party, Countdown Hype, Quote Card, Neon Lyrics, Product Launch, Podcast Wave, YouTube Creator, Reels & Shorts, Cinematic Travel, Music Visualizer, Lofi.
- `applyTemplate` is async (builds media in `engine/templateBuilder.ts`, ~1 s); the project opens instantly and media fills in.
- Test: `tests/templates.test.ts`.
- Known: in a software-rendered (no GPU) browser, 1080p previews/exports of effects-heavy templates are slow; on real hardware the WebCodecs path is far faster.
- Not yet redone this pass: full home-page and export-dialog redesign (current versions are functional).

## Pass 10 — editor feedback
- Canvas selection box now matches the real drawn area (measured text size/alignment, visualizer & progress boxes); live while dragging; multi-select shows an outline per clip; the hit-test ignores full-canvas frames.
- Visualizers and progress bars can be moved / scaled / rotated (drag on canvas, handles, Inspector X/Y/Scale/Rotation).
- Dotline visualizer rewritten: every position reacts to its own slice of the spectrum (log, treble-compensated), thick round-capped bars with a travelling swell — even left→right, no centre peak.
- Selected clips trim/stretch together when you drag an edge of any selected clip.
- The video ends where the background (video/image clips) ends; audio/text/overlays past it are cut from playback and export; an END marker and hatched "cut" area show it in the timeline.
- Speed range up to 20× (slider + 0.25/0.5/…/4/8/12/20 chips).
- Tests: tests/baseEnd.test.ts, updated tests/lofi.test.ts.

## Pass 11 — visualizer polish
- Dotline visualizer matches the reference: a dotted line with thin round bars that grow small → big → small in a travelling sequence; Centre colour (white) blends to Edge colour (dark) at both ends.
- Selection box is tight (measured glyph height, compact visualizer/progress boxes), bold solid outline, no glow.
- No shadows on visualizers/progress bars, template text, or the stage; solid bold colours.
