import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';

const VALID_CATEGORIES = ['integration', 'games', 'media', 'utility', 'service', 'admin', 'fun'];

// ------------------------------------------------------------
// rules — each returns an error string or null
// ------------------------------------------------------------

const RULES = {
	name: v =>
		typeof v !== 'string' || !v        ? 'required string'
		: !/^[a-z0-9-]+$/.test(v)          ? 'lowercase letters, numbers, hyphens only'
		: v.length < 2 || v.length > 50    ? 'length must be 2-50'
		: null,

	key: v => {
		if (v === undefined) return null; // optional but validated if present
		if (typeof v !== 'string') return 'must be string';
		if (!/^[a-zA-Z0-9_-]+\/[a-z0-9-]+$/.test(v)) return 'must be format author/name';
		return null;
	},

	version: v =>
		typeof v !== 'string' || !v        ? 'required string'
		: null,

	category: v => !VALID_CATEGORIES.includes(v)
		? `must be one of: ${VALID_CATEGORIES.join(', ')}`
		: null,

	author: v => {
		if (v === undefined || v === null) return null;
		if (typeof v === 'string') return null; // legacy plain string ok
		if (typeof v !== 'object') return 'must be string or object';
		if (!v.name || typeof v.name !== 'string') return 'author.name must be a string';
		return null;
	},

	service:  v => v !== undefined && typeof v !== 'boolean' ? 'must be boolean' : null,
	local:    v => v !== undefined && typeof v !== 'boolean' ? 'must be boolean' : null,
	main:     v => v !== undefined && typeof v !== 'string'  ? 'must be string'  : null,

	dependencies: v =>
		v !== undefined && typeof v !== 'object' ? 'must be object' : null,

	externalDependencies: v => {
		if (v === undefined) return null;
		if (typeof v !== 'object') return 'must be object';
		for (const [n, c] of Object.entries(v)) {
			if (typeof c === 'string') continue;
			if (typeof c !== 'object') return `${n}: must be string or object`;
			if (c.command  !== undefined && typeof c.command  !== 'string')  return `${n}.command must be string`;
			if (c.optional !== undefined && typeof c.optional !== 'boolean') return `${n}.optional must be boolean`;
		}
		return null;
	},
};

const REQUIRED = ['name', 'version', 'category'];
const KNOWN    = new Set([
	...REQUIRED,
	'key', 'author', 'service', 'local', 'description',
	'license', 'main', 'dependencies', 'externalDependencies',
]);

function commandExists(cmd) {
	try {
		execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'pipe' });
		return true;
	} catch { return false; }
}

// ------------------------------------------------------------
// validate command
// ------------------------------------------------------------

export async function validateCommand(pluginPath = '.') {
	const abs = path.resolve(pluginPath);

	if (!await fs.pathExists(abs)) {
		console.error(`error: path not found: ${pluginPath}`);
		process.exit(1);
	}

	const manifestPath = path.join(abs, 'manyplug.json');
	if (!await fs.pathExists(manifestPath)) {
		console.error(`error: manyplug.json not found in ${pluginPath}`);
		console.error('  hint: run "manyplug init <name>" to scaffold a plugin');
		process.exit(1);
	}

	let manifest;
	try { manifest = await fs.readJson(manifestPath); }
	catch (e) { console.error(`error: invalid manyplug.json: ${e.message}`); process.exit(1); }

	const errors = [], warnings = [];
	const err  = (field, msg) => errors.push(`  error   ${field.padEnd(24)} ${msg}`);
	const warn = (field, msg) => warnings.push(`  warning ${field.padEnd(24)} ${msg}`);

	// required fields
	for (const f of REQUIRED)
		if (!(f in manifest)) err(f, 'missing required field');

	// field rules
	for (const [f, v] of Object.entries(manifest)) {
		if (!KNOWN.has(f)) { warn(f, 'unknown field'); continue; }
		const msg = RULES[f]?.(v);
		if (msg) err(f, msg);
	}

	// key consistency check
	if (manifest.key && manifest.name) {
		const expectedSuffix = `/${manifest.name}`;
		if (!manifest.key.endsWith(expectedSuffix))
			warn('key', `key suffix doesn't match name (expected .../${manifest.name})`);
	}

	// recommended fields
	if (!manifest.key)    warn('key',    'missing key (author/name) — required for publishing');
	if (!manifest.author) warn('author', 'missing author — recommended for publishing');

	// entry point
	const main = manifest.main || 'index.js';
	if (!await fs.pathExists(path.join(abs, main)))
		warn('main', `entry point not found: ${main}`);

	// locale
	if (!await fs.pathExists(path.join(abs, 'locale')))
		warn('locale', 'no locale/ directory (i18n recommended)');

	// external deps
	for (const [n, c] of Object.entries(manifest.externalDependencies || {})) {
		const cmd = typeof c === 'string' ? c : c.command;
		const opt = typeof c === 'object' && c.optional;
		if (!commandExists(cmd))
			(opt ? warn : err)(`externalDeps.${n}`, `command not found: ${cmd}`);
	}

	// output
	const name = manifest.name || path.basename(abs);
	console.log(`${name}@${manifest.version || '?'}  path=${abs}`);

	if (errors.length || warnings.length) {
		if (errors.length)   console.log('\n' + errors.join('\n'));
		if (warnings.length) console.log('\n' + warnings.join('\n'));
	} else {
		console.log('ok  all checks passed');
	}

	console.log(`\nerrors=${errors.length}  warnings=${warnings.length}`);
	if (errors.length) process.exit(1);
}
