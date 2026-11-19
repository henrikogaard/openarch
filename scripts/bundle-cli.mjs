#!/usr/bin/env node
/**
 * Bundle the OpenArch CLI into one self-contained ESM file so it can be
 * published as `npx openarch` (packages/cli). Pure-JS deps are bundled;
 * Node built-ins stay external. Usage: node scripts/bundle-cli.mjs
 */
import { build } from 'esbuild';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'packages/cli/dist');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'apps/cli/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: true,
  outfile: join(outdir, 'cli.mjs'),
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'eof',
  logLevel: 'warning',
  // tsconfig path mappings (@openarch/*) are resolved via relative re-write:
  // esbuild understands paths from tsconfig if given explicitly.
  tsconfig: join(root, 'tsconfig.json'),
});

await chmod(join(outdir, 'cli.mjs'), 0o755);

const kilobytes = Math.round(result.outputFiles?.[0]?.bytes / 1024 ?? 0);
console.log(`cli bundled: packages/cli/dist/cli.mjs (${kilobytes} kB + sourcemap)`);
