import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry, fetchRemoteRegistry } from './registry-ops.js';
import { getDirSize, installPluginFromRepo, installNpmDeps } from './utils.js';

import { PLUGINS_DIR } from "./paths.js";

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function onMirror(mirror, status, err) {
	console.log(`  ${status === 'ok' ? '+' : 'x'} ${mirror.name}${err ? ': ' + err : ''}`);
}

function commandExists(cmd) {
	try {
		const check = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
		execSync(check, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

// Returns { missing: [], optional: [] } based on manifest.externalDependencies
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
	if (missing.length)   console.warn(`warn: missing external deps: ${missing.join(', ')}`);
	if (optional.length)  console.log(`info: optional deps not found: ${optional.join(', ')}`);
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

async function installFromRegistry(pluginName, manifest, mirror) {
	const t = Date.now();
	const dest = path.join(PLUGINS_DIR, pluginName);

	try {
		const { size } = await installPluginFromRepo({ plugin: pluginName, repo: mirror }, PLUGINS_DIR);
		await installDeps(manifest, dest);
		await registerPlugin(pluginName, manifest);
		return { success: true, plugin: pluginName, size, duration: Date.now() - t };
	} catch (e) {
		return { success: false, error: e.message, plugin: pluginName };
	}
}

// ------------------------------------------------------------
// install command (entry point)
// ------------------------------------------------------------

export async function installCommand(pluginsInput, options = {}) {
	const t = Date.now();
	const names = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []);

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
	process.stdout.write('fetching registry... ');
	let remoteRegistry, mirror;
	try {
		({ remoteRegistry, selectedMirror: mirror } = await fetchRemoteRegistry(onMirror));
		mirror = mirror.git;
		console.log('ok');
	} catch (e) {
		console.error(`failed: ${e.message}`);
		process.exit(1);
	}

	// -- classify plugins --
	const toInstall = [], toReinstall = [], notFound = [];

	for (const name of names) {
		const manifest = remoteRegistry.plugins[name];
		if (!manifest) { notFound.push(name); continue; }

		const installed = await fs.pathExists(path.join(PLUGINS_DIR, name));
		const entry = { name, version: manifest.version, manifest };

		if (installed && !options.needed) toReinstall.push(entry);
		else if (!installed)             toInstall.push(entry);
		// installed + --needed => skip (nothing pushed)
	}

	if (notFound.length) console.error(`not found: ${notFound.join(', ')}`);

	const queue = [...toInstall, ...toReinstall];
	if (!queue.length) { console.log('nothing to do'); process.exit(0); }

	// -- print plan --
	for (const p of toInstall)    console.log(`+ ${p.name}@${p.version}`);
	for (const p of toReinstall)  console.log(`~ ${p.name}@${p.version} (reinstall)`);

	// -- remove stale installs --
	for (const p of toReinstall) {
		await fs.remove(path.join(PLUGINS_DIR, p.name));
		const registry = await loadLocalRegistry();
		delete registry.plugins[p.name];
		await saveRegistry(registry);
	}

	// -- run queue --
	const results = [];
	for (const p of queue) {
		process.stdout.write(`installing ${p.name}... `);
		const r = await installFromRegistry(p.name, p.manifest, mirror);
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

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }
