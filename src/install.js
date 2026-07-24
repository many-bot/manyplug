import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { formatSize } from './ui.js';
import { confirm } from './ui.js';
import { log } from './logger.js';
import { t } from './i18n.js';
import { loadLocalRegistry, saveRegistry, fetchRemoteRegistry } from './registry-ops.js';
import { getDirSize, installPluginFromTarball, installPackFromTarball, installNpmDeps } from './utils.js';
import { PLUGINS_DIR, DATA_DIR } from './paths.js';
import { discoverPlugins, readEnabled, writeEnabled, resolvePlugin } from './plugins.js';
import { getPreference } from './config.js';

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
	if (missing.length)  log.warn(t('install.missingDeps', { deps: missing.join(', ') }));
	if (optional.length) log.info(t('install.optionalDeps', { deps: optional.join(', ') }));
	return { missing, optional };
}

export async function installNpmIfDeclared(targetDir) {
	const pkgPath = path.join(targetDir, 'package.json');
	if (!await fs.pathExists(pkgPath)) return;

	let pkg;
	try { pkg = await fs.readJson(pkgPath); } catch { return; }
	if (!pkg.dependencies || !Object.keys(pkg.dependencies).length) return;

	log.step(t('install.installingDeps'));
	await installNpmDeps(targetDir);
}

// manyplug.json's `dependencies` lists other manybot plugins the plugin
// needs (via ctx.plugins.require) — this only reports what's missing,
// it doesn't auto-install them.
async function reportPluginDeps(manifest) {
	const deps = manifest.dependencies;
	if (!deps || !Object.keys(deps).length) return;

	const installed = new Set(
		(await discoverPlugins()).map(p => (p.manifest.key || p.manifest.name || '').toLowerCase())
	);
	const missing = Object.keys(deps).filter(key => !installed.has(key.toLowerCase()));
	if (missing.length) log.warn(t('install.missingPluginDeps', { deps: missing.join(', ') }));
}

export async function registerPlugin(pluginName, manifest, extra = {}) {
	const registry = await loadLocalRegistry();
	registry.plugins[pluginName] = { ...manifest, ...extra };
	await saveRegistry(registry);
}

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }

// newly installed plugins are enabled right away — no separate `mp en` step
export async function autoEnable(key) {
	const enabled = readEnabled();
	if (enabled.has(key.toLowerCase())) return;
	await writeEnabled([...enabled, key]);
	log.step(t('install.enabled'));
}

// ------------------------------------------------------------
// install a single ordinary plugin from a local directory
// ------------------------------------------------------------

async function installSinglePluginFromLocal(src, manifest, options = {}) {
	const pluginName = manifest.name || path.basename(src);

	let destKey;
	if (manifest.key) {
		destKey = manifest.key;
	} else {
		destKey = `manydev/${pluginName}`;
		log.warn(t('install.noKeyWarn', { key: destKey }));
		log.step(t('install.noKeyHint', { name: pluginName }));
	}

	const dest    = path.join(PLUGINS_DIR, destKey);
	const staging = path.join(PLUGINS_DIR, `.${path.basename(destKey)}.staging-${process.pid}-${Date.now()}`);

	const size = await getDirSize(src);
	log.info(t('install.installingLocal', { key: destKey, src, size: formatSize(size) }));
	reportExternalDeps(manifest);

	try {
		await fs.ensureDir(path.dirname(dest));
		await fs.copy(src, staging);

		if (await fs.pathExists(dest)) {
			if (!options.force) log.changed(t('install.reinstalling', { key: destKey }));
			await fs.remove(dest);
		}
		await fs.move(staging, dest);

		await fs.ensureDir(path.join(DATA_DIR, destKey));
		await installNpmIfDeclared(dest);
		await reportPluginDeps(manifest);
		await registerPlugin(destKey, { ...manifest, key: manifest.key || destKey, local: true });
		await autoEnable(destKey);
		return { success: true, plugin: destKey, name: pluginName, size };
	} catch (e) {
		await fs.remove(staging).catch(() => {});
		return { success: false, error: e.message, plugin: destKey, name: pluginName };
	}
}

// ------------------------------------------------------------
// install a pluginpack from a local directory: every immediate
// subdirectory with its own manyplug.json is installed individually
// ------------------------------------------------------------

