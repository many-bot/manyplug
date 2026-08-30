import fs from 'fs-extra';
import path from 'path';
import { log } from './logger.js';
import { t } from './i18n.js';
import { run } from './utils.js';
import { getPreference } from './config.js';

// ------------------------------------------------------------

async function loadManifest(cwd) {
	const mp = path.join(cwd, 'manyplug.json');
	if (!await fs.pathExists(mp))
		throw new Error(t('version.manifestNotFound'));
	return { mp, manifest: await fs.readJson(mp) };
}

async function isGitRepo(cwd) {
	try { await run('git rev-parse --is-inside-work-tree', cwd); return true; }
	catch { return false; }
}

// true when the working tree has any uncommitted changes (staged,
// unstaged, or untracked) — not just changes to manyplug.json
async function isDirty(cwd) {
	const out = await run('git status --porcelain', cwd);
	return out.trim().length > 0;
}

async function tagExists(cwd, tag) {
	const out = await run(`git tag -l ${tag}`, cwd);
	return out.trim().length > 0;
}

// ------------------------------------------------------------
// version command
// ------------------------------------------------------------

export async function versionCommand(input, options = {}) {
	let mp, manifest;
	try { ({ mp, manifest } = await loadManifest(process.cwd())); }
	catch (e) { log.error(e.message); process.exit(1); }

	const name = manifest.key || manifest.name || 'unnamed';

	if (!input) {
		log.plain(manifest.version ? `${name} - ${manifest.version}` : `${name} - ${t('version.noVersionSet')}`);
		return;
	}

	const cwd = process.cwd();
	const tag = `v${input}`;
	// AUTO_TAG=false turns "version" into a plain manifest edit — no
	// dirty-tree/tag-exists checks, no commit, no tag
	const autoTag = getPreference('AUTO_TAG', true);
	const git = autoTag && await isGitRepo(cwd);

	// validate before touching anything on disk, so a rejected bump
	// never leaves manyplug.json edited without a matching commit/tag
	if (git) {
		if (await tagExists(cwd, tag)) {
			log.error(t('version.tagExists', { tag }));
			process.exit(1);
		}
		if (!options.force && await isDirty(cwd)) {
			log.error(t('version.dirtyTree'));
			process.exit(1);
		}
	}

	const prev = manifest.version || t('version.noVersionSet');
	manifest.version = input;
	await fs.writeJson(mp, manifest, { spaces: 2 });
	log.plain(`${name} - ${prev} >> ${input}`);

	if (!git) return;

	try {
		await run('git add manyplug.json', cwd);
		await run(`git commit -m "${tag}"`, cwd);
		await run(`git tag ${tag}`, cwd);
		log.success(t('version.tagged', { tag }));
	} catch (e) {
		log.error(t('version.gitFailed', { message: e.message }));
		process.exit(1);
	}
}

