import fs from 'fs-extra';
import path from 'path';
import { logger, createSpinner, ICONS, createTable } from './ui.js';
import chalk from 'chalk';
let PLUGINS;

async function getPlugins() {
	if (!PLUGINS) {
		try {
			({ PLUGINS } = await import(path.join(process.cwd(), 'src', 'config.js')));
		} catch (err) {
			logger.error(`Could not load config.js from ${process.cwd()}: ${err.message}`);
			process.exit(1);
		}
	}
	return PLUGINS;
}
// ============================================================
// CONFIG
// ============================================================
const CONF_PATH = path.join(process.cwd(), 'manybot.conf');

function parseConf(raw) {
	const match = raw.match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
	if (!match) return [];
	return match[1]
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
}

function buildConf(plugins) {
	return `PLUGINS=[\n${plugins.map(p => p + ',').join('\n')}\n]\n`;
}

async function readEnabledPlugins() {
	if (!await fs.pathExists(CONF_PATH)) return [];
	const raw = await fs.readFile(CONF_PATH, 'utf-8');
	return parseConf(raw);
}

async function writeEnabledPlugins(plugins) {
	await fs.writeFile(CONF_PATH, buildConf(plugins), 'utf-8');
}

// ============================================================
// ENABLE/DISABLE SINGLE PLUGIN
// ============================================================
async function enableSinglePlugin(pluginName) {
	const enabled = await readEnabledPlugins();

	if (enabled.includes(pluginName)) {
		return { success: true, plugin: pluginName, alreadyEnabled: true };
	}

	const spinner = createSpinner('Enabling plugin...');
	spinner.start();

	try {
		await writeEnabledPlugins([...enabled, pluginName]);
		spinner.succeed('Plugin enabled');
		return { success: true, plugin: pluginName };
	} catch (err) {
		spinner.fail(`Failed: ${err.message}`);
		return { success: false, error: err.message, plugin: pluginName };
	}
}

async function disableSinglePlugin(pluginName) {
	const enabled = await readEnabledPlugins();

	if (!enabled.includes(pluginName)) {
		return { success: true, plugin: pluginName, alreadyDisabled: true };
	}

	const spinner = createSpinner('Disabling plugin...');
	spinner.start();

	try {
		await writeEnabledPlugins(enabled.filter(p => p !== pluginName));
		spinner.succeed('Plugin disabled');
		return { success: true, plugin: pluginName };
	} catch (err) {
		spinner.fail(`Failed: ${err.message}`);
		return { success: false, error: err.message, plugin: pluginName };
	}
}

// ============================================================
// ENABLE COMMAND
// ============================================================
export async function enableCommand(pluginsInput) {
	const startTime = Date.now();
	const pluginNames = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []);

	if (pluginNames.length === 0) {
		logger.error('Please specify at least one plugin name');
		logger.newline();
		console.log(`  ${ICONS.arrow} ${chalk.cyan('manyplug enable')} ${chalk.gray('<plugin> [plugin2] ...')}`);
		process.exit(1);
	}

	logger.newline();
	if (pluginNames.length === 1) {
		logger.header('Enable Plugin');
	} else {
		logger.header('Enable Plugins');
		logger.info(`Enabling ${pluginNames.length} plugin(s)...`);
	}

	const results = [];
	for (const pluginName of pluginNames) {
		const result = await enableSinglePlugin(pluginName);
		results.push(result);
	}

	// Show summary for multiple plugins
	const duration = Date.now() - startTime;
	const successCount = results.filter(r => r.success).length;
	const failCount = results.length - successCount;

	if (pluginNames.length > 1) {
		logger.newline();
		logger.header('Enable Summary');
		logger.separator();

		const tableData = results.map(r => ({
			icon: r.success ? ICONS.success : ICONS.error,
			name: r.success ? chalk.green(r.plugin) : chalk.red(r.plugin || 'unknown'),
			status: r.alreadyEnabled ? 'already enabled' : r.success ? 'enabled' : 'failed'
		}));

		const table = createTable(tableData, [
			{ key: 'icon', header: '', minWidth: 2, format: v => v },
			{ key: 'name', header: 'Plugin', minWidth: 20 },
			{ key: 'status', header: 'Status', minWidth: 15, format: v => chalk.gray(v) }
		], { compact: true });

		console.log(table.toString());

		logger.separator();
		console.log(`  ${chalk.white('Total:')} ${pluginNames.length} plugin(s)`);
		console.log(`  ${chalk.green('Success:')} ${successCount}`);
		if (failCount > 0) console.log(`  ${chalk.red('Failed:')} ${failCount}`);
		console.log(`  ${chalk.gray('Time:')} ${(duration / 1000).toFixed(2)}s`);
	}

	// Exit with error if any failed
	if (failCount > 0) {
		process.exit(1);
	}
}

// ============================================================
// DISABLE COMMAND
// ============================================================
export async function disableCommand(pluginsInput) {
	const startTime = Date.now();
	const pluginNames = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []);

	if (pluginNames.length === 0) {
		logger.error('Please specify at least one plugin name');
		logger.newline();
		console.log(`  ${ICONS.arrow} ${chalk.cyan('manyplug disable')} ${chalk.gray('<plugin> [plugin2] ...')}`);
		process.exit(1);
	}

	logger.newline();
	if (pluginNames.length === 1) {
		logger.header('Disable Plugin');
	} else {
		logger.header('Disable Plugins');
		logger.info(`Disabling ${pluginNames.length} plugin(s)...`);
	}

	const results = [];
	for (const pluginName of pluginNames) {
		const result = await disableSinglePlugin(pluginName);
		results.push(result);
	}

	// Show summary for multiple plugins
	const duration = Date.now() - startTime;
	const successCount = results.filter(r => r.success).length;
	const failCount = results.length - successCount;

	if (pluginNames.length > 1) {
		logger.newline();
		logger.header('Disable Summary');
		logger.separator();

		const tableData = results.map(r => ({
			icon: r.success ? ICONS.success : ICONS.error,
			name: r.success ? chalk.gray(r.plugin) : chalk.red(r.plugin || 'unknown'),
			status: r.alreadyDisabled ? 'already disabled' : r.success ? 'disabled' : 'failed'
		}));

		const table = createTable(tableData, [
			{ key: 'icon', header: '', minWidth: 2, format: v => v },
			{ key: 'name', header: 'Plugin', minWidth: 20 },
			{ key: 'status', header: 'Status', minWidth: 15, format: v => chalk.gray(v) }
		], { compact: true });

		console.log(table.toString());

		logger.separator();
		console.log(`  ${chalk.white('Total:')} ${pluginNames.length} plugin(s)`);
		console.log(`  ${chalk.green('Success:')} ${successCount}`);
		if (failCount > 0) console.log(`  ${chalk.red('Failed:')} ${failCount}`);
		console.log(`  ${chalk.gray('Time:')} ${(duration / 1000).toFixed(2)}s`);
	}

	// Exit with error if any failed
	if (failCount > 0) {
		process.exit(1);
	}
}
