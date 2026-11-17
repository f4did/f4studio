import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(require.resolve('@ffmpeg/core')), '..', '..');
const sourceDir = join(packageRoot, 'dist', 'esm');
const publicDir = join(process.cwd(), 'public');
await mkdir(publicDir, { recursive: true });
await copyFile(join(sourceDir, 'ffmpeg-core.js'), join(publicDir, 'ffmpeg-core.js'));
await copyFile(join(sourceDir, 'ffmpeg-core.wasm'), join(publicDir, 'ffmpeg-core.wasm'));
