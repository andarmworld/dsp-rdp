import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const packageName = 'dsp-rdp'
const result = await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['react', 'react/jsx-runtime'],
})
const code = result.outputFiles[0].text
await mkdir('lib', { recursive: true })
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
})
await writeFile('lib/client.js', `window.__ModuleLoader__.load({
  id: ${JSON.stringify(packageName)},
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
${code}
    return module.exports;
  }
});
`)
