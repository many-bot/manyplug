import fs from 'fs-extra';
import path from 'path';
import { PLUGINS_DIR, DATA_DIR } from './paths.js';
import { registerPlugin, autoEnable, installNpmIfDeclared } from './install.js';
import { resolvePlugin, readEnabled, writeEnabled } from './plugins.js';
import { loadLocalRegistry, saveRegistry } from './registry-ops.js';
import { confirm } from './ui.js';
import { getPreference } from './config.js';
import { log } from './logger.js';
import { t } from './i18n.js';

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }

const SYMLINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

// ------------------------------------------------------------
// link a single plugin dir into PLUGINS_DIR via symlink
// ------------------------------------------------------------

async function linkSingle(src, manifest) {
	const pluginName = manifest.name || path.basename(src);
	const absSrc     = path.resolve(src);

	let destKey;
	if (manifest.key) {
		destKey = manifest.key;
	} else {
		destKey = `manydev/${pluginName}`;
		log.warn(t('install.noKeyWarn', { key: destKey }));
		log.step(t('install.noKeyHint', { name: pluginName }));
	}

	const dest = path.join(PLUGINS_DIR, destKey);

	let destExists = false;
	try { await fs.lstat(dest); destExists = true; } catch { /* nothing there */ }

	let alreadyLinked = false;
	if (destExists) {
		const stat = await fs.lstat(dest);
		let samePath = false;
		if (stat.isSymbolicLink()) {
			try { samePath = (await fs.realpath(dest)) === (await fs.realpath(absSrc)); }
			catch { samePath = false; } // broken symlink — needs relinking
		}

		if (samePath) {
			alreadyLinked = true;
			log.step(t('link.alreadyLinked', { key: destKey }));
		} else {
			log.changed(t('link.relinking', { key: destKey }));
			await fs.remove(dest);
		}
	}

	if (!alreadyLinked) {
		await fs.ensureDir(path.dirname(dest));
		await fs.ensureSymlink(absSrc, dest, SYMLINK_TYPE);
	}

	await fs.ensureDir(path.join(DATA_DIR, destKey));
	await installNpmIfDeclared(dest);
	await registerPlugin(destKey, { ...manifest, key: manifest.key || destKey, local: true, linked: true });
	await autoEnable(destKey);

	return { key: destKey, name: pluginName, src: absSrc };
}

// ------------------------------------------------------------
// link every child of a pluginpack
// ------------------------------------------------------------

async function linkPack(packDir) {
	const childDirs = [];
	for (const entry of await fs.readdir(packDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const childManifestPath = path.join(packDir, entry.name, 'manyplug.json');
		if (await fs.pathExists(childManifestPath)) childDirs.push(path.join(packDir, entry.name));
	}

	if (!childDirs.length) { log.error(t('validate.packNoChildren')); process.exit(1); }

	const results = [];
	for (const childDir of childDirs) {
		let childManifest;
		try {
			childManifest = await fs.readJson(path.join(childDir, 'manyplug.json'));
		} catch (e) {
			log.itemFail(`${path.basename(childDir)}: ${e.message}`);
			continue;
		}
		results.push(await linkSingle(childDir, childManifest));
	}
	return results;
}

// ------------------------------------------------------------
// link command (entry point)
// ------------------------------------------------------------

export async function linkCommand(pluginPath = '.') {
	const t0  = Date.now();
	const src = path.resolve(pluginPath);

	if (!await fs.pathExists(src)) {
		log.error(t('install.pathNotFound', { path: src }));
		process.exit(1);
	}

	const manifestPath = path.join(src, 'manyplug.json');
	if (!await fs.pathExists(manifestPath)) {
		log.error(t('install.manifestNotFoundLocal'));
		process.exit(1);
	}

	let manifest;
	try { manifest = await fs.readJson(manifestPath); }
	catch (e) { log.error(t('install.invalidManifestLocal', { message: e.message })); process.exit(1); }

	if (manifest.type === 'profile') {
		log.error(t('link.noProfiles'));
		process.exit(1);
	}

	await fs.ensureDir(PLUGINS_DIR);

	if (manifest.type === 'pluginpack') {
		const results = await linkPack(src);
		for (const r of results) log.success(t('link.linked', { key: r.key, src: r.src }));
		log.info(t('link.summary', { count: results.length, time: elapsed(t0) }));
		return;
	}

	const r = await linkSingle(src, manifest);
	log.success(t('link.linked', { key: r.key, src }));
	log.info(t('link.hint'));
}

// ------------------------------------------------------------
// unlink command — undoes a single `link`: removes the symlink and its
// registry/enabled-list entries, leaves the source directory untouched
// ------------------------------------------------------------

export async function unlinkCommand(input, options = {}) {
	const t0    = Date.now();
	const names = Array.isArray(input) ? input : (input ? [input] : []);

	if (!names.length) {
		log.error(t('unlink.usage'));
		process.exit(1);
	}

	const skipConfirm = options.yes || !getPreference('CONFIRM', true);
	const results = [];

	for (const name of names) {
		const found = await resolvePlugin(name);
		if (!found) {
			log.itemFail(t('common.notInstalled', { name }));
			results.push({ name, success: false });
			continue;
		}

		const { dir, manifest } = found;
		const key = manifest.key || manifest.name;

		let isLink = false;
		try { isLink = (await fs.lstat(dir)).isSymbolicLink(); } catch { /* missing — treat as not linked */ }

		if (!isLink) {
			log.itemFail(t('unlink.notLinked', { name: key }));
			results.push({ name, success: false });
			continue;
		}

		if (!skipConfirm) {
			const ok = await confirm(t('unlink.confirmPrompt', { key }), false);
			if (!ok) {
				log.step(t('common.skipped'));
				results.push({ name, success: false, skipped: true });
				continue;
			}
		}

		try {
			const enabled   = readEnabled();
			const set       = new Set(enabled);
			const keySimple = manifest.name?.toLowerCase();
			const keyFull   = manifest.key?.toLowerCase();
			if (set.has(keySimple)) set.delete(keySimple);
			if (keyFull && set.has(keyFull)) set.delete(keyFull);
			if (set.size !== enabled.size) await writeEnabled([...set]);

			await fs.remove(dir); // unlinks the symlink itself — source dir is untouched

			const registry = await loadLocalRegistry();
			const regKey = Object.keys(registry.plugins || {}).find(k =>
				k === manifest.key || k === manifest.name || k.split('/').pop() === manifest.name
			);
			if (regKey) {
				delete registry.plugins[regKey];
				await saveRegistry(registry);
			}

			log.removed(t('unlink.unlinked', { key }));
			results.push({ name, success: true });
		} catch (e) {
			log.itemFail(t('common.failedWith', { message: e.message }));
			results.push({ name, success: false, error: e.message });
		}
	}

	const ok = results.filter(r => r.success).length;
	if (names.length > 1) {
		log.plain('');
		log.info(t('unlink.summary', { ok, total: names.length, time: elapsed(t0) }));
	}
	if (results.some(r => !r.success && !r.skipped)) process.exit(1);
}
