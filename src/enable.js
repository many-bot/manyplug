import fs from 'fs-extra';
import { PLUGINS_DIR, CONF_PATH } from './paths.js';
import { readEnabled, writeEnabled, resolvePlugin } from './plugins.js';

// ------------------------------------------------------------
// enable / disable commands
// ------------------------------------------------------------

async function toggle(names, action) {
	if (!names.length) {
		console.error(`usage: manyplug ${action} <plugin> [plugin2...]`);
		process.exit(1);
	}

	const t       = Date.now();
	const enabled = readEnabled();
	const set     = new Set(enabled);
	const results = [];

	for (const name of names) {
		if (action === 'enable') {
			const found = await resolvePlugin(name);
			if (!found) {
				console.error(`x ${name}: not installed`);
				results.push({ name, changed: false, notFound: true });
				continue;
			}
		}
		const key     = name.toLowerCase();
		const was     = set.has(key);
		if (action === 'enable') set.add(key);
		else                     set.delete(key);
		const changed = set.has(key) !== was;
		results.push({ name, changed });
	}

	const changed = results.filter(r => r.changed);

	if (changed.length) {
		try {
			await writeEnabled([...set]);
		} catch (e) {
			console.error(`error: ${e.message}`);
			process.exit(1);
		}
	}

	for (const r of results) {
		if (r.notFound) continue;
		const symbol = action === 'enable' ? '+' : '-';
		const note   = r.changed ? '' : ` (already ${action}d)`;
		console.log(`${symbol} ${r.name}${note}`);
	}

	if (names.length > 1) {
		const notFound = results.filter(r => r.notFound).length;
		console.log(`${changed.length}/${names.length} changed  (${((Date.now() - t) / 1000).toFixed(2)}s)${notFound ? `  ${notFound} not found` : ''}`);
	}

	if (results.some(r => r.notFound)) process.exit(1);
}

export function enableCommand(input) {
	const names = Array.isArray(input) ? input : (input ? [input] : []);
	return toggle(names, 'enable');
}

export function disableCommand(input) {
	const names = Array.isArray(input) ? input : (input ? [input] : []);
	return toggle(names, 'disable');
}
