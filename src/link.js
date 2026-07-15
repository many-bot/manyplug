import fs from 'fs-extra';
import path from 'path';
import { PLUGINS_DIR, DATA_DIR } from './paths.js';
import { registerPlugin, autoEnable, installNpmIfDeclared } from './install.js';
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
