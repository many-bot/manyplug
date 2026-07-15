import chalk from 'chalk';
import { discoverPlugins } from './plugins.js';
import { log } from './logger.js';
import { t } from './i18n.js';

// ------------------------------------------------------------
// list command
// ------------------------------------------------------------

function statusText(p) {
	return !p.hasEntry ? t('list.statusIncomplete') : p.isEnabled ? t('list.statusEnabled') : t('list.statusDisabled');
}

function coloredStatus(p) {
	if (!p.hasEntry) return chalk.yellow(statusText(p));
	return p.isEnabled ? chalk.green(statusText(p)) : chalk.dim(statusText(p));
}

export async function listCommand(options = {}) {
	const all     = await discoverPlugins();
	const plugins = options.all ? all : all.filter(p => p.isEnabled);

	if (!plugins.length) {
		log.info(options.all ? t('list.noneInstalled') : t('list.noneEnabled'));
		return;
	}

	const colName     = t('list.colName');
	const colVersion  = t('list.colVersion');
	const colCategory = t('list.colCategory');
	const colType     = t('list.colType');

	// column widths — computed from the actual (possibly translated) header
	// text, not hardcoded lengths, so alignment stays correct in any language
	const w = {
		name:     Math.max(colName.length,     ...plugins.map(p => (p.manifest.key || p.id).length)),
		version:  Math.max(colVersion.length,  ...plugins.map(p => (p.manifest.version || '-').length)),
		category: Math.max(colCategory.length, ...plugins.map(p => (p.manifest.category || '-').length)),
	};

	const pad    = (s, n) => String(s).padEnd(n);
	const header = `  ${pad(colName, w.name)}  ${pad(colVersion, w.version)}  ${pad(colCategory, w.category)}  ${colType}  ${t('list.colStatus')}`;
	log.plain(chalk.bold(header));
	log.plain(chalk.dim('  ' + '-'.repeat(header.length - 2)));

	for (const p of plugins) {
		const displayName = p.manifest.key || p.id;
		const flag     = p.error ? chalk.red('!') : ' ';
		const type     = p.manifest.service ? 'svc' : 'std';
		const version  = p.manifest.version  || '-';
		const category = p.manifest.category || '-';
		log.plain(`${flag} ${chalk.bold(pad(displayName, w.name))}  ${chalk.dim(pad(version, w.version))}  ${pad(category, w.category)}  ${pad(type, colType.length)}  ${coloredStatus(p)}`);
	}

	const en  = plugins.filter(p => p.isEnabled).length;
	const dis = plugins.length - en;
	const inc = plugins.filter(p => !p.hasEntry).length;

	log.plain('');
	log.plain(t('list.summary', { total: plugins.length, enabled: chalk.green(en), disabled: chalk.dim(dis) }) + (inc ? chalk.yellow(t('list.summaryIncomplete', { count: inc })) : ''));
	log.plain(chalk.dim(t('list.legend')));
}
