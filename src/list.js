import fs from 'fs-extra';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

import { PLUGINS_DIR, CONF_PATH } from "./paths.js";

// ------------------------------------------------------------
// conf — reuse same parser as enable-disable reads
// ------------------------------------------------------------

function readEnabled() {
	if (!existsSync(CONF_PATH)) return new Set();
	const match = readFileSync(CONF_PATH, 'utf-8').match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
	if (!match) return new Set();
	return new Set(match[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

// ------------------------------------------------------------
// list command
// ------------------------------------------------------------

export async function listCommand(options = {}) {
	if (!await fs.pathExists(PLUGINS_DIR)) {
		console.error(`error: plugins dir not found: ${PLUGINS_DIR}`);
		return;
	}

	const enabled = readEnabled();
	const entries = (await fs.readdir(PLUGINS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
	const plugins = [];

	for (const entry of entries) {
		const dir          = path.join(PLUGINS_DIR, entry.name);
		const manifestPath = path.join(dir, 'manyplug.json');
		const hasEntry     = await fs.pathExists(path.join(dir, 'index.js'));
		const isEnabled    = enabled.has(entry.name.toLowerCase());

		if (!isEnabled && !options.all) continue;

		let manifest = {};
		try { manifest = await fs.readJson(manifestPath); }
		catch { manifest = { name: entry.name, version: '?', category: '?', _error: true }; }

		plugins.push({
			name:     manifest.name || entry.name,
			version:  manifest.version || '-',
			category: manifest.category || '-',
			service:  manifest.service === true,
			local:    manifest.local   === true,
			enabled:  isEnabled,
			hasEntry,
			_error:   manifest._error || false,
		});
	}

	if (!plugins.length) {
		console.log(options.all ? 'no plugins installed' : 'no enabled plugins  (use --all to see all)');
		return;
	}

	// column widths
	const w = {
		name:     Math.max(4, ...plugins.map(p => p.name.length)),
		version:  Math.max(7, ...plugins.map(p => p.version.length)),
		category: Math.max(8, ...plugins.map(p => p.category.length)),
	};

	const pad = (s, n) => s.padEnd(n);
	const header = `  ${'name'.padEnd(w.name)}  ${'version'.padEnd(w.version)}  ${'category'.padEnd(w.category)}  type  status`;
	console.log(header);
	console.log('  ' + '-'.repeat(header.length - 2));

	for (const p of plugins) {
		const flag   = p.local ? 'L' : p._error ? '!' : ' ';
		const type   = p.service ? 'svc' : 'std';
		const status = !p.hasEntry ? 'incomplete' : p.enabled ? 'enabled' : 'disabled';
		console.log(`${flag} ${pad(p.name, w.name)}  ${pad(p.version, w.version)}  ${pad(p.category, w.category)}  ${pad(type, 4)}  ${status}`);
	}

	// summary
	const en   = plugins.filter(p => p.enabled).length;
	const dis  = plugins.length - en;
	const loc  = plugins.filter(p => p.local).length;
	const inc  = plugins.filter(p => !p.hasEntry).length;

	console.log('');
	console.log(`total=${plugins.length} enabled=${en} disabled=${dis}${loc ? ' local=' + loc : ''}${inc ? ' incomplete=' + inc : ''}`);
	console.log('L=local  svc=service  std=standard  !=missing index.js');
}
