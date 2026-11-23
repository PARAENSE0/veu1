// Build do projeto com esbuild.
// - Cliente: client/src/main.tsx -> dist/public/app.js (+ index.html e CSS copiados)
// - Servidor: server/index.ts -> dist/server.mjs (dependências npm ficam externas)
// - Testes: tests/*.ts -> dist/tests/*.mjs
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const prod = process.env.NODE_ENV === 'production';

mkdirSync(join(root, 'dist/public'), { recursive: true });
cpSync(join(root, 'client/public'), join(root, 'dist/public'), { recursive: true });

const clientOpts = {
  entryPoints: [join(root, 'client/src/main.tsx')],
  bundle: true,
  outfile: join(root, 'dist/public/app.js'),
  format: 'esm',
  target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
  sourcemap: !prod,
  minify: prod,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
    // endereço do servidor embutido no cliente (só para apps empacotados, ex.: Capacitor)
    __SERVER_URL__: JSON.stringify(process.env.SERVER_URL ?? ''),
  },
  logLevel: 'warning',
};

const tests = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.ts')).map((f) => join(root, 'tests', f));
const nodeOpts = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
  logLevel: 'warning',
};

if (watch) {
  const c = await esbuild.context(clientOpts);
  const s = await esbuild.context({ ...nodeOpts, entryPoints: [join(root, 'server/index.ts')], outfile: join(root, 'dist/server.mjs') });
  await Promise.all([c.watch(), s.watch()]);
  console.log('[build] observando alterações...');
} else {
  await esbuild.build(clientOpts);
  await esbuild.build({ ...nodeOpts, entryPoints: [join(root, 'server/index.ts')], outfile: join(root, 'dist/server.mjs') });
  if (tests.length) {
    await esbuild.build({ ...nodeOpts, entryPoints: tests, outdir: join(root, 'dist/tests'), outExtension: { '.js': '.mjs' } });
  }
  console.log('[build] ok');
}
