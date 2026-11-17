import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// FFmpeg.wasm (multi-thread build) needs cross-origin isolation for SharedArrayBuffer.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-f4-studio-home',
      generateBundle() {
        const source = readFileSync(new URL('./f4-studio-home-enhanced.html', import.meta.url), 'utf8');
        const audioSource = readFileSync(new URL('./F4-Audio-Studio-Modern-F4-Home-Design.html', import.meta.url), 'utf8');
        this.emitFile({ type: 'asset', fileName: 'f4-studio-home-enhanced.html', source });
        this.emitFile({ type: 'asset', fileName: 'F4-Audio-Studio-Modern-F4-Home-Design.html', source: audioSource });
      },
    },
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
});
