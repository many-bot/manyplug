import fs from 'fs-extra';
import path from 'path';

const CONF_PATH   = path.join(process.cwd(), 'manyplug.conf');
const PLUGINS_DIR = path.join(process.cwd(), 'src', 'plugins');

// ------------------------------------------------------------
// conf file — PLUGINS=[a,b,c]
// ------------------------------------------------------------

async function readEnabled() {
	if (!await fs.pathExists(CONF_PATH)) return [];
	const raw = await fs.readFile(CONF_PATH, 'utf-8');
	const match = raw.match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
	if (!match) return [];
	return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

async function writeEnabled(plugins) {
	await fs.writeFile(CONF_PATH, `PLUGINS=[\n${plugins.map(p => p + ',').join('\n')}\n]\n`, 'utf-8');
}

// ------------------------------------------------------------
// enable / disable commands
// ------------------------------------------------------------

async function toggle(names, action) {
	if (!names.length) {
		console.error(`usage: manyplug ${action} <plugin> [plugin2...]`);
		process.exit(1);
	}

	const t       = Date.now();
	const enabled = await readEnabled();
	const set     = new Set(enabled);
	const results = [];

	for (const name of names) {
		if (action === 'enable' && !await fs.pathExists(path.join(PLUGINS_DIR, name))) {
			console.error(`x ${name}: not installed`);
			results.push({ name, changed: false, notFound: true });
			continue;
		}
		const was = set.has(name);
		if (action === 'enable')  set.add(name);
		else                      set.delete(name);
		const changed = set.has(name) !== was;
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
		if (r.notFound) continue; // already printed above
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