async function installPackFromLocal(packDir, packManifest, options = {}) {
	const childDirs = [];
	for (const entry of await fs.readdir(packDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const childManifestPath = path.join(packDir, entry.name, 'manyplug.json');
		if (await fs.pathExists(childManifestPath)) childDirs.push(path.join(packDir, entry.name));
	}

	const packKey = packManifest.key || packManifest.name || path.basename(packDir);

	if (!childDirs.length) {
		return { success: false, error: t('validate.packNoChildren'), plugin: packKey };
	}

	log.info(t('install.packInstalling', { key: packKey, count: childDirs.length }));

	const results = [];
	for (const childDir of childDirs) {
		let childManifest;
		try {
			childManifest = await fs.readJson(path.join(childDir, 'manyplug.json'));
		} catch (e) {
			results.push({ success: false, error: e.message, plugin: path.basename(childDir) });
			continue;
		}
		const r = await installSinglePluginFromLocal(childDir, childManifest, options);
		if (!r.success) log.itemFail(t('install.packChildFailed', { name: r.plugin, message: r.error }));
		results.push(r);
	}

	const ok = results.filter(r => r.success).length;
	return {
		success: ok === results.length,
		plugin:  packKey,
		children: results,
		size: results.reduce((a, r) => a + (r.size || 0), 0),
	};
}

// ------------------------------------------------------------
// install from local path — dispatches by manifest.type
// ------------------------------------------------------------

async function installFromLocal(sourcePath, options = {}) {
	const src = path.resolve(sourcePath);

	if (!await fs.pathExists(src))
		return { success: false, error: t('install.pathNotFound', { path: src }) };

	const manifestPath = path.join(src, 'manyplug.json');
	if (!await fs.pathExists(manifestPath))
		return { success: false, error: t('install.manifestNotFoundLocal') };

	let manifest;
	try { manifest = await fs.readJson(manifestPath); }
	catch (e) { return { success: false, error: t('install.invalidManifestLocal', { message: e.message }) }; }

	if (manifest.type === 'pluginpack') {
		return installPackFromLocal(src, manifest, options);
	}

	if (manifest.type === 'profile') {
		const list = Array.isArray(manifest.plugins) ? manifest.plugins : [];
		const key  = manifest.key || manifest.name;
		if (!list.length) return { success: false, error: t('install.profileEmpty', { key }), plugin: key };
		log.info(t('install.profileInstalling', { key, count: list.length }));
		await installCommand(list, { profile: key });
		return { success: true, plugin: key, profile: true };
	}

	return installSinglePluginFromLocal(src, manifest, options);
}

// ------------------------------------------------------------
// install single plugin from remote registry
// ------------------------------------------------------------

async function installFromRegistry(pluginName, manifest, branch, profile) {
	const t0   = Date.now();
	const name = shortName(pluginName);

	if (!manifest.repos)
		return { success: false, error: t('install.noReposFor', { name: pluginName }), plugin: name };

	try {
		const result = await installPluginFromTarball({ name, repos: manifest.repos, branch }, PLUGINS_DIR);
		const dataKey = result.manifest.key || result.manifest.name;
		reportExternalDeps(result.manifest);
		await installNpmIfDeclared(result.finalPath);
		await reportPluginDeps(result.manifest);
		await fs.ensureDir(path.join(DATA_DIR, dataKey));
		await registerPlugin(dataKey, result.manifest, profile ? { profile } : {});
		await autoEnable(dataKey);
		return { success: true, plugin: name, size: result.size, duration: Date.now() - t0 };
	} catch (e) {
		return { success: false, error: e.message, plugin: name };
	}
}

// ------------------------------------------------------------
// install a pluginpack from the remote registry
// ------------------------------------------------------------

async function installPackFromRegistry(pluginName, manifest, branch, profile) {
	const name = shortName(pluginName);

	if (!manifest.repos)
		return { success: false, error: t('install.noReposFor', { name: pluginName }), plugin: name };

	try {
		const { children, size } = await installPackFromTarball({ name, repos: manifest.repos, branch }, PLUGINS_DIR);

		for (const child of children) {
			const dataKey = child.manifest.key || child.manifest.name;
			reportExternalDeps(child.manifest);
			await installNpmIfDeclared(child.finalPath);
			await reportPluginDeps(child.manifest);
			await fs.ensureDir(path.join(DATA_DIR, dataKey));
			await registerPlugin(dataKey, child.manifest, profile ? { profile } : {});
			await autoEnable(dataKey);
		}

		return { success: true, plugin: name, size, children };
	} catch (e) {
		return { success: false, error: e.message, plugin: name };
	}
}

// ------------------------------------------------------------
// expand profile entries in a name list into their referenced
// plugin keys (recursively, capped to avoid cycles)
// ------------------------------------------------------------

function expandProfiles(names, remoteRegistry, profileMap, depth = 0) {
	if (depth > 5) return names;

	const expanded = [];
	let changed = false;

	for (const name of names) {
		const resolved = resolveRegistryName(name, remoteRegistry);
		if (!resolved || resolved.ambiguous) { expanded.push(name); continue; }

		if (resolved.manifest?.type === 'profile' && Array.isArray(resolved.manifest.plugins)) {
			changed = true;
			for (const child of resolved.manifest.plugins) {
				profileMap.set(child, resolved.key);
				expanded.push(child);
			}
		} else {
			expanded.push(resolved.key);
		}
	}

	return changed ? expandProfiles(expanded, remoteRegistry, profileMap, depth + 1) : expanded;
}

function resolveRegistryName(name, remoteRegistry) {
	if (remoteRegistry.plugins[name]) return { key: name, manifest: remoteRegistry.plugins[name] };

	const lower = name.toLowerCase();
	if (remoteRegistry.plugins[lower]) return { key: lower, manifest: remoteRegistry.plugins[lower] };

	const matches = Object.keys(remoteRegistry.plugins).filter(k => shortName(k).toLowerCase() === lower);

	if (matches.length === 1) {
		log.step(t('install.resolvedName', { name, key: matches[0] }));
		return { key: matches[0], manifest: remoteRegistry.plugins[matches[0]] };
	}
	if (matches.length > 1) return { ambiguous: matches };
	return null;
}

// ------------------------------------------------------------
// install command (entry point)
// ------------------------------------------------------------

export async function installCommand(pluginsInput, options = {}) {
	const t0    = Date.now();
  const names = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []); // ensures that is an array :)

	await fs.ensureDir(PLUGINS_DIR);

	// -- local install --
	if (options.local) {
		const r = await installFromLocal(options.local, options);
		if (!r.success) { log.error(r.error); process.exit(1); }

		if (!r.profile) {
			if (r.children) {
				log.success(`${r.plugin}  size=${formatSize(r.size)}  time=${elapsed(t0)}s`);
			} else {
				log.success(t('install.installedLocal', { key: r.name || r.plugin, size: formatSize(r.size), time: elapsed(t0) }));
			}
		}

		if (options.watch) {
			const src = path.resolve(options.local);
			log.info(t('install.watching', { path: src }));
			let debounce = null;
			fs.watch(src, { recursive: true }, (event, filename) => {
				if (filename?.includes('node_modules')) return;
				clearTimeout(debounce);
				debounce = setTimeout(async () => {
					process.stdout.write(t('install.watchChanged', { file: filename }));
					const rw = await installFromLocal(options.local, { ...options, force: true });
					console.log(rw.success ? chalk.green(t('common.done')) : chalk.red(t('common.failedWith', { message: rw.error })));
				}, 300);
			});
			await new Promise(() => {}); // keep alive
		}

		return;
	}

	if (!names.length) { log.error(t('install.usage')); process.exit(1); }

	// -- fetch remote registry --
	let remoteRegistry;
	try {
		remoteRegistry = await fetchRemoteRegistry();
	} catch (e) {
		log.error(e.message);
		process.exit(1);
	}

	// -- expand profiles into their referenced plugins --
	const profileMap    = new Map();
	const resolvedNames = expandProfiles(names, remoteRegistry, profileMap);

	// -- classify plugins --
	const queue = [], notFound = [];

	for (const name of resolvedNames) {
		const resolved = resolveRegistryName(name, remoteRegistry);
		if (!resolved) { notFound.push(name); continue; }
		if (resolved.ambiguous) {
			log.error(t('common.ambiguous', { name }));
			for (const m of resolved.ambiguous) console.error(`  ${m}`);
			continue;
		}
		const profile = profileMap.get(resolved.key) || options.profile;
		queue.push({ name: resolved.key, version: resolved.manifest.version, manifest: resolved.manifest, profile });
	}

	if (notFound.length) log.error(t('install.notFound', { names: notFound.join(', ') }));
	if (!queue.length) { log.info(t('common.nothingToDo')); process.exit(0); }

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
			log.error(t('install.conflict', { name: sn, existing: conflict.manifest.key || conflict.manifest.name }));
			log.error(t('install.conflictHint', { existing: conflict.manifest.key || conflict.manifest.name }));
			process.exit(1);
		}
	}

	// -- print plan --
	// (no wiping here anymore — the old install stays in place until the
	// new one has been fully downloaded and validated; see
	// installPluginFromTarball/installPackFromTarball in utils.js, which
	// swap it in atomically right before returning)
	for (const p of queue) {
		const existing = discovered.find(d =>
			d.manifest.key === p.name || d.manifest.name === shortName(p.name)
		);
		const marker = existing ? log.changed : log.added;
		const target = p.version ?? 'new';
		const label  = existing ? `${existing.manifest.version || '?'} → ${target}` : target;
		marker(`${p.name}@${label}`);
	}

	// -- run queue --
	const results = [];
	for (const p of queue) {
		process.stdout.write(t('install.installingRemote', { name: p.name }));
		const r = p.manifest.type === 'pluginpack' ? await installPackFromRegistry(p.name, p.manifest, options.branch, p.profile)
			: p.manifest.type === 'profile'         ? { success: false, error: t('install.profileTooDeep', { name: p.name }), plugin: p.name }
			: await installFromRegistry(p.name, p.manifest, options.branch, p.profile);
		results.push(r);
		console.log(r.success ? chalk.green(t('common.done')) : chalk.red(r.error ? t('common.failedWith', { message: r.error }) : t('common.failed')));
	}

	// -- summary --
	const ok  = results.filter(r => r.success).length;
	const bad = results.length - ok;
	log.plain('');
	log.info(t('install.summary', { ok, total: results.length, time: elapsed(t0) }));
	if (bad) process.exit(1);
}

