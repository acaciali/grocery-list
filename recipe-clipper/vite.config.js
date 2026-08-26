import { cpSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * Builds the popup into dist/, which is the folder you load into Chrome -- NOT this one.
 *
 * The build exists so the popup can import @grocery/shared and run ingredient lines through
 * the real normalizeKey(). That is the whole point: a recipe clipped here and a recipe typed
 * into RecipePage must produce the same ItemKey, or the pantry match silently stops working.
 *
 * manifest.json and icons/ live in public/ so THIS directory is not a loadable extension.
 * Deliberate: popup.js imports bare specifiers ("@grocery/shared/items") that a browser
 * cannot resolve, so loading the source folder gives a popup frozen on its first panel --
 * and Chrome's reload button re-reads whichever path you first picked, so the mistake
 * sticks. With no manifest here, Chrome refuses the folder and says why.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // MV3's default CSP is script-src 'self', so nothing may be inlined into the HTML.
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: { input: { popup: 'popup.html' } },
  },
  plugins: [
    {
      name: 'copy-injected-parser',
      closeBundle() {
        // Copied verbatim, not bundled: chrome.scripting injects it as a CLASSIC script,
        // which cannot contain import/export syntax. Path must stay src/recipe-parser.js --
        // popup.js names it in executeScript.
        mkdirSync('dist/src', { recursive: true });
        cpSync('src/recipe-parser.js', 'dist/src/recipe-parser.js');
      },
    },
  ],
});
