import fs from 'fs-extra';
import path from 'path';
import { exec } from 'node:child_process';
import readline from 'node:readline';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry } from './registry-ops.js';
import { readEnabled, writeEnabled, resolvePlugin } from './plugins.js';
import { DATA_DIR } from './paths.js';

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

function ask(prompt) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    process.stdout.write(prompt);
    rl.once('line', line => { rl.close(); res(line.trim()?.toLowerCase()); });
  });
}

export function normalizeManifest(manifest) {
	if (!manifest?.name) throw new Error("invalid manifest: missing name");

	const key =
		typeof manifest.key === "string" && /^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(manifest.key)
			? manifest.key
			: `manydev/${manifest.name}`;

	return {
		...manifest,
		name: manifest.name,
		key
	};
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
			continue;
		}
		const { dir, manifest } = found;
    if (!dir || typeof dir !== "string") {
      console.error(`  FAILED: invalid plugin dir for ${name}`);
	    results.push({ name, success: false });
	    continue;
    }
		let size = await getDirSize(dir);
		console.log(`- ${found.name}@${manifest.version || '?'}  size=${formatSize(size)}  path=${path.relative(process.cwd(), dir)}`);
		if (!options.yes && !options.Y) {
			const answer = await ask('remove? [y/N] ');
			if (answer !== 'y') {
				console.log('  skipped');
				results.push({ name, success: false, skipped: true });
				continue;
			}
		}
		try {
			const enabled   = readEnabled();
			const set       = new Set(enabled);
      const keySimple = found.name?.toLowerCase();
			const keyFull   = found.manifest.key?.toLowerCase();
			if (set.has(keySimple)) set.delete(keySimple);
			if (keyFull && set.has(keyFull)) set.delete(keyFull);
			if (set.size !== enabled.size) {
				await writeEnabled([...set]);
				console.log(`  disabled ${found.manifest.key || found.name}`);
			}
			await fs.remove(dir);
			const registry = await loadLocalRegistry();
			const regKey = Object.keys(registry.plugins || {}).find(k =>
				k === found.name || k.split('/').pop() === found.name
			);
			if (regKey) {
				delete registry.plugins[regKey];
				await saveRegistry(registry);
			}

			// offer to remove data dir
			const dataKey  = found.manifest.key || found.name;
			const dataPath = path.join(DATA_DIR, dataKey);
			if (await fs.pathExists(dataPath)) {
				const dataSize = await getDirSize(dataPath);
				if (options.Y) {
					await fs.remove(dataPath);
					size += dataSize;
					console.log(`  removed data  freed=${formatSize(dataSize)}`);
				} else {
					const rmData = await ask(`  remove data too? (${formatSize(dataSize)}) [y/N] `);
					if (rmData === 'y') {
						await fs.remove(dataPath);
						size += dataSize;
						console.log(`  removed data`);
					} else {
						console.log(`  kept data`);
					}
				}
			}

			console.log(`  done  freed=${formatSize(size)}`);
			results.push({ name, success: true, size });
		} catch (e) {
			console.error(`  FAILED: ${e.message}`);
			results.push({ name, success: false, error: e.message });
		}
	}

	const ok    = results.filter(r => r.success).length;
	const bad   = results.length - ok;
	const freed = results.reduce((a, r) => a + (r.size || 0), 0);
	if (names.length > 1)
		console.log(`\n${ok}/${names.length} removed  freed=${formatSize(freed)}  time=${elapsed(t)}s`);
	if (results.some(r => !r.success && !r.skipped)) process.exit(1);
}