// ------------------------------------------------------------
// update command — reinstall non-local plugins whose remote version
// differs from what's installed; --force reinstalls regardless
// ------------------------------------------------------------

export async function updateCommand(pluginsInput, options = {}) {
  const t0    = Date.now();
  const names = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []);

  const all = await discoverPlugins();

  // -- pick candidates: explicit names, or every installed plugin --
  let candidates;
  if (names.length) {
    candidates = [];
    for (const name of names) {
      const found = await resolvePlugin(name);
      if (!found) { log.itemFail(t('common.notInstalled', { name })); continue; }
      candidates.push(found);
    }
  } else {
    candidates = all;
  }

  const local     = candidates.filter(p => p.manifest.local);
  const withKey   = candidates.filter(p => !p.manifest.local && p.manifest.key);
  const noKey     = candidates.filter(p => !p.manifest.local && !p.manifest.key);

  if (local.length)
    log.warn(t('update.skippingLocal', { names: local.map(p => p.manifest.key || p.manifest.name || p.id).join(', ') }));
  if (noKey.length)
    log.warn(t('update.skippingNoKey', { names: noKey.map(p => p.manifest.name || p.id).join(', ') }));

  if (!withKey.length) { log.info(t('update.nothingToUpdate')); return; }

  // -- fetch remote registry once, compare versions --
  let remoteRegistry;
  try {
    remoteRegistry = await fetchRemoteRegistry();
  } catch (e) {
    log.error(e.message);
    process.exit(1);
  }

  const toUpdate = [];
  for (const p of withKey) {
    const resolved = resolveRegistryName(p.manifest.key, remoteRegistry);
    if (!resolved || resolved.ambiguous) {
      log.skipped(t('update.notInRegistry', { key: p.manifest.key }));
      continue;
    }

    const localVersion  = p.manifest.version;
    const remoteVersion = resolved.manifest.version;
    const outdated       = remoteVersion !== undefined && remoteVersion !== localVersion;

    if (!outdated && !options.force) {
      log.skipped(t('update.upToDate', { key: resolved.key, version: localVersion || '?' }));
      continue;
    }

    log.changed(t('update.willUpdate', { key: resolved.key, from: localVersion || '?', to: remoteVersion ?? '?' }));
    toUpdate.push(resolved.key);
  }

  if (!toUpdate.length) { log.info(t('update.nothingToUpdate')); return; }

  const skipConfirm = options.yes || !getPreference('CONFIRM', true);
  if (!skipConfirm) {
    const ok = await confirm(t('update.confirmPrompt', { count: toUpdate.length }), false);
    if (!ok) { log.info(t('common.cancelled')); process.exit(0); }
  }

  await installCommand(toUpdate, {});
}
