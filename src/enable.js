import { readEnabled, writeEnabled, resolvePlugin, discoverPlugins } from './plugins.js';

// ------------------------------------------------------------
// enable / disable commands
// ------------------------------------------------------------

async function toggle(names, action, options = {}) {
	const t       = Date.now();
	const enabled = readEnabled();
	const set     = new Set(enabled);

	// --all: operate on every installed plugin
	if (options.all) {
		const all = await discoverPlugins();
		if (!all.length) { console.log('no plugins installed'); return; }
		for (const p of all) {
			const key = (p.manifest.key || p.manifest.name).toLowerCase();
			if (action === 'enable') set.add(key);
			else                     set.delete(key);
		}
		await writeEnabled([...set]);
		const symbol = action === 'enable' ? '+' : '-';
		for (const p of all) console.log(`${symbol} ${p.id}`);
		console.log(`${all.length} plugins ${action}d  (${((Date.now() - t) / 1000).toFixed(2)}s)`);
		return;
	}

	if (!names.length) {
		console.error(`usage: manyplug ${action} <plugin> [plugin2...]  [--all]`);
		process.exit(1);
	}

	const results = [];

	for (const name of names) {
		const found = await resolvePlugin(name);

		if (action === 'enable' && !found) {
			console.error(`x ${name}: not installed`);
			results.push({ name, changed: false, notFound: true });
			continue;
		}

		const key = found
			? (found.manifest.key || found.manifest.name).toLowerCase()
			: name.toLowerCase();

		const was = set.has(key);
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

export function enableCommand(input, options = {}) {
	const names = Array.isArray(input) ? input : (input ? [input] : []);
	return toggle(names, 'enable', options);
}

export function disableCommand(input, options = {}) {
	const names = Array.isArray(input) ? input : (input ? [input] : []);
	return toggle(names, 'disable', options);
}
