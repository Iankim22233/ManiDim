import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/fonts', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, outfile: 'dist/app.js', format: 'iife', target: 'chrome120', minify: false, sourcemap: false, logLevel: 'info' });
await build({ entryPoints: ['src/synth.worker.js'], bundle: true, outfile: 'dist/synth.worker.js', format: 'iife', target: 'chrome120', logLevel: 'info' });
cpSync('index.html', 'dist/index.html');
cpSync('src/styles.css', 'dist/styles.css');
// Nunito (latin) weights used by the UI
for (const w of [600, 700, 800, 900]) {
  cpSync(`node_modules/@fontsource/nunito/files/nunito-latin-${w}-normal.woff2`, `dist/fonts/nunito-${w}.woff2`);
}
cpSync('assets', 'dist/assets', { recursive: true });
console.log('built dist/');
