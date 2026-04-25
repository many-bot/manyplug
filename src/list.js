import { existsSync, readFileSync } from "fs";
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { logger, createTable } from './ui.js';
import chalk from 'chalk';

import path from 'path';
const { resolve } = path;

const configPath = resolve(process.cwd(), "manybot.conf");

// Parse INI-style config file (key=value format)
function parseConfig(filePath) {
	const config = {};
	if (!existsSync(filePath)) {
		return config;
	}

	try {
		const content = readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');
		let currentKey = null;
		let currentValue = null;

		for (const line of lines) {
			const trimmed = line.trim();
			// Skip comments and empty lines
			if (!trimmed || trimmed.startsWith('#')) continue;

			// Check if we're collecting a multi-line array
			if (currentKey !== null) {
				currentValue += '\n' + trimmed;
				if (trimmed.endsWith(']')) {
					// End of array
					config[currentKey] = parseArrayValue(currentValue);
					currentKey = null;
					currentValue = null;
				}
				continue;
			}

			// Match key=value or key=[value1, value2]
			const match = trimmed.match(/^([^=]+)=(.*)$/);
			if (match) {
				const key = match[1].trim();
				let value = match[2].trim();

				// Check for multi-line array (starts with [ but doesn't end with ])
				if (value.startsWith('[') && !value.endsWith(']')) {
					currentKey = key;
					currentValue = value;
					continue;
				}

				// Parse array format: [item1, item2]
				if (value.startsWith('[') && value.endsWith(']')) {
					value = parseArrayValue(value);
				}

				config[key] = value;
			}
		}
	} catch (err) {
		// Silent fail, return empty config
	}

	return config;
}

// Parse array value like "[item1, item2]" or multi-line "[\nitem1,\nitem2\n]"
function parseArrayValue(value) {
	return value
		.slice(1, -1)
		.split(',')
		.map(v => v.trim().toLowerCase())
		.filter(v => v.length > 0);
}

const config = parseConfig(configPath);
const PLUGINS = config.PLUGINS || [];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIG
// ============================================================
function getPluginsDir() {
	const baseDir = process.cwd();
	return path.join(baseDir, 'src', 'plugins');
}

const PLUGINS_DIR = getPluginsDir();

// ============================================================
// LIST COMMAND
// ============================================================
export async function listCommand(options) {
	logger.header('Installed Plugins');

	if (!await fs.pathExists(PLUGINS_DIR)) {
		logger.warn('No plugins directory found');
		logger.info(`Expected at: ${PLUGINS_DIR}`);
		return;
	}

	const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
	const plugins = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const manifestPath = path.join(PLUGINS_DIR, entry.name, 'manyplug.json');
		const indexPath = path.join(PLUGINS_DIR, entry.name, 'index.js');

		const exists = await fs.pathExists(manifestPath);
		if (!exists && !options.all) continue;

		let manifest = null;
		let hasEntry = await fs.pathExists(indexPath);
		let isEnabled = PLUGINS.includes(entry.name.toLowerCase());

		if (exists) {
			try {
				manifest = await fs.readJson(manifestPath);
			} catch {
				manifest = { name: entry.name, version: '?', category: 'unknown', error: true };
			}
		} else {
			manifest = { name: entry.name, category: 'unknown', noManifest: true };
		}

		// Skip disabled plugins unless --all flag is used
		if (!isEnabled && !options.all) continue;

		plugins.push({
			name: manifest.name || entry.name,
			version: manifest.version || '-',
			category: manifest.category || '-',
			service: manifest.service === true,
			local: manifest.local === true,
			enabled: isEnabled,
			hasEntry,
			error: manifest.error,
			noManifest: manifest.noManifest,
			path: path.join(PLUGINS_DIR, entry.name)
		});
	}

	if (plugins.length === 0) {
		logger.info('No plugins found');
		logger.tip('Use --all to see disabled plugins');
		return;
	}

	// Build table columns
	const columns = [
		{
			key: 'indicator',
			header: '',
			minWidth: 2,
			format: (_, row) => {
				if (row.local) return chalk.magenta('L');
				if (row.error) return chalk.yellow('!');
				return ' ';
			}
		},
		{
			key: 'name',
			header: 'Name',
			minWidth: 15,
			format: (val, row) => {
				if (row.local) return chalk.magenta(val);
				if (row.noManifest) return chalk.gray(val);
				return chalk.white.bold(val);
			}
		},
		{
			key: 'version',
			header: 'Version',
			minWidth: 8,
			format: (val, row) => row.local ? chalk.magenta(val) : chalk.green(val)
		},
		{
			key: 'category',
			header: 'Category',
			minWidth: 10,
			format: (val) => chalk.cyan(val)
		},
		{
			key: 'type',
			header: 'Type',
			minWidth: 4,
			format: (_, row) => row.service ? chalk.cyan('●') : chalk.gray('○')
		},
		{
			key: 'status',
			header: 'Status',
			minWidth: 10,
			format: (_, row) => {
				if (!row.hasEntry) return chalk.yellow('incomplete');
				return row.enabled ? chalk.green('enabled') : chalk.gray('disabled');
			}
		}
	];

	// Create and display table
	const table = createTable(plugins, columns, { spacing: 2 });
	logger.newline();
	console.log(table.toString());

	// Summary
	const enabledCount = plugins.filter(p => p.enabled).length;
	const disabledCount = plugins.length - enabledCount;
	const localCount = plugins.filter(p => p.local).length;
	const incompleteCount = plugins.filter(p => !p.hasEntry).length;

	logger.newline();
	logger.separator();
	console.log(`  ${chalk.white('Total:')} ${chalk.white.bold(plugins.length)} plugin(s)`);
	console.log(`  ${chalk.green('●')} enabled: ${chalk.green(enabledCount)}`);
	if (disabledCount > 0) {
		console.log(`  ${chalk.gray('○')} disabled: ${chalk.gray(disabledCount)}`);
	}
	if (localCount > 0) {
		console.log(`  ${chalk.magenta('L')} local: ${chalk.magenta(localCount)}`);
	}
	if (incompleteCount > 0) {
		console.log(`  ${chalk.yellow('!')} incomplete: ${chalk.yellow(incompleteCount)}`);
	}
	logger.separator();

	logger.newline();
	logger.tip('Legend: L=local, ●=service, ○=standard, !=missing entry point');
}
