import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';
import readline from 'node:readline';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry, fetchRemoteRegistry } from './registry-ops.js';
import { getDirSize, installPluginFromTarball, installNpmDeps } from './utils.js';
import { PLUGINS_DIR, DATA_DIR } from './paths.js';
import { discoverPlugins } from './plugins.js';

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function shortName(pluginName) {
	return pluginName.includes('/') ? pluginName.split('/').pop() : pluginName;
}

function commandExists(cmd) {
	try {
		execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'pipe' });
		return true;
	} catch { return false; }
}

function checkExternalDeps(manifest) {
	const ext = manifest.externalDependencies;
	if (!ext || !Object.keys(ext).length) return { missing: [], optional: [] };
	const missing = [], optional = [];
	for (const [name, cfg] of Object.entries(ext)) {
		if (commandExists(typeof cfg === 'string' ? cfg : cfg.command)) continue;
		(cfg?.optional ? optional : missing).push(name);
	}
	return { missing, optional };
}

function reportExternalDeps(manifest) {
	const { missing, optional } = checkExternalDeps(manifest);
	if (missing.length)  console.warn(`warn: missing external deps: ${missing.join(', ')}`);
	if (optional.length) console.log(`info: optional deps not found: ${optional.join(', ')}`);
	return { missing, optional };
}

async function installDeps(manifest, targetDir) {
	const deps = manifest.dependencies;
	if (!deps || !Object.keys(deps).length) return;
	console.log('  installing npm deps...');
	await installNpmDeps(deps, targetDir);
}

async function registerPlugin(pluginName, manifest, extra = {}) {
	const registry = await loadLocalRegistry();
	registry.plugins[pluginName] = { ...manifest, ...extra };
	await saveRegistry(registry);
}

// ------------------------------------------------------------
// install from local path
// ------------------------------------------------------------

async function installFromLocal(sourcePath, options = {}) {
	const src = path.resolve(sourcePath);

	if (!await fs.pathExists(src))
		return { success: false, error: `path not found: ${src}` };

	const manifestPath = path.join(src, 'manyplug.json');
	if (!await fs.pathExists(manifestPath))
		return { success: false, error: 'manyplug.json not found' };

	let manifest;
	try { manifest = await fs.readJson(manifestPath); }
	catch (e) { return { success: false, error: `invalid manyplug.json: ${e.message}` }; }

	const pluginName = manifest.name || path.basename(src);

	// resolve dest: prefer key from manifest, fallback to manydev/<name>
	let destKey;
	if (manifest.key) {
		destKey = manifest.key;
	} else {
		destKey = `manydev/${pluginName}`;
		console.warn(`warn: no key in manyplug.json — installing as ${destKey}`);
		console.warn(`  hint: add "key": "yourname/${pluginName}" to manyplug.json`);
	}

	const dest = path.join(PLUGINS_DIR, destKey);

	// reinstall: wipe existing install silently (dev workflow friendly)
	if (await fs.pathExists(dest)) {
		if (options.force) {
			await fs.remove(dest);
		} else {
			// still reinstall, just let the user know
			console.log(`~ ${destKey} already installed, reinstalling...`);
			await fs.remove(dest);
		}
	}

	const size = await getDirSize(src);
	console.log(`installing ${destKey}  src=${src}  size=${formatSize(size)}`);
	reportExternalDeps(manifest);

	try {
		await fs.ensureDir(path.dirname(dest));
		await fs.copy(src, dest);
		await fs.ensureDir(path.join(DATA_DIR, destKey));
		await installDeps(manifest, dest);
		await registerPlugin(destKey, { ...manifest, key: manifest.key || destKey, local: true });
		return { success: true, plugin: destKey, size };
	} catch (e) {
		return { success: false, error: e.message, plugin: destKey };
	}
}

// ------------------------------------------------------------
// install single plugin from remote registry
// ------------------------------------------------------------

async function installFromRegistry(pluginName, manifest, branch) {
	const t    = Date.now();
	const name = shortName(pluginName);

	if (!manifest.repos)
		return { success: false, error: `no repos defined for ${pluginName}`, plugin: name };

	try {
		const result = await installPluginFromTarball({ name, repos: manifest.repos, branch }, PLUGINS_DIR);
		const dataKey = result.manifest.key || result.manifest.name;
		reportExternalDeps(result.manifest);
		await installDeps(result.manifest, result.finalPath);
		await fs.ensureDir(path.join(DATA_DIR, dataKey));
		await registerPlugin(dataKey, result.manifest);
		return { success: true, plugin: name, size: result.size, duration: Date.now() - t };
	} catch (e) {
		return { success: false, error: e.message, plugin: name };
	}
}

// ------------------------------------------------------------
// install command (entry point)
// ------------------------------------------------------------

