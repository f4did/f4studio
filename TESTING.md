# Testing

```
npm install
npm run typecheck:core   # strict type-check of src/core only (works offline)
npm test                 # 74 core/editor capability tests via tsx + node:test (Windows-safe runner)
npm run typecheck        # full app type-check (needs dependencies installed)
```
Covers: timecode, source mapping (speed/reverse), aspect sizes, add/move/trim/split/ripple/slip/slide, grouping,
clipboard, snapping, markers, undo/redo, a 400-step randomised invariant test, keyframe interpolation,
40 filter presets, advanced colour/texture effect export capability, 50 text animation presets, 30 transitions, SRT round trips, chroma-key export capability,
mask export, speed/reverse/freeze and colour-grade export capability, basic transition export capability,
ducking export, fade-text and pitch export capability, and supported audio-processing export capability,
all visualizer modes, all 30 transition capability renderers, all 50 registered text animation export presets, expression-rendered, timed-reveal, path, animated-colour, gradient, blur, letter-spaced, decorated, and looping text motion, transcript timing, sidechain ducking validation, and export capability rejection.
Not yet tested: browser-only thumbnail/silence decoding, Speech Recognition permission/UI flows, AudioWorklet pitch quality across browsers, all other UI interactions, persistence, playback sync, and full FFmpeg rendering.

The test runner preloads a small Node compatibility shim for managed Windows environments where Node 24 can fail `os.userInfo()` with `uv_os_get_passwd/ENOMEM`; it only affects the test process cache directory.
