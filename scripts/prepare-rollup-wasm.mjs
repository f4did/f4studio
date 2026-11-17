import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const rollupNativePath = require.resolve('rollup/dist/native.js');
const wasmPackage = '@rollup/wasm-node/dist/native.js';
const source = await readFile(rollupNativePath, 'utf8');

// Some Windows application-control policies block Rollup's native .node binary.
// Keep Rollup's public API, but use the official WASM implementation instead.
const nativeModulePattern = /const nativeModule = requireWithFriendlyError\([\s\S]*?\n\);/;
if (!nativeModulePattern.test(source)) {
  if (source.includes("require('@rollup/wasm-node/dist/native.js')")) process.exit(0);
  if (source.includes("require('@rollup/wasm-node')")) {
    await writeFile(
      rollupNativePath,
      source.replace("require('@rollup/wasm-node')", `require('${wasmPackage}')`)
    );
    process.exit(0);
  }
  throw new Error('Unsupported Rollup native.js format; WASM fallback was not applied.');
}

const patched = source.replace(
  nativeModulePattern,
  `const nativeModule = require('${wasmPackage}');`
);
await writeFile(rollupNativePath, patched);
