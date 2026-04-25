import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'node:child_process';
import { logger, confirm, createSpinner, ICONS, formatSize, createBox, createTable, THEME } from './ui.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIG
// ============================================================
function getPluginsDir() {
	const baseDir = process.cwd();
	return path.join(baseDir, 'src', 'plugins');
}

function getRegistryPath() {
	const baseDir = path.resolve(__dirname, '..');
	if (fs.existsSync(path.join(baseDir, 'registry.json'))) {
		return path.join(baseDir, 'registry.json');
	}
	return path.join(baseDir, 'registry.json');
}

const PLUGINS_DIR = getPluginsDir();
const REGISTRY_PATH = getRegistryPath();

// ============================================================
// UTILS
// ============================================================
function run(cmd, cwd) {
	return new Promise((res, rej) => {
		exec(cmd, { cwd }, (err, stdout, stderr) => {
			if (err) {
				err.stderr = stderr;
				return rej(err);
			}
			res(stdout);
		});
	});
}

async function getDirectorySize(dirPath) {
	let totalSize = 0;
	async function calc(currentPath) {
		try {
			const stats = await fs.stat(currentPath);
			if (stats.isFile()) {
				totalSize += stats.size;
			} else if (stats.isDirectory()) {
				const items = await fs.readdir(currentPath);
				for (const item of items) {
					await calc(path.join(currentPath, item));
				}
			}
		} catch {}
	}
	await calc(dirPath);
	return totalSize;
}

// ============================================================
// REMOVE SINGLE PLUGIN
// ============================================================
async function removeSinglePlugin(pluginName, options = {}) {
	const startTime = Date.now();
	const pluginDir = path.join(PLUGINS_DIR, pluginName);
	const manifestPath = path.join(pluginDir, 'manyplug.json');

	// Check if plugin exists
	if (!await fs.pathExists(manifestPath)) {
		return { success: false, error: `Plugin "${pluginName}" is not installed`, plugin: pluginName, notFound: true };
	}

	// Read manifest
	let manifest;
	try {
		manifest = await fs.readJson(manifestPath);
	} catch (err) {
		manifest = { name: pluginName, version: '?', dependencies: {} };
	}

	// Calculate size before removal
	const size = await getDirectorySize(pluginDir);

	// Show plugin info box
	logger.newline();
	const infoLines = [
		`${ICONS.package} ${chalk.bold.white(manifest.name || pluginName)} ${manifest.version ? chalk.green(manifest.version) : ''}`,
	];
	if (manifest.description) {
		infoLines.push(`${chalk.gray(manifest.description)}`);
	}
	infoLines.push(`${chalk.gray('Location:')} ${chalk.cyan(path.relative(process.cwd(), pluginDir))}`);
	infoLines.push(`${chalk.gray('Size:')} ${chalk.magenta(formatSize(size))}`);
	console.log(createBox(infoLines.join('\n'), { width: 60 }));

	// Show dependencies if any
	const deps = manifest.dependencies || {};
	const hasDeps = Object.keys(deps).length > 0;

	if (hasDeps) {
		logger.newline();
		console.log(`  ${ICONS.warning} ${chalk.yellow('Dependencies that will be removed:')}`);
		Object.entries(deps).forEach(([name, version]) => {
			console.log(`    ${ICONS.bullet} ${chalk.white(name)} ${chalk.gray('@' + version)}`);
		});
		if (!options.removeDeps) {
			console.log(chalk.gray(`    (use --remove-deps to also uninstall npm dependencies)`));
		}
	}

	// Confirm removal unless --yes flag
	if (!options.yes) {
		logger.newline();
		logger.warn('This action cannot be undone!');
		const shouldRemove = await confirm('Remove this plugin?', false);
		if (!shouldRemove) {
			return { success: false, error: 'Removal cancelled', cancelled: true, plugin: pluginName };
		}
	}

	const spinner = createSpinner('Removing...');
	spinner.start();

	try {
		// Remove plugin directory
		await fs.remove(pluginDir);
		spinner.setText('Updating registry...');

		// Update registry if exists
		if (await fs.pathExists(REGISTRY_PATH)) {
			try {
				const registry = await fs.readJson(REGISTRY_PATH);
				if (registry.plugins && registry.plugins[pluginName]) {
					delete registry.plugins[pluginName];
					registry.lastUpdated = new Date().toISOString();
					await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });
				}
			} catch {}
		}

		// Remove npm dependencies if requested
		if (hasDeps && options.removeDeps) {
			spinner.setText('Removing npm dependencies...');
			const depList = Object.keys(deps).join(' ');
			try {
				await run(`npm uninstall ${depList}`, process.cwd());
			} catch (err) {
				logger.warn(`Could not remove dependencies: ${err.message}`);
			}
		}

		const duration = Date.now() - startTime;
		spinner.succeed('Removed successfully');

		return { success: true, plugin: pluginName, size, manifest, duration };
	} catch (err) {
		spinner.fail(`Failed: ${err.message}`);
		return { success: false, error: err.message, plugin: pluginName };
	}
}

