import chalk from 'chalk';
import { fetchRemoteRegistry } from './registry-ops.js';
import { discoverPlugins } from './plugins.js';
import { log } from './logger.js';
import { t } from './i18n.js';

// ------------------------------------------------------------
// search command — apt-search style lookup against the registry
// ------------------------------------------------------------

export async function searchCommand(query, options = {}) {
	if (!query) { log.error(t('search.usage')); process.exit(1); }

	let remoteRegistry;
	try {
		remoteRegistry = await fetchRemoteRegistry();
	} catch (e) {
		log.error(e.message);
		process.exit(1);
	}

	const installed = new Set(
		(await discoverPlugins()).map(p => (p.manifest.key || p.id).toLowerCase())
	);

	const q = query.toLowerCase();

	const matches = Object.entries(remoteRegistry.plugins).filter(([key, m]) => {
		if (options.category && (m.category || '').toLowerCase() !== options.category.toLowerCase())
			return false;
		return (
			key.toLowerCase().includes(q) ||
			(m.name || '').toLowerCase().includes(q) ||
			(m.description || '').toLowerCase().includes(q) ||
			(m.category || '').toLowerCase().includes(q)
		);
	});

	if (!matches.length) {
		log.info(t('search.noResults', { query }));
		return;
	}

	// name/key matches first, then description-only matches
	matches.sort(([ka, ma], [kb, mb]) => {
		const rank = ([k, m]) => (k.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)) ? 0 : 1;
		return rank([ka, ma]) - rank([kb, mb]);
	});

	for (const [key, m] of matches) {
		const tags = [];
		if (installed.has(key.toLowerCase())) tags.push(chalk.green(t('search.installed')));
		if (m.type === 'pluginpack') tags.push(chalk.cyan(t('info.typePluginpack')));
		if (m.type === 'profile')    tags.push(chalk.cyan(t('info.typeProfile')));

		const suffix  = tags.length ? `  [${tags.join(', ')}]` : '';
		const version = m.version ? chalk.dim('@' + m.version) : '';
		log.plain(`${chalk.bold(key)}${version}${suffix}`);
		if (m.description) log.plain(chalk.dim(`  ${m.description}`));
		if (m.category)    log.plain(chalk.dim(`  ${t('list.colCategory')}: ${m.category}`));
	}

	log.plain('');
	log.plain(chalk.dim(t('search.summary', { count: matches.length, query })));
}
