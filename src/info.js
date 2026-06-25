import path from 'path';
import { resolvePlugin } from './plugins.js';
import { PLUGINS_DIR, DATA_DIR } from './paths.js';
import { getDirSize } from './utils.js';
import { formatSize } from './ui.js';
import fs from 'fs-extra';

// ------------------------------------------------------------
// info command
// ------------------------------------------------------------

export async function infoCommand(name) {
	if (!name) {
		console.error('usage: manyplug info <plugin>');
		process.exit(1);
	}

	const found = await resolvePlugin(name);
	if (!found) {
		console.error(`x ${name}: not installed`);
		process.exit(1);
	}

	const { dir, manifest, isEnabled, hasEntry, _error } = found;
	const m = manifest;

	const pluginSize = await getDirSize(dir);

	const dataKey  = m.key || m.name;
	const dataPath = path.join(DATA_DIR, dataKey);
	const hasData  = await fs.pathExists(dataPath);
	const dataSize = hasData ? await getDirSize(dataPath) : 0;

	const relDir  = path.relative(process.cwd(), dir);
	const status  = !hasEntry ? 'incomplete' : isEnabled ? 'enabled' : 'disabled';
	const type    = m.service ? 'service' : 'standard';

	console.log(`${m.key || m.name}@${m.version || '?'}`);
	console.log('');

	const row = (label, value) => console.log(`  ${label.padEnd(16)} ${value}`);

	row('name',     m.name     || '-');
	row('key',      m.key      || '-');
	row('version',  m.version  || '-');
	row('category', m.category || '-');
	row('author',   typeof m.author === 'object' ? m.author.name : (m.author || '-'));
	row('license',  m.license  || '-');
  row('repo',     m.repo     || '-');
	row('type',     type);
	row('status',   status);
	row('main',     m.main || 'index.js');
	row('path',     relDir);
	row('size',     formatSize(pluginSize));
	row('data',     hasData ? `${dataPath}  (${formatSize(dataSize)})` : 'none');

	if (m.description) {
		console.log('');
		console.log(`  ${m.description}`);
	}

	if (m.dependencies && Object.keys(m.dependencies).length) {
		console.log('');
		console.log('  dependencies:');
		for (const [dep, ver] of Object.entries(m.dependencies))
			console.log(`    ${dep}@${ver}`);
	}

	if (m.externalDependencies && Object.keys(m.externalDependencies).length) {
		console.log('');
		console.log('  external deps:');
		for (const [dep, cfg] of Object.entries(m.externalDependencies)) {
			const cmd = typeof cfg === 'string' ? cfg : cfg.command;
			const opt = typeof cfg === 'object' && cfg.optional ? ' (optional)' : '';
			console.log(`    ${dep}: ${cmd}${opt}`);
		}
	}

	if (_error) {
		console.log('');
		console.warn('  warn: manyplug.json could not be parsed');
	}
}
