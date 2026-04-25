import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'node:child_process';
import os from 'node:os';
import { logger, createSpinner, confirm, formatSize, ICONS, STYLES } from './ui.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIG - Detect project plugins dir
// ============================================================
function getPluginsDir() {
  const baseDir = process.cwd();
  return path.join(baseDir, 'src', 'plugins');
}

function getRegistryPath() {
  const baseDir = process.cwd(); // <- aqui também
  
  if (fs.existsSync(path.join(baseDir, 'registry.json'))) {
    return path.join(baseDir, 'registry.json');
  }
  
  return path.join(baseDir, 'registry.json');
}

const PLUGINS_DIR = getPluginsDir();
const REGISTRY_PATH = getRegistryPath();

function loadConfig(key) {
  const configPath = path.join(path.resolve(__dirname, '..'), 'config.json');
  try {
    const data = fs.readJsonSync(configPath);
    if (typeof key == 'string'){
      return data[key];
    }
    return data;
  } catch (err) {
    logger.error(`Could not load config file: ${err.message}`);
    logger.info('Make sure config.json exists in your project root');
    process.exit(1);
  }
}

const MIRRORS = loadConfig("mirrors");

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
		const stats = await fs.stat(currentPath);
		if (stats.isFile()) {
			totalSize += stats.size;
		} else if (stats.isDirectory()) {
			const items = await fs.readdir(currentPath);
			for (const item of items) {
				await calc(path.join(currentPath, item));
			}
		}
	}
	await calc(dirPath);
	return totalSize;
}

// ============================================================
// REGISTRY OPERATIONS
// ============================================================
async function loadLocalRegistry() {
	try {
		return await fs.readJson(REGISTRY_PATH);
	} catch {
		return {
			lastUpdated: new Date().toISOString(),
			plugins: {}
		};
	}
}

async function loadRemoteRegistry(mirrorFetchUrl) {
	const url = `${mirrorFetchUrl}/registry.json`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}
	return await res.json();
}

async function fetchRemoteRegistry(spinner) {
	logger.info('Checking mirrors...');

	for (const mirror of MIRRORS) {
		try {
			spinner.setText(`Trying ${mirror.name}...`);
			const registry = await loadRemoteRegistry(mirror.fetch);
			logger.mirror(mirror.name, 'ok');
			return { remoteRegistry: registry, selectedMirror: mirror.git };
		} catch (err) {
			logger.mirror(mirror.name, 'fail');
		}
	}

	throw new Error('Could not fetch data from any mirror.');
}

async function saveRegistry(registry) {
	registry.lastUpdated = new Date().toISOString();
	await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });
}