export async function installCommand(pluginsInput, options = {}) {
	const t     = Date.now();
  const names = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []); // ensures that is an array :)

	await fs.ensureDir(PLUGINS_DIR);

	// -- local install --
	if (options.local) {
		const r = await installFromLocal(options.local, options);
		if (!r.success) { console.error(r.error); process.exit(1); }
		console.log(`installed ${r.plugin}  size=${formatSize(r.size)}  time=${elapsed(t)}s`);

		if (options.watch) {
			const src = path.resolve(options.local);
			console.log(`watching ${src} ...`);
			let debounce = null;
			fs.watch(src, { recursive: true }, (event, filename) => {
				if (filename?.includes('node_modules')) return;
				clearTimeout(debounce);
				debounce = setTimeout(async () => {
					process.stdout.write(`  ${filename} changed, reinstalling... `);
					const rw = await installFromLocal(options.local, { ...options, force: true });
					console.log(rw.success ? `ok (${formatSize(rw.size)})` : `FAILED: ${rw.error}`);
				}, 300);
			});
			await new Promise(() => {}); // keep alive
		}

		return;
	}

	if (!names.length) { console.error('usage: manyplug install <plugin>'); process.exit(1); }

	// -- fetch remote registry --
	let remoteRegistry;
	try {
		remoteRegistry = await fetchRemoteRegistry();
	} catch (e) {
		console.error(`failed: ${e.message}`);
		process.exit(1);
	}

	// -- classify plugins --
	const queue = [], notFound = [];

	for (const name of names) {
		const manifest = remoteRegistry.plugins[name];
		if (!manifest) { notFound.push(name); continue; }
		queue.push({ name, version: manifest.version, manifest });
	}

	if (notFound.length) console.error(`not found: ${notFound.join(', ')}`);
	if (!queue.length) { console.log('nothing to do'); process.exit(0); }

	// -- check conflicts (different plugin, same short name) --
	const discovered = await discoverPlugins();
	for (const p of queue) {
		const sn = shortName(p.name);
		const conflict = discovered.find(d =>
			d.manifest.name === sn &&
			d.manifest.key  !== p.name &&
			!d.manifest.local
		);
		if (conflict) {
			console.error(`conflict: "${sn}" already installed as ${conflict.manifest.key || conflict.manifest.name}`);
			console.error(`  use 'manyplug remove ${conflict.manifest.key || conflict.manifest.name}' first`);
			process.exit(1);
		}
	}

	// -- print plan + wipe existing --
	for (const p of queue) {
		const existing = discovered.find(d =>
			d.manifest.key === p.name || d.manifest.name === shortName(p.name)
		);
		console.log(`${existing ? '~' : '+'} ${p.name}@${p.version ?? 'new'}${existing ? ' (reinstall)' : ''}`);
		if (existing) {
			await fs.remove(existing.dir);
			const registry = await loadLocalRegistry();
			const regKey = Object.keys(registry.plugins || {}).find(k =>
				k === p.name || k.split('/').pop() === shortName(p.name)
			);
			if (regKey) { delete registry.plugins[regKey]; await saveRegistry(registry); }
		}
	}


	// -- run queue --
	const results = [];
	for (const p of queue) {
		process.stdout.write(`installing ${p.name}... `);
		const r = await installFromRegistry(p.name, p.manifest, options.branch);
		results.push(r);
		console.log(r.success ? 'done' : `FAILED${r.error ? ': ' + r.error : ''}`);
	}

	// -- summary --
	const ok  = results.filter(r => r.success).length;
	const bad = results.length - ok;
	console.log(`\n${ok}/${results.length} installed in ${elapsed(t)}s`);
	if (bad) process.exit(1);
}

// ------------------------------------------------------------
// update command — reinstall all non-local plugins
// ------------------------------------------------------------

export async function updateCommand(options = {}) {
  const t       = Date.now();
  const plugins = await discoverPlugins();

  const withKey    = plugins.filter(p => !p.manifest.local && p.manifest.key);
  const withoutKey = plugins.filter(p => !p.manifest.local && !p.manifest.key);

  if (withoutKey.length)
    console.warn(`warn: skipping ${withoutKey.map(p => p.name).join(', ')} — no key in manyplug.json (run manyplug validate)`);

  const names = withKey.map(p => p.manifest.key);

  if (!names.length) { console.log('nothing to update'); return; }

  if (!options.yes) {
    const answer = await new Promise(res => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });

      process.stdout.write(`update ${names.length} plugin(s)? [y/N] `);

      rl.once('line', line => {
        rl.close();
        res(line.trim().toLowerCase());
      });
    });
    if (answer !== 'y') { console.log('cancelled'); process.exit(0); }
  }

  await installCommand(names, {});
}

// ------------------------------------------------------------

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }
