import fs from 'fs-extra';
import path from 'path';
import { log } from './logger.js';
import { t } from './i18n.js';

// ------------------------------------------------------------

async function loadManifest(cwd) {
	const mp = path.join(cwd, 'manyplug.json');
	if (!await fs.pathExists(mp))
		throw new Error(t('version.manifestNotFound'));
	return { mp, manifest: await fs.readJson(mp) };
}

// ------------------------------------------------------------
// version command
// ------------------------------------------------------------

export async function versionCommand(input) {
	let mp, manifest;
	try { ({ mp, manifest } = await loadManifest(process.cwd())); }
	catch (e) { log.error(e.message); process.exit(1); }

	const name = manifest.key || manifest.name || 'unnamed';

	if (!input) {
		log.plain(manifest.version ? `${name} - ${manifest.version}` : `${name} - ${t('version.noVersionSet')}`);
		return;
	}

	const prev = manifest.version || t('version.noVersionSet');
	manifest.version = input;
	await fs.writeJson(mp, manifest, { spaces: 2 });
	log.plain(`${name} - ${prev} >> ${input}`);
}
