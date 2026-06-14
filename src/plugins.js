import fs from 'fs-extra';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { PLUGINS_DIR, CONF_PATH } from './paths.js';

// ------------------------------------------------------------
// conf helpers
// ------------------------------------------------------------

export function readEnabled() {
	if (!existsSync(CONF_PATH)) return new Set();
	const match = readFileSync(CONF_PATH, 'utf-8').match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
	if (!match) return new Set();
	return new Set(match[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

export async function writeEnabled(plugins) {
	await fs.writeFile(CONF_PATH, `PLUGINS=[\n${plugins.map(p => p + ',').join('\n')}\n]\n`, 'utf-8');
}

// ------------------------------------------------------------
// recursive manifest finder
// Walks pluginsDir up to maxDepth looking for manyplug.json.
// Returns array of { dir, manifest, hasEntry, isEnabled }.
// ------------------------------------------------------------

async function findManifests(dir, enabled, depth = 0, maxDepth = 2) {
	const results = [];
	if (!await fs.pathExists(dir)) return results;

	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const sub = path.join(dir, entry.name);
		const mp  = path.join(sub, 'manyplug.json');

		if (await fs.pathExists(mp)) {
			let manifest = {};
			let _error   = false;
			try { manifest = await fs.readJson(mp); }
			catch { _error = true; manifest = { name: entry.name, version: '?', category: '?' }; }

			const name      = manifest.name || entry.name;
			const hasEntry  = await fs.pathExists(path.join(sub, manifest.main || 'index.js'));
      const key       = manifest.key?.toLowerCase();
      const isEnabled = enabled.has(name.toLowerCase()) || (key && enabled.has(key));

			results.push({ dir: sub, name, manifest, hasEntry, isEnabled, _error });
		} else if (depth < maxDepth) {
			results.push(...await findManifests(sub, enabled, depth + 1, maxDepth));
		}
	}

	return results;
}

export async function discoverPlugins() {
	const enabled = readEnabled();
	return findManifests(PLUGINS_DIR, enabled);
}

// Resolve a user-supplied name to a discovered plugin entry.
// Matches manifest.name first, then directory basename.
export async function resolvePlugin(name) {
  const all = await discoverPlugins();
  const matches = all.filter(p =>
    p.manifest.key === name ||
    p.manifest.name === name ||
    path.relative(PLUGINS_DIR, p.dir) === name ||
    path.basename(p.dir) === name
  );

  if (matches.length > 1) {
    console.error(`ambiguous: "${name}" matches multiple plugins:`);
    for (const m of matches)
      console.error(`  ${m.manifest.key || m.name}`);
    console.error('use the full key to specify');
    process.exit(1);
  }

  return matches[0] ?? null;
}
