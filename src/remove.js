import fs from 'fs-extra';
import path from 'path';
import { formatSize } from './ui.js';
import { confirm } from './ui.js';
import { log } from './logger.js';
import { t } from './i18n.js';
import { loadLocalRegistry, saveRegistry } from './registry-ops.js';
import { readEnabled, writeEnabled, resolvePlugin } from './plugins.js';
import { getDirSize } from './utils.js';
import { getPreference } from './config.js';
import { DATA_DIR } from './paths.js';

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }

// ------------------------------------------------------------
// remove command
// ------------------------------------------------------------

export async function removeCommand(input, options = {}) {
	const t0    = Date.now();
	const names = Array.isArray(input) ? input : (input ? [input] : []);

	if (!names.length) {
		log.error(t('remove.usage'));
		process.exit(1);
	}

	const skipConfirm = options.yes || options.Y || !getPreference('CONFIRM', true);

	const results = [];
	for (const name of names) {
		const found = await resolvePlugin(name);
		if (!found) {
			log.itemFail(t('common.notInstalled', { name }));
			results.push({ name, success: false });
			continue;
		}

		const { dir, manifest } = found;
		if (!dir || typeof dir !== 'string') {
			log.itemFail(t('remove.invalidDir', { name }));
			results.push({ name, success: false });
			continue;
		}

		let size = await getDirSize(dir);
		log.removed(`${found.manifest.name}@${manifest.version || '?'}  size=${formatSize(size)}  path=${path.relative(process.cwd(), dir)}`);

		if (!skipConfirm) {
			const ok = await confirm(t('remove.confirmPrompt'), false);
			if (!ok) {
				log.step(t('common.skipped'));
				results.push({ name, success: false, skipped: true });
				continue;
			}
		}

		try {
			const enabled   = readEnabled();
			const set       = new Set(enabled);
			const keySimple = found.manifest.name?.toLowerCase();
			const keyFull   = found.manifest.key?.toLowerCase();
			if (set.has(keySimple)) set.delete(keySimple);
			if (keyFull && set.has(keyFull)) set.delete(keyFull);
			if (set.size !== enabled.size) {
				await writeEnabled([...set]);
				log.step(t('remove.disabled', { key: found.manifest.key || found.manifest.name }));
			}

			await fs.remove(dir);

			const registry = await loadLocalRegistry();
			const regKey = Object.keys(registry.plugins || {}).find(k =>
				k === found.manifest.name || k.split('/').pop() === found.manifest.name
			);
			if (regKey) {
				delete registry.plugins[regKey];
				await saveRegistry(registry);
			}

			// offer to remove data dir
			const dataKey  = found.manifest.key || found.manifest.name;
			const dataPath = path.join(DATA_DIR, dataKey);
			if (await fs.pathExists(dataPath)) {
				const dataSize = await getDirSize(dataPath);
				if (options.Y) {
					await fs.remove(dataPath);
					size += dataSize;
					log.step(t('remove.removedDataFreed', { size: formatSize(dataSize) }));
				} else {
					const rmData = await confirm(t('remove.confirmData', { size: formatSize(dataSize) }), false);
					if (rmData) {
						await fs.remove(dataPath);
						size += dataSize;
						log.step(t('remove.removedData'));
					} else {
						log.step(t('remove.keptData'));
					}
				}
			}

			log.step(t('remove.done', { size: formatSize(size) }));
			results.push({ name, success: true, size });
		} catch (e) {
			log.itemFail(t('common.failedWith', { message: e.message }));
			results.push({ name, success: false, error: e.message });
		}
	}

	const ok    = results.filter(r => r.success).length;
	const freed = results.reduce((a, r) => a + (r.size || 0), 0);
	if (names.length > 1) {
		log.plain('');
		log.info(t('remove.summary', { ok, total: names.length, size: formatSize(freed), time: elapsed(t0) }));
	}
	if (results.some(r => !r.success && !r.skipped)) process.exit(1);
}
