import { readEnabled, writeEnabled, resolvePlugin, resolveProfile, discoverPlugins } from './plugins.js';
import { log } from './logger.js';
import { t } from './i18n.js';

function elapsed(since) { return ((Date.now() - since) / 1000).toFixed(2); }

// ------------------------------------------------------------
// enable / disable commands
// ------------------------------------------------------------

async function toggle(names, action, options = {}) {
	const t0      = Date.now();
	const enabled = readEnabled();
	const set     = new Set(enabled);

	// -p/--profile: toggle every plugin tagged with this profile — explicit
	// flag on purpose, since a profile's own name can collide with a
	// plugin's name and we don't want that resolved implicitly
	if (options.profile) {
		if (names.length) log.warn(t('toggle.profileIgnoresNames'));

		const resolved = await resolveProfile(options.profile);
		if (!resolved) { log.error(t('toggle.profileNotFound', { name: options.profile })); process.exit(1); }
		if (resolved.ambiguous) {
			log.error(t('common.ambiguous', { name: options.profile }));
			for (const m of resolved.ambiguous) console.error(`  ${m}`);
			process.exit(1);
		}

		for (const p of resolved.members) {
			const key = p.manifest.key || p.manifest.name;
			if (action === 'enable') set.add(key);
			else                     set.delete(key);
		}
		await writeEnabled([...set]);
		const marker = action === 'enable' ? log.added : log.removed;
		for (const p of resolved.members) marker(p.id);
		log.info(t('toggle.profileDone', {
			profile: resolved.key,
			count:   resolved.members.length,
			action:  t(`toggle.${action === 'enable' ? 'enabled' : 'disabled'}`),
			time:    elapsed(t0),
		}));
		return;
	}

	// --all: operate on every installed plugin
	if (options.all) {
		const all = await discoverPlugins();
		if (!all.length) { log.info(t('toggle.noPluginsInstalled')); return; }
		for (const p of all) {
			const key = (p.manifest.key || p.manifest.name);
			if (action === 'enable') set.add(key);
			else                     set.delete(key);
		}
		await writeEnabled([...set]);
		const marker = action === 'enable' ? log.added : log.removed;
		for (const p of all) marker(p.id);
		log.info(t('toggle.allDone', { count: all.length, action: t(`toggle.${action === 'enable' ? 'enabled' : 'disabled'}`), time: elapsed(t0) }));
		return;
	}

	if (!names.length) {
		log.error(t('toggle.usage', { action }));
		process.exit(1);
	}

	const results = [];

	for (const name of names) {
		const found = await resolvePlugin(name);

		if (action === 'enable' && !found) {
			log.itemFail(t('common.notInstalled', { name }));
			results.push({ name, changed: false, notFound: true });
			continue;
		}

		const key = found
			? (found.manifest.key || found.manifest.name)
			: name;

		const was = set.has(key);
		if (action === 'enable') set.add(key);
		else                     set.delete(key);
		const changed = set.has(key) !== was;
		results.push({ name, changed });
	}

	const changed = results.filter(r => r.changed);

	if (changed.length) {
		try {
			await writeEnabled([...set]);
		} catch (e) {
			log.error(t('common.failedWith', { message: e.message }));
			process.exit(1);
		}
	}

	for (const r of results) {
		if (r.notFound) continue;
		const marker = action === 'enable' ? log.added : log.removed;
		const note   = r.changed ? '' : t(`toggle.already${action === 'enable' ? 'Enabled' : 'Disabled'}`);
		marker(`${r.name}${note}`);
	}

	if (names.length > 1) {
		const notFound = results.filter(r => r.notFound).length;
		log.info(
			t('toggle.summary', { changed: changed.length, total: names.length, time: elapsed(t0) }) +
			(notFound ? t('toggle.notFoundSuffix', { count: notFound }) : '')
		);
	}

	if (results.some(r => r.notFound)) process.exit(1);
}

export function enableCommand(input, options = {}) {
	const names = Array.isArray(input) ? input : (input ? [input] : []);
	return toggle(names, 'enable', options);
}

export function disableCommand(input, options = {}) {
	const names = Array.isArray(input) ? input : (input ? [input] : []);
	return toggle(names, 'disable', options);
}
