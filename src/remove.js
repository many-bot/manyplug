import fs from 'fs-extra';
import path from 'path';
import { exec } from 'node:child_process';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry } from './registry-ops.js';

import { PLUGINS_DIR } from './paths.js';

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }

function run(cmd, cwd) {
	return new Promise((res, rej) =>
		exec(cmd, { cwd }, (err, stdout) => err ? rej(err) : res(stdout))
	);
}

async function getDirSize(dir) {
	let total = 0;
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		total += entry.isDirectory() ? await getDirSize(p) : (await fs.stat(p)).size;
	}
	return total;
}

async function ask(prompt) {
	process.stdout.write(prompt);
	return new Promise(res => process.stdin.once('data', d => res(d.toString().trim().toLowerCase())));
}

// ------------------------------------------------------------
// remove command
// ------------------------------------------------------------

export async function removeCommand(input, options = {}) {
	const t     = Date.now();
	const names = Array.isArray(input) ? input : (input ? [input] : []);

	if (!names.length) {
		console.error('usage: manyplug remove <plugin> [plugin2...]');
		process.exit(1);
	}

	const results = [];

	for (const name of names) {
		const dir          = path.join(PLUGINS_DIR, name);
		const manifestPath = path.join(dir, 'manyplug.json');

		if (!await fs.pathExists(manifestPath)) {
			console.error(`x ${name}: not installed`);
			results.push({ name, success: false });
			continue;
		}

		let manifest = {};
		try { manifest = await fs.readJson(manifestPath); } catch {}

		const size = await getDirSize(dir);
		const deps = manifest.dependencies || {};
		const hasDeps = Object.keys(deps).length > 0;

		console.log(`- ${name}@${manifest.version || '?'}  size=${formatSize(size)}  path=${path.relative(process.cwd(), dir)}`);
		if (hasDeps) console.log(`  deps: ${Object.keys(deps).join(', ')}`);

		if (!options.yes) {
			const answer = await ask('remove? [y/N] ');
			if (answer !== 'y') {
				console.log(`  skipped`);
				results.push({ name, success: false, skipped: true });
				continue;
			}
		}

		try {
			await fs.remove(dir);

			const registry = await loadLocalRegistry();
			delete registry.plugins[name];
			await saveRegistry(registry);

			if (hasDeps && options.removeDeps) {
				process.stdout.write(`  uninstalling npm deps... `);
				try {
					await run(`npm uninstall ${Object.keys(deps).join(' ')}`, process.cwd());
					console.log('ok');
				} catch (e) {
					console.log(`warn: ${e.message}`);
				}
			}

			console.log(`  done  freed=${formatSize(size)}`);
			results.push({ name, success: true, size });
		} catch (e) {
			console.error(`  FAILED: ${e.message}`);
			results.push({ name, success: false, error: e.message });
		}
	}

	// summary
	const ok      = results.filter(r => r.success).length;
	const bad     = results.length - ok;
	const freed   = results.reduce((a, r) => a + (r.size || 0), 0);

	if (names.length > 1) {
		console.log(`\n${ok}/${names.length} removed  freed=${formatSize(freed)}  time=${elapsed(t)}s`);
	}

	if (bad && !results.every(r => r.skipped)) process.exit(1);
}
