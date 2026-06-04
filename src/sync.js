import fs from 'fs-extra';
import path from 'path';
import { formatSize } from './ui.js';
import { loadLocalRegistry, saveRegistry, fetchRemoteRegistry } from './registry-ops.js';
import { installPluginFromRepo, installNpmDeps } from './utils.js';
import { PLUGINS_DIR } from './paths.js';

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }

function onMirror(mirror, status, err) {
	console.log(`  ${status === 'ok' ? '+' : 'x'} ${mirror.name}${err ? ': ' + err : ''}`);
}

async function fetchRegistry() {
	process.stdout.write('fetching registry... ');
	try {
		const r = await fetchRemoteRegistry(onMirror);
		console.log('ok');
		return r;
	} catch (e) {
		console.error(`failed: ${e.message}`);
		process.exit(1);
	}
}

async function installDeps(manifest, targetDir) {
	const deps = manifest.dependencies;
	if (!deps || !Object.keys(deps).length) return;
	await installNpmDeps(deps, targetDir);
}

// ------------------------------------------------------------
// sync command — reconcile local registry with remote
// ------------------------------------------------------------

export async function syncCommand(options = {}) {
	const t = Date.now();
	const { remoteRegistry, selectedMirror } = await fetchRegistry();
	const local = await loadLocalRegistry();

	const synced   = {};
	const added    = [], updated = [], kept = [], localOnly = [], skipped = [];

	// reconcile local plugins against remote
	for (const [name, lm] of Object.entries(local.plugins || {})) {
		if (lm.local) {
			localOnly.push(name);
			synced[name] = lm;
			continue;
		}
		const rm = remoteRegistry.plugins?.[name];
		if (rm && lm.version !== rm.version) {
			updated.push(`${name} ${lm.version}->${rm.version}`);
			synced[name] = rm;
		} else {
			kept.push(name);
			synced[name] = lm;
		}
	}

	// plugins in remote not installed locally
	for (const [name, rm] of Object.entries(remoteRegistry.plugins || {})) {
		if (!local.plugins?.[name]) skipped.push(name);
	}

	// plugins on disk not in registry
	if (await fs.pathExists(PLUGINS_DIR)) {
		for (const entry of await fs.readdir(PLUGINS_DIR, { withFileTypes: true })) {
			if (!entry.isDirectory() || synced[entry.name]) continue;
			const mp = path.join(PLUGINS_DIR, entry.name, 'manyplug.json');
			if (!await fs.pathExists(mp)) continue;
			try {
				const manifest = await fs.readJson(mp);
				added.push(entry.name);
				synced[entry.name] = manifest;
			} catch {}
		}
	}

	// summary
	if (added.length)    console.log(`+ added:    ${added.join(', ')}`);
	if (updated.length)  console.log(`~ updated:  ${updated.join(', ')}`);
	if (kept.length)     console.log(`= kept:     ${kept.length} plugin(s)`);
	if (localOnly.length) console.log(`L local:    ${localOnly.join(', ')}`);
	if (skipped.length)  console.log(`- skipped:  ${skipped.length} not installed`);

	console.log(`  source:  ${selectedMirror.name}`);
	console.log(`  synced:  ${Object.keys(synced).length} plugin(s)`);

	const hasChanges = added.length || updated.length;
	if (hasChanges || options.force) {
		process.stdout.write('saving registry... ');
		try {
			await saveRegistry({ plugins: synced });
			console.log('ok');
		} catch (e) {
			console.error(`failed: ${e.message}`);
			process.exit(1);
		}
	}

	console.log(`done in ${elapsed(t)}s`);
}

// ------------------------------------------------------------
// update command — install/update all plugins from remote
// ------------------------------------------------------------

async function applyPlugin(name, manifest, mirror, isUpdate) {
	const dest = path.join(PLUGINS_DIR, name);
	process.stdout.write(`${isUpdate ? 'updating' : 'installing'} ${name}... `);
	try {
		if (isUpdate && await fs.pathExists(dest)) await fs.remove(dest);
		const { size } = await installPluginFromRepo({ plugin: name, repo: mirror }, PLUGINS_DIR);
		await installDeps(manifest, dest);
		const registry = await loadLocalRegistry();
		registry.plugins[name] = manifest;
		await saveRegistry(registry);
		console.log(`done (${formatSize(size)})`);
		return { success: true, name, size };
	} catch (e) {
		console.log(`FAILED: ${e.message}`);
		return { success: false, name, error: e.message };
	}
}

export async function updateCommand(options = {}) {
	const t = Date.now();
	const { remoteRegistry, selectedMirror } = await fetchRegistry();
	const local = await loadLocalRegistry();

	const toInstall = [], toUpdate = [], localOnly = [];

	for (const [name, rm] of Object.entries(remoteRegistry.plugins || {})) {
		const onDisk = await fs.pathExists(path.join(PLUGINS_DIR, name));
		if (!onDisk) continue; // not installed locally, skip
		const lm = local.plugins?.[name];
		if (lm?.version !== rm.version) toUpdate.push({ name, manifest: rm, from: lm?.version ?? '?', to: rm.version });
	}
	for (const name of Object.keys(local.plugins || {})) {
		if (!remoteRegistry.plugins?.[name]) localOnly.push(name);
	}

	// plan
	for (const p of toUpdate)  console.log(`~ ${p.name} ${p.from}->${p.to}`);
	if (localOnly.length)      console.log(`L local only (skipped): ${localOnly.join(', ')}`);

	const total = toUpdate.length;
	if (!total) { console.log(`nothing to do  (${elapsed(t)}s)`); return; }

	// confirm
	if (!options.yes) {
		process.stdout.write(`${total} plugin(s) will be updated, continue? [y/N] `);
		const answer = await new Promise(res => {
			process.stdin.once('data', d => res(d.toString().trim().toLowerCase()));
		});
		if (answer !== 'y') { console.log('cancelled'); process.exit(0); }
	}

	// run
	const results = [];
	const mirror  = selectedMirror.git;
	for (const p of toUpdate)  results.push(await applyPlugin(p.name, p.manifest, mirror, true));

	// summary
	const ok  = results.filter(r => r.success).length;
	const bad = results.length - ok;
	const totalSize = results.reduce((a, r) => a + (r.size || 0), 0);

	console.log(`\n${ok}/${results.length} updated in ${elapsed(t)}s  size=${formatSize(totalSize)}`);
	process.exit(1);
}
