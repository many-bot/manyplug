import { discoverPlugins } from './plugins.js';

// ------------------------------------------------------------
// list command
// ------------------------------------------------------------

export async function listCommand(options = {}) {
	const all     = await discoverPlugins();
	const plugins = options.all ? all : all.filter(p => p.isEnabled);

	if (!plugins.length) {
		console.log(options.all ? 'no plugins installed' : 'no enabled plugins  (use --all to see all)');
		return;
	}

	// column widths
	const w = {
    name: Math.max(4, ...plugins.map(p => (p.manifest.key || p.name).length)),
		version:  Math.max(7, ...plugins.map(p => (p.manifest.version || '-').length)),
		category: Math.max(8, ...plugins.map(p => (p.manifest.category || '-').length)),
	};

	const pad    = (s, n) => String(s).padEnd(n);
	const header = `  ${'name'.padEnd(w.name)}  ${'version'.padEnd(w.version)}  ${'category'.padEnd(w.category)}  type  status`;
	console.log(header);
	console.log('  ' + '-'.repeat(header.length - 2));

	for (const p of plugins) {
    const displayName = p.manifest.key || p.name;
		const flag    = p._error ? '!' : ' ';
		const type    = p.manifest.service ? 'svc' : 'std';
		const status  = !p.hasEntry ? 'incomplete' : p.isEnabled ? 'enabled' : 'disabled';
		const version  = p.manifest.version  || '-';
		const category = p.manifest.category || '-';
		console.log(`${flag} ${pad(displayName, w.name)}  ${pad(version, w.version)}  ${pad(category, w.category)}  ${pad(type, 4)}  ${status}`);
	}

	const en  = plugins.filter(p => p.isEnabled).length;
	const dis = plugins.length - en;
	const inc = plugins.filter(p => !p.hasEntry).length;

	console.log('');
	console.log(`total=${plugins.length} enabled=${en} disabled=${dis}${inc ? ' incomplete=' + inc : ''}`);
	console.log('svc=service  std=standard  !=missing index.js');
}
