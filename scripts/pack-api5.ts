import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const folder = join(root, 'dist', 'api5');
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
for (const file of pkg.files) cpSync(join(root, file), join(folder, file), { recursive: true });
// API 5 hosts cache client assets by package version with immutable headers.
const clientRevision = createHash('sha256').update(readFileSync(join(root, pkg.cortico.webUiClient))).digest('hex').slice(0, 12);
pkg.version += `-api5.ui${clientRevision}`;
pkg.main = './src/legacy.ts';
pkg.cortico.api = 5;
pkg.cortico.consoleClient = pkg.cortico.webUiClient;
delete pkg.cortico.webUiClient;
delete pkg.scripts;
delete pkg.devDependencies;
writeFileSync(join(folder, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--pack-destination', join(root, 'dist')], { cwd: folder, stdio: 'inherit' });