// ============================================================
// PLUGIN INSTALLATION
// ============================================================
async function installPluginFromRepo({ plugin, repo }, spinner) {
	const tmpDir = path.join(os.tmpdir(), `manyplug-${Date.now()}`);
	const repoDir = path.join(tmpDir, "repo");

	await fs.mkdir(tmpDir, { recursive: true });

	try {
		spinner.setText('Cloning repository...');
		await run(`git clone --filter=blob:none --no-checkout ${repo} ${repoDir}`);

		spinner.setText('Setting up sparse checkout...');
		await run(`git sparse-checkout init --cone`, repoDir);
		await run(`git sparse-checkout set ${plugin}`, repoDir);
		await run(`git checkout`, repoDir);

		const tmpPluginPath = path.join(repoDir, plugin);
		const finalPath = path.join(PLUGINS_DIR, plugin);

		if (!await fs.pathExists(tmpPluginPath)) {
			throw new Error(`Plugin "${plugin}" not found in repository`);
		}

		const size = await getDirectorySize(tmpPluginPath);

		await fs.mkdir(PLUGINS_DIR, { recursive: true });

		spinner.setText(`Copying files (${formatSize(size)})...`);
		await fs.cp(tmpPluginPath, finalPath, { recursive: true });

		return { finalPath, size };
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
}

async function installNpmDeps(dependencies, pluginDir, spinner) {
	const deps = Object.entries(dependencies)
		.map(([name, version]) => `${name}@${version === '*' ? 'latest' : version}`)
		.join(' ');

	if (!deps) return;

	spinner.setText('Installing npm dependencies...');
	try {
		await run(`npm install ${deps}`, pluginDir);
	} catch (err) {
		logger.warn(`Failed to install some dependencies: ${err.message}`);
	}
}

// ============================================================
// EXTERNAL DEPENDENCIES CHECK
// ============================================================
function checkExternalCommand(command) {
	try {
		const isWindows = process.platform === 'win32';
		const checkCmd = isWindows ? `where ${command}` : `command -v ${command}`;
		execSync(checkCmd, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function checkExternalDeps(manifest) {
	const external = manifest.externalDependencies;
	if (!external || Object.keys(external).length === 0) {
		return { missing: [], optional: [] };
	}

	const missing = [];
	const optional = [];

	for (const [name, config] of Object.entries(external)) {
		const command = typeof config === 'string' ? config : config.command;
		const isOptional = typeof config === 'object' && config.optional === true;
		const exists = checkExternalCommand(command);

		if (!exists) {
			if (isOptional) {
				optional.push({ name, command });
			} else {
				missing.push({ name, command });
			}
		}
	}

	return { missing, optional };
}

function showExternalDepsStatus(manifest) {
	const { missing, optional } = checkExternalDeps(manifest);

	if (missing.length > 0 || optional.length > 0) {
		logger.header('External Dependencies');

		if (optional.length > 0) {
			console.log(`  ${chalk.yellow('Optional (not installed):')}`);
			optional.forEach(({ name, command }) => {
				console.log(`    ${ICONS.warning} ${chalk.white(name)} (${chalk.gray(command)})`);
			});
		}

		if (missing.length > 0) {
			console.log(`  ${chalk.red('Required (not installed):')}`);
			missing.forEach(({ name, command }) => {
				console.log(`    ${ICONS.error} ${chalk.white(name)} (${chalk.gray(command)})`);
			});
			logger.newline();
			logger.warn('Some external dependencies are missing!');
			logger.info('The plugin may not function correctly.');
			logger.info('Install using your system package manager:');
			if (process.platform === 'darwin') {
				console.log(chalk.gray('  brew install <package>'));
			} else if (process.platform === 'linux') {
				console.log(chalk.gray('  apt install <package>  # Debian/Ubuntu'));
				console.log(chalk.gray('  pacman -S <package>    # Arch'));
				console.log(chalk.gray('  dnf install <package>   # Fedora'));
			} else if (process.platform === 'win32') {
				console.log(chalk.gray('  winget install <package>'));
				console.log(chalk.gray('  scoop install <package>'));
			}
		}
	}

	return { missing, optional };
}

// ============================================================
// INSTALL FROM LOCAL PATH
// ============================================================
async function installFromLocal(sourcePath, options = {}) {
	const absSource = path.resolve(sourcePath);

	if (!await fs.pathExists(absSource)) {
		return { success: false, error: `Path not found: ${sourcePath}` };
	}

	const manifestPath = path.join(absSource, 'manyplug.json');
	if (!await fs.pathExists(manifestPath)) {
		return { success: false, error: `No manyplug.json found in ${sourcePath}` };
	}

	let manifest;
	try {
		manifest = await fs.readJson(manifestPath);
	} catch (err) {
		return { success: false, error: `Invalid manyplug.json: ${err.message}` };
	}

	const pluginName = manifest.name || path.basename(absSource);
	const targetDir = path.join(PLUGINS_DIR, pluginName);

	if (await fs.pathExists(targetDir)) {
		return { success: false, error: `Plugin "${pluginName}" already installed`, plugin: pluginName };
	}

	// Show plugin info
	logger.newline();
	logger.plugin(manifest);
	const size = await getDirectorySize(absSource);
	console.log(`  ${ICONS.bullet} ${chalk.white('Size:')} ${chalk.magenta(formatSize(size))}`);
	console.log(`  ${ICONS.bullet} ${chalk.white('From:')} ${chalk.cyan(absSource)}`);
	showExternalDepsStatus(manifest);

	// Confirm unless --yes flag
	if (!options.yes) {
		const shouldInstall = await confirm('Install this plugin?', true);
		if (!shouldInstall) {
			return { success: false, error: 'Installation cancelled', cancelled: true, plugin: pluginName };
		}
	}

	const spinner = createSpinner('Installing...');
	spinner.start();

	try {
		await fs.ensureDir(PLUGINS_DIR);
		await fs.copy(absSource, targetDir);

		if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
			await installNpmDeps(manifest.dependencies, targetDir, spinner);
		}

		const registry = await loadLocalRegistry();
		// Mark as local plugin when installing from local path
		const registryEntry = { ...manifest, local: true };
		registry.plugins[pluginName] = registryEntry;
		await saveRegistry(registry);

		spinner.succeed('Installed successfully');
		return { success: true, plugin: pluginName, size, manifest: registryEntry };
	} catch (err) {
		spinner.fail(`Failed: ${err.message}`);
		return { success: false, error: err.message, plugin: pluginName };
	}
}

// ============================================================
// INSTALL SINGLE PLUGIN FROM REGISTRY
// ============================================================
async function installSinglePlugin(pluginName, remoteRegistry, selectedMirror, options = {}) {
	const startTime = Date.now();
	const targetDir = path.join(PLUGINS_DIR, pluginName);

	// Check if already installed
	if (await fs.pathExists(targetDir)) {
		return { success: false, error: `Plugin "${pluginName}" already installed`, plugin: pluginName, exists: true };
	}

	const manifest = remoteRegistry.plugins[pluginName];
	if (!manifest) {
		return { success: false, error: `Plugin "${pluginName}" not found in registry`, plugin: pluginName, notFound: true };
	}

	// Show plugin info
	logger.newline();
	logger.plugin(manifest);
	console.log(`  ${ICONS.bullet} ${chalk.white('Source:')} ${chalk.cyan(selectedMirror)}`);
	showExternalDepsStatus(manifest);

	// Confirm unless --yes flag
	if (!options.yes) {
		const shouldInstall = await confirm('Install this plugin?', true);
		if (!shouldInstall) {
			return { success: false, error: 'Installation cancelled', cancelled: true, plugin: pluginName };
		}
	}

	const spinner = createSpinner('Installing...');
	spinner.start();

	try {
		const { size } = await installPluginFromRepo({ plugin: pluginName, repo: selectedMirror }, spinner);

		if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
			await installNpmDeps(manifest.dependencies, targetDir, spinner);
		}

		const registry = await loadLocalRegistry();
		registry.plugins[pluginName] = manifest;
		await saveRegistry(registry);

		const duration = Date.now() - startTime;
		spinner.succeed('Installed successfully');

		return { success: true, plugin: pluginName, size, manifest, duration };
	} catch (err) {
		spinner.fail(`Failed: ${err.message}`);
		return { success: false, error: err.message, plugin: pluginName };
	}
}

// ============================================================
// INSTALL SINGLE PLUGIN - BATCH MODE (no prompts)
// ============================================================
async function installSinglePluginBatch(pluginName, manifest, selectedMirror) {
	const startTime = Date.now();
	const targetDir = path.join(PLUGINS_DIR, pluginName);

	const spinner = createSpinner(`Installing ${pluginName}...`);
	spinner.start();

	try {
		const { size } = await installPluginFromRepo({ plugin: pluginName, repo: selectedMirror }, spinner);

		if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
			await installNpmDeps(manifest.dependencies, targetDir, spinner);
		}

		const registry = await loadLocalRegistry();
		registry.plugins[pluginName] = manifest;
		await saveRegistry(registry);

		const duration = Date.now() - startTime;
		spinner.succeed(`Installed ${pluginName}`);

		return { success: true, plugin: pluginName, size, manifest, duration };
	} catch (err) {
		spinner.fail(`Failed to install ${pluginName}: ${err.message}`);
		return { success: false, error: err.message, plugin: pluginName };
	}
}

// ============================================================
// INSTALL COMMAND - MULTIPLE PLUGINS (with batch confirmation)
// ============================================================
export async function installCommand(pluginsInput, options) {
	const startTime = Date.now();

	// Normalize input to array
	const pluginNames = Array.isArray(pluginsInput) ? pluginsInput : (pluginsInput ? [pluginsInput] : []);

	await fs.ensureDir(PLUGINS_DIR);

	// Install from local path (single plugin, separate flow)
	if (options?.local) {
		if (pluginNames.length > 0) {
			logger.error('Cannot specify plugin names when using --local flag');
			process.exit(1);
		}
		logger.newline();
		logger.header('Install Plugin (Local)');
		const result = await installFromLocal(options.local, options);

		if (!result.success) {
			if (result.cancelled) {
				logger.info(result.error);
				process.exit(0);
			}
			logger.error(result.error);
			process.exit(1);
		}

		const duration = Date.now() - startTime;
		logger.newline();
		logger.success(`Plugin "${result.plugin}" installed`);
		console.log(`  ${chalk.gray('Location:')} ${path.relative(process.cwd(), path.join(PLUGINS_DIR, result.plugin))}`);
		console.log(`  ${chalk.gray('Size:')} ${formatSize(result.size)}`);
		console.log(`  ${chalk.gray('Time:')} ${(duration / 1000).toFixed(2)}s`);
		return;
	}

	// No plugin specified
	if (pluginNames.length === 0) {
		logger.error('Please specify at least one plugin name or use --local <path>');
		logger.newline();
		logger.info('Usage:');
		console.log(`  ${ICONS.arrow} manyplug install <plugin> [plugin2] ...  Install from registry`);
		console.log(`  ${ICONS.arrow} manyplug install --local <path>            Install from local path`);
		process.exit(1);
	}

	// Fetch remote registry once for all plugins
	logger.newline();
	logger.header('Install Plugins');

	const spinner = createSpinner('Fetching registry...');
	let remoteRegistry, selectedMirror;

	try {
		spinner.start();
		const result = await fetchRemoteRegistry(spinner);
		remoteRegistry = result.remoteRegistry;
		selectedMirror = result.selectedMirror;
		spinner.succeed('Registry fetched');
	} catch (err) {
		spinner.fail(`Failed: ${err.message}`);
		process.exit(1);
	}

	// Collect all plugins to install and validate them
	const pluginsToInstall = [];
	const pluginsToReinstall = [];
	const pluginsNotFound = [];

	for (const pluginName of pluginNames) {
		const targetDir = path.join(PLUGINS_DIR, pluginName);
		const isInstalled = await fs.pathExists(targetDir);

		const manifest = remoteRegistry.plugins[pluginName];
		if (!manifest) {
			pluginsNotFound.push(pluginName);
			continue;
		}

		if (isInstalled) {
			// With --needed, skip already installed plugins
			if (options.needed) {
				continue;
			}
			// Otherwise, will reinstall
			pluginsToReinstall.push({
				name: pluginName,
				version: manifest.version,
				manifest
			});
		} else {
			pluginsToInstall.push({
				name: pluginName,
				version: manifest.version,
				manifest
			});
		}
	}

	// Show plugins not found
	if (pluginsNotFound.length > 0) {
		logger.newline();
		logger.error(`Not found in registry: ${pluginsNotFound.join(', ')}`);
	}

	// Show plugins that are already installed and will be skipped (--needed)
	if (options.needed) {
		const skippedCount = pluginNames.length - pluginsToInstall.length - pluginsNotFound.length;
		if (skippedCount > 0) {
			logger.newline();
			logger.info(`${skippedCount} plugin(s) already installed (--needed, skipping)`);
		}
	}

	const totalToProcess = pluginsToInstall.length + pluginsToReinstall.length;

	// If no plugins to install, exit early
	if (totalToProcess === 0) {
		logger.newline();
		logger.info('No plugins to install.');
		process.exit(pluginsNotFound.length > 0 ? 1 : 0);
	}

	// Show summary of plugins to install/reinstall
	logger.newline();
	console.log(`  ${chalk.cyan('Plugins to install:')}`);
	for (const plugin of pluginsToInstall) {
		console.log(`  ${ICONS.bullet} ${chalk.white(plugin.name)} ${chalk.green(plugin.version)}`);
	}
	for (const plugin of pluginsToReinstall) {
		console.log(`  ${ICONS.bullet} ${chalk.white(plugin.name)} ${chalk.green(plugin.version)} ${chalk.yellow('(reinstall)')}`);
	}

	// Single confirmation for all plugins
	if (!options.yes) {
		logger.newline();
		const shouldInstall = await confirm(`${totalToProcess} plugin(s) will be installed, continue?`, true);
		if (!shouldInstall) {
			logger.newline();
			logger.info('Installation cancelled');
			process.exit(0);
		}
	}

	// Remove existing plugins that will be reinstalled
	for (const plugin of pluginsToReinstall) {
		const targetDir = path.join(PLUGINS_DIR, plugin.name);
		await fs.remove(targetDir);

		// Also remove from registry
		const registry = await loadLocalRegistry();
		delete registry.plugins[plugin.name];
		await saveRegistry(registry);
	}

	// Install all plugins
	logger.newline();
	const results = [];
	for (const plugin of [...pluginsToInstall, ...pluginsToReinstall]) {
		const result = await installSinglePluginBatch(plugin.name, plugin.manifest, selectedMirror);
		results.push(result);
	}

	// Show summary
	const duration = Date.now() - startTime;
	const successCount = results.filter(r => r.success).length;
	const failCount = results.length - successCount;

	logger.newline();
	logger.header('Installation Summary');
	logger.separator();

	for (const result of results) {
		const icon = result.success ? ICONS.success : ICONS.error;
		const name = result.success ? chalk.green(result.plugin) : chalk.red(result.plugin || 'unknown');
		const status = result.success ? 'installed' : 'failed';
		console.log(`  ${icon} ${name} ${chalk.gray(`(${status})`)}`);
	}

	logger.separator();
	console.log(`  ${chalk.white('Total:')} ${results.length} plugin(s)`);
	console.log(`  ${chalk.green('Success:')} ${successCount}`);
	if (failCount > 0) console.log(`  ${chalk.red('Failed:')} ${failCount}`);

	const totalSize = results.filter(r => r.success && r.size).reduce((acc, r) => acc + r.size, 0);
	if (totalSize > 0) {
		console.log(`  ${chalk.gray('Total size:')} ${formatSize(totalSize)}`);
	}
	console.log(`  ${chalk.gray('Time:')} ${(duration / 1000).toFixed(2)}s`);

	// Exit with error if any failed
	if (failCount > 0) {
		process.exit(1);
	}
}
