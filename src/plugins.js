import fs from 'fs-extra';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse as parseToml } from 'smol-toml';
import { PLUGINS_DIR, CONF_PATH, TOML_PLUGIN_FILE } from './paths.js';

// ---------------------------------------------------------------------------
// conf helpers
//
// Read precedence: TOML > legacy .conf  (mirrors config.js merge order)
// Write target:   TOML if the file exists, otherwise legacy .conf
//
// Once the user has run `manyplug migrate-config`, only TOML_PLUGIN_FILE
// exists and .conf is never touched again.
// ---------------------------------------------------------------------------

export function readEnabled() {
	// -- TOML (preferred) --
	if (existsSync(TOML_PLUGIN_FILE)) {
		try {
			const raw     = readFileSync(TOML_PLUGIN_FILE, 'utf-8');
			const parsed  = parseToml(raw);
			const plugins = Array.isArray(parsed.PLUGINS) ? parsed.PLUGINS : [];
			return new Set(plugins.map(p => String(p).toLowerCase()).filter(Boolean));
		} catch {
			// corrupted TOML — fall through to legacy so the CLI doesn't brick
		}
	}

	// -- legacy .conf fallback (frozen) --
	if (!existsSync(CONF_PATH)) return new Set();
	const match = readFileSync(CONF_PATH, 'utf-8').match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
	if (!match) return new Set();
	return new Set(match[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

export async function writeEnabled(plugins) {
	if (existsSync(TOML_PLUGIN_FILE)) {
		// Overwrite, preserving only the canonical header.
		// manyplug.toml is a managed file — user edits go above PLUGINS.
		const items   = plugins.map(p => `"${p}"`).join(', ');
		const content = `# ManyPlug plugin list — managed by manyplug\n\nPLUGINS = [${items}]\n`;
		await fs.writeFile(TOML_PLUGIN_FILE, content, 'utf-8');
	} else {
		// Legacy .conf — keep format identical for parser compatibility
		await fs.writeFile(
			CONF_PATH,
			`PLUGINS=[\n${plugins.map(p => p + ',').join('\n')}\n]\n`,
			'utf-8',
		);
	}
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
