const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const preload = path.join(__dirname, 'test-preload.cjs');
const inheritedOptions = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';
const tests = fs.readdirSync(path.join(root, 'tests'))
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => path.join(root, 'tests', file));

const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--test', ...tests], {
  cwd: root,
  env: { ...process.env, NODE_OPTIONS: `${inheritedOptions}--require=${preload}` },
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
