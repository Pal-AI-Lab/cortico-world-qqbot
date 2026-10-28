// Market screenshots: bundle the real panels with sample data, serve them, and capture with Chrome.
//   node scripts/screenshots/build.mjs            bundle into scratch/screenshots/
//   node scratch/screenshots/serve.mjs            serve on http://127.0.0.1:8977/page.html
//   chrome --headless=new --window-size=1280,<height> --screenshot=assets/screenshots/<name>-zh.png
//     http://127.0.0.1:8977/page.html#connection | #connected | #configuration
// Heights used for 0.3.2: connection 1058, connected 875, configuration 1424.
import { copyFileSync, mkdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const here = join(root, 'scripts', 'screenshots');
const out = join(root, 'scratch', 'screenshots');
mkdirSync(out, { recursive: true });
for (const name of ['page.html', 'serve.mjs']) copyFileSync(join(here, name), join(out, name));
copyFileSync(join(root, 'assets', 'icon.svg'), join(out, 'icon.svg'));
copyFileSync(join(root, 'node_modules', 'cortico', 'src', 'web', 'public', 'styles.css'), join(out, 'styles.css'));
// esbuild comes with tsx.
const require = createRequire(join(realpathSync(join(root, 'node_modules', 'tsx')), 'package.json'));
await require('esbuild').build({
  entryPoints: [join(here, 'entry.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outfile: join(out, 'entry.js'), logLevel: 'warning',
});
console.log(`Built ${out}`);