// ============================================================
// REMOVE COMMAND - MULTIPLE PLUGINS
// ============================================================
export async function removeCommand(pluginsInput, options) {
	const startTime = Date.now();

	// Normalize input to array
	const pluginNames = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []);

	if (pluginNames.length === 0) {
		logger.error('Please specify at least one plugin name');
		logger.newline();
		console.log(`  ${ICONS.arrow} ${chalk.cyan('manyplug remove')} ${chalk.gray('<plugin> [plugin2] ...')}`);
		process.exit(1);
	}

	// Show header
	logger.newline();
	if (pluginNames.length === 1) {
		logger.header('Remove Plugin');
	} else {
		logger.header('Remove Plugins');
		logger.info(`Removing ${pluginNames.length} plugin(s)...`);
	}

	// Remove each plugin
	const results = [];
	for (const pluginName of pluginNames) {
		const result = await removeSinglePlugin(pluginName, options);
		results.push(result);
	}

	// Show summary
	const duration = Date.now() - startTime;
	const successCount = results.filter(r => r.success).length;
	const failCount = results.length - successCount;
	const totalFreed = results.filter(r => r.success && r.size).reduce((acc, r) => acc + r.size, 0);

	logger.newline();
	if (pluginNames.length === 1) {
		// Single plugin - simple summary
		const result = results[0];
		if (result.success) {
			logger.success(`Plugin "${result.plugin}" removed`);
			console.log(`  ${chalk.gray('Freed:')} ${formatSize(result.size)}`);
			console.log(`  ${chalk.gray('Time:')} ${(duration / 1000).toFixed(2)}s`);
		} else if (result.cancelled) {
			logger.info(result.error);
		} else {
			logger.error(result.error);
		}
	} else {
		// Multiple plugins - detailed summary table
		logger.header('Removal Summary');
		logger.separator();

		const summaryData = results.map(r => ({
			icon: r.success ? ICONS.success : ICONS.error,
			name: r.success ? chalk.green(r.plugin) : chalk.red(r.plugin || 'unknown'),
			status: r.success ? 'removed' : r.cancelled ? 'cancelled' : 'failed',
			size: r.success && r.size ? formatSize(r.size) : '-'
		}));

		const table = createTable(summaryData, [
			{ key: 'icon', header: '', minWidth: 2, format: v => v },
			{ key: 'name', header: 'Plugin', minWidth: 20 },
			{ key: 'status', header: 'Status', minWidth: 12, format: v => chalk.gray(v) },
			{ key: 'size', header: 'Freed', minWidth: 10, format: v => v === '-' ? chalk.gray('-') : chalk.magenta(v) }
		], { compact: true });

		console.log(table.toString());

		logger.separator();
		console.log(`  ${chalk.white('Total:')} ${pluginNames.length} plugin(s)`);
		console.log(`  ${chalk.green('Success:')} ${successCount}`);
		if (failCount > 0) console.log(`  ${chalk.red('Failed:')} ${failCount}`);
		if (totalFreed > 0) console.log(`  ${chalk.gray('Freed:')} ${formatSize(totalFreed)}`);
		console.log(`  ${chalk.gray('Time:')} ${(duration / 1000).toFixed(2)}s`);
	}

	// Exit with error if any failed
	if (failCount > 0) {
		process.exit(1);
	}
}
