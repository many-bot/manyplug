import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry, fetchRemoteRegistry } from './registry-ops.js';
import { getDirSize, installPluginFromRepo, installPluginFromTarball, installNpmDeps } from './utils.js';
import { PLUGINS_DIR } from './paths.js';
import { discoverPlugins } from './plugins.js';

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function isNewFormat(entry) {
	return !!entry.repos;
}

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

async function installFromLocal(sourcePath) {
	const src = path.resolve(sourcePath);

	if (!await fs.pathExists(src))
		return { success: false, error: `path not found: ${src}` };

	const manifestPath = path.join(src, 'manyplug.json');
	if (!await fs.pathExists(manifestPath))
		return { success: false, error: 'manyplug.json not found' };

	let manifest;
	try { manifest = await fs.readJson(manifestPath); }
	catch (e) { return { success: false, error: `invalid manyplug.json: ${e.message}` }; }

	const name = manifest.name || path.basename(src);
	const dest = path.join(PLUGINS_DIR, name);

  // checa conflito
  const discovered = await discoverPlugins();
  const conflict = discovered.find(d => d.manifest.name === name && d.manifest.key !== manifest.key);
  if (conflict) {
    return { 
      success: false, 
      error: `conflict: "${name}" already installed as ${conflict.manifest.key || conflict.manifest.name}\n  use 'manyplug remove ${conflict.manifest.key || conflict.manifest.name}' first`
    };
  }


	if (await fs.pathExists(dest))
		return { success: false, error: `${name} already installed` };

	const size = await getDirSize(src);
	console.log(`installing ${name}  src=${src}  size=${formatSize(size)}`);
	reportExternalDeps(manifest);

	try {
		await fs.ensureDir(PLUGINS_DIR);
		await fs.copy(src, dest);
		await installDeps(manifest, dest);
		await registerPlugin(name, manifest, { local: true });
		return { success: true, plugin: name, size };
	} catch (e) {
		return { success: false, error: e.message, plugin: name };
	}
}

// ------------------------------------------------------------
// install single plugin from remote registry
// ------------------------------------------------------------

async function installFromRegistry(pluginName, manifest, mirror, branch) {
	const t    = Date.now();
	const name = shortName(pluginName);
	const dest = path.join(PLUGINS_DIR, name);

	try {
		let size;

		if (isNewFormat(manifest)) {
			const result = await installPluginFromTarball({ name, repos: manifest.repos, branch: branch }, PLUGINS_DIR);
			size = result.size;
			reportExternalDeps(result.manifest);
			await installDeps(result.manifest, result.finalPath);
			await registerPlugin(result.manifest.key || result.manifest.name, result.manifest);
		} else {
			console.warn('warning: installing from manyplug-repo is deprecated. use \'install user/plugin\' instead.');
			const r = await installPluginFromRepo({ plugin: pluginName, repo: mirror }, PLUGINS_DIR);
			size = r.size;
			await installDeps(manifest, dest);
			await registerPlugin(name, manifest);
		}

		return { success: true, plugin: name, size, duration: Date.now() - t };
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
		const r = await installFromLocal(options.local);
		if (!r.success) { console.error(r.error); process.exit(1); }
		console.log(`installed ${r.plugin}  size=${formatSize(r.size)}  time=${elapsed(t)}s`);
		return;
	}

	if (!names.length) { console.error('usage: manyplug install <plugin>'); process.exit(1); }

	// -- fetch remote registry --
	let remoteRegistry, mirror;
	try {
		({ remoteRegistry, selectedMirror: mirror } = await fetchRemoteRegistry());
		mirror = mirror.git;
	} catch (e) {
		console.error(`failed: ${e.message}`);
		process.exit(1);
	}

	// -- classify plugins --
	const toInstall = [], toReinstall = [], notFound = [];

	for (const name of names) {
		const manifest = remoteRegistry.plugins[name];
		if (!manifest) { notFound.push(name); continue; }

		const sn        = shortName(name);
		const installed = await fs.pathExists(path.join(PLUGINS_DIR, sn));
		const entry     = { name, version: manifest.version, manifest };

		if (installed && !options.needed) toReinstall.push(entry);
		else if (!installed)              toInstall.push(entry);
	}

	if (notFound.length) console.error(`not found: ${notFound.join(', ')}`);

	const queue = [...toInstall, ...toReinstall];
	if (!queue.length) { console.log('nothing to do'); process.exit(0); }

  // --- check conflicts ---
  const discovered = await discoverPlugins();
  for (const p of toInstall) {
    const sn = shortName(p.name);
    const conflict = discovered.find(d => d.manifest.name === sn && d.manifest.key !== p.name);
    if (conflict) {
      console.error(`conflict: "${sn}" already installed as ${conflict.manifest.key || conflict.manifest.name}`);
      console.error(`  use 'manyplug remove ${conflict.manifest.key || conflict.manifest.name}' first`);
      process.exit(1);
    }
  }

	// -- print plan --
	for (const p of toInstall)   console.log(`+ ${p.name}@${p.version ?? 'new'}`);
	for (const p of toReinstall) console.log(`~ ${p.name}@${p.version ?? 'new'} (reinstall)`);

	// -- remove stale installs --
	for (const p of toReinstall) {
		const sn = shortName(p.name);
		await fs.remove(path.join(PLUGINS_DIR, sn));
		const registry = await loadLocalRegistry();
		delete registry.plugins[sn];
		await saveRegistry(registry);
	}


	// -- run queue --
	const results = [];
	for (const p of queue) {
		process.stdout.write(`installing ${p.name}... `);
		const r = await installFromRegistry(p.name, p.manifest, mirror, options.branch);
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
    process.stdout.write(`update ${names.length} plugin(s)? [y/N] `);
    const answer = await new Promise(res =>
      process.stdin.once('data', d => res(d.toString().trim().toLowerCase()))
    );
    process.stdin.destroy();
    if (answer !== 'y') { console.log('cancelled'); process.exit(0); }
  }

  await installCommand(names, {});
}

// ------------------------------------------------------------

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }
