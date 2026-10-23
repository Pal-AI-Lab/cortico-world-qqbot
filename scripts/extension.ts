import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_API_VERSIONS, parseExtensionManifest, type ExtensionPackageJson } from 'cortico/extensions/manifest.ts';
import { isWorldDefinition, extensionPackageFile } from 'cortico/extensions.ts';
import { checkDescribe, exportDescribe } from 'cortico/extensions/describe-export.ts';
import { collectToolNames, dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { BUILTIN_WORLD_IDS, loadBuiltinWorlds } from 'cortico/worlds/index.ts';
import type { WorldDefinition, WorldSection } from 'cortico/world.ts';
import definition from '../src/index.ts';

// The published SDK exposes the same validators used by check:extension in the Cortico repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as ExtensionPackageJson;
const parsed = parseExtensionManifest(pkg, 'en');
if (!parsed.ok) throw new Error(parsed.reasons.join('\n'));
for (const warning of parsed.warnings) console.warn(warning);
const { manifest } = parsed;
if (manifest.kind !== 'world' || manifest.api !== EXTENSION_API_VERSIONS.world) throw new Error('The manifest must target the installed World contract');
if (!isWorldDefinition(definition)) throw new Error('Invalid World definition');
if (!manifest.webUiClient || !extensionPackageFile(root, manifest.webUiClient)) throw new Error('Missing WebUI bundle');
const scratchDir = mkdtempSync(join(tmpdir(), 'qqofficial-check-'));
const opts = { scratchDir, packageDir: root, repoRoot: root, language: 'en' as const, hasWebUiClient: true };
try {
  if (process.argv[2] === 'describe') {
    const description = await exportDescribe('world', definition, opts);
    if (!description || !manifest.describe) throw new Error('Missing self-description');
    writeFileSync(join(root, manifest.describe), JSON.stringify(description, null, 2) + '\n');
    console.log(`Generated ${manifest.describe}`);
  } else if (process.argv[2] === 'check') {
    if ((BUILTIN_WORLD_IDS as readonly string[]).includes(definition.id)) throw new Error('World id collides with a built-in');
    const builtins: WorldDefinition<WorldSection>[] = [];
    for (const id of BUILTIN_WORLD_IDS) {
      try { builtins.push(...await loadBuiltinWorlds([id])); }
      catch (error) { console.warn(`Skipped tool collision check for unavailable built-in ${id}: ${String(error)}`); }
    }
    const { taken, skipped } = collectToolNames(builtins, opts);
    for (const message of skipped) console.warn(message);
    const reports = [
      await dryMountWorld(definition as WorldDefinition<WorldSection>, { ...opts, takenToolNames: taken }),
      await checkDescribe('world', definition, manifest.describe, opts),
    ];
    for (const report of reports) {
      for (const message of report.ok) console.log(`✓ ${message}`);
      for (const message of report.warnings) console.warn(message);
      for (const message of report.failures) console.error(message);
    }
    if (reports.some((report) => report.failures.length)) process.exitCode = 1;
  } else throw new Error('Usage: tsx scripts/extension.ts describe|check');
} finally { rmSync(scratchDir, { recursive: true, force: true }); }
