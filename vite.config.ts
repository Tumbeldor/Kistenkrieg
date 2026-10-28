import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Relative base so the build works on any static host or sub-path (GitHub Pages, Netlify, itch.io ...).
// Single-file output: the whole game ends up in dist/index.html.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100000000 },
});
