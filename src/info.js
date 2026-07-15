import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { resolvePlugin } from './plugins.js';
import { DATA_DIR } from './paths.js';
import { getDirSize } from './utils.js';
import { formatSize } from './ui.js';
import { log } from './logger.js';
import { t } from './i18n.js';

// ------------------------------------------------------------
// info command
// ------------------------------------------------------------

export async function infoCommand(name) {
	if (!name) {
		log.error(t('info.usage'));
		process.exit(1);
	}

	const found = await resolvePlugin(name);
	if (!found) {
		log.itemFail(t('common.notInstalled', { name }));
		process.exit(1);
	}

	const { dir, manifest, isEnabled, hasEntry, error } = found;
	const m = manifest;

	const pluginSize = await getDirSize(dir);

	const dataKey  = m.key || m.name;
	const dataPath = path.join(DATA_DIR, dataKey);
	const hasData  = await fs.pathExists(dataPath);
	const dataSize = hasData ? await getDirSize(dataPath) : 0;

	const relDir     = path.relative(process.cwd(), dir);
	const statusText = !hasEntry ? t('list.statusIncomplete') : isEnabled ? t('list.statusEnabled') : t('list.statusDisabled');
	const status     = !hasEntry ? chalk.yellow(statusText) : isEnabled ? chalk.green(statusText) : chalk.dim(statusText);
	const type       = m.service ? t('info.typeService') : t('info.typeStandard');

	log.plain(chalk.bold(`${m.key || m.name}@${m.version || '?'}`));
	log.plain('');

	const row = (label, value) => log.plain(`  ${chalk.dim(label.padEnd(16))} ${value}`);

	row(t('info.rowName'),     m.name     || '-');
	row(t('info.rowKey'),      m.key      || '-');
	row(t('info.rowVersion'),  m.version  || '-');
	row(t('info.rowCategory'), m.category || '-');
	row(t('info.rowAuthor'),   typeof m.author === 'object' ? m.author.name : (m.author || '-'));
	row(t('info.rowLicense'),  m.license  || '-');
	row(t('info.rowRepo'),     m.repo     || '-');
	row(t('info.rowType'),     type);
	row(t('info.rowStatus'),   status);
	row(t('info.rowMain'),     m.main || 'index.js');
	row(t('info.rowPath'),     relDir);
	row(t('info.rowSize'),     formatSize(pluginSize));
	row(t('info.rowData'),     hasData ? `${dataPath}  (${formatSize(dataSize)})` : t('info.dataNone'));

	if (m.description) {
		log.plain('');
		log.plain(chalk.dim(`  ${m.description}`));
	}

	if (m.dependencies && Object.keys(m.dependencies).length) {
		log.plain('');
		log.plain(chalk.bold(`  ${t('info.depsHeader')}`));
		for (const [dep, ver] of Object.entries(m.dependencies))
			log.plain(`    ${dep}${chalk.dim('@' + ver)}`);
	}

	if (m.externalDependencies && Object.keys(m.externalDependencies).length) {
		log.plain('');
		log.plain(chalk.bold(`  ${t('info.extDepsHeader')}`));
		for (const [dep, cfg] of Object.entries(m.externalDependencies)) {
			const cmd = typeof cfg === 'string' ? cfg : cfg.command;
			const opt = typeof cfg === 'object' && cfg.optional ? t('info.optionalSuffix') : '';
			log.plain(`    ${dep}: ${cmd}${chalk.dim(opt)}`);
		}
	}

	if (error) {
		log.plain('');
		log.warn(t('info.manifestParseWarn'));
	}
}
