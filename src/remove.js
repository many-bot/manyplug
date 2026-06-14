import fs from 'fs-extra';
import path from 'path';
import { exec } from 'node:child_process';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry } from './registry-ops.js';
import { readEnabled, writeEnabled, resolvePlugin } from './plugins.js';

// ------------------------------------------------------------
// ------------------------------------------------------------
// helpers

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
		const found = await resolvePlugin(name);

		if (!found) {
			console.error(`x ${name}: not installed`);
			results.push({ name, success: false });
      process.stdin.destroy();
			continue;
		}

		const { dir, manifest } = found;
		const size    = await getDirSize(dir);
		const deps    = manifest.dependencies || {};

		console.log(`- ${found.name}@${manifest.version || '?'}  size=${formatSize(size)}  path=${path.relative(process.cwd(), dir)}`);

		if (!options.yes) {
			const answer = await ask('remove? [y/N] ');
			if (answer !== 'y') {
				console.log('  skipped');
				results.push({ name, success: false, skipped: true });
        process.stdin.destroy();
				continue;
			}
		}

		try {
			// disable before removing
      const enabled   = readEnabled();
      const set       = new Set(enabled);
      const keySimple = found.name.toLowerCase();
      const keyFull   = found.manifest.key?.toLowerCase();
      
      if (set.has(keySimple)) set.delete(keySimple);
      if (keyFull && set.has(keyFull)) set.delete(keyFull);
      
      if (set.size !== enabled.size) {
        await writeEnabled([...set]);
        console.log(`  disabled ${found.manifest.key || found.name}`);
      }

			await fs.remove(dir);

			const registry = await loadLocalRegistry();
			// remove by manifest.name or dir basename
			const regKey = Object.keys(registry.plugins || {}).find(k =>
				k === found.name || k.split('/').pop() === found.name
			);
			if (regKey) {
				delete registry.plugins[regKey];
				await saveRegistry(registry);
			}

			console.log(`  done  freed=${formatSize(size)}`);
			results.push({ name, success: true, size });
      process.stdin.destroy();
		} catch (e) {
			console.error(`  FAILED: ${e.message}`);
			results.push({ name, success: false, error: e.message });
      process.stdin.destroy();
		}
	}

	const ok    = results.filter(r => r.success).length;
	const bad   = results.length - ok;
	const freed = results.reduce((a, r) => a + (r.size || 0), 0);

	if (names.length > 1)
		console.log(`\n${ok}/${names.length} removed  freed=${formatSize(freed)}  time=${elapsed(t)}s`);

	if (bad && !results.every(r => r.skipped)) process.exit(1);
}
