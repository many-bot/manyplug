import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger, createSpinner, ICONS, THEME, createTable, formatDuration } from './ui.js';
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
  const baseDir = process.cwd();
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
      return { remoteRegistry: registry, selectedMirror: mirror };
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
// SYNC COMMAND
// ============================================================
export async function syncCommand(options = {}) {
  const startTime = Date.now();

  logger.newline();
  logger.header('Sync Registry');

  const spinner = createSpinner('Fetching remote registry...');
  spinner.start();

  // Fetch remote registry
  let remoteRegistry;
  let selectedMirror;
  try {
    const result = await fetchRemoteRegistry(spinner);
    remoteRegistry = result.remoteRegistry;
    selectedMirror = result.selectedMirror;
    spinner.succeed('Registry fetched');
  } catch (err) {
    spinner.fail(`Failed: ${err.message}`);
    process.exit(1);
  }

  // Load local registry
  const localRegistry = await loadLocalRegistry();

  // Sync: Keep local plugins, add/update from remote
  const syncedPlugins = {};
  const newPlugins = [];
  const updatedPlugins = [];
  const keptPlugins = [];
  const removedPlugins = [];

  const localPlugins = [];

  // First, keep all local plugins that exist in remote (update them)
  // or exist only locally (keep them as source of truth)
  for (const [name, localManifest] of Object.entries(localRegistry.plugins || {})) {
    const remoteManifest = remoteRegistry.plugins?.[name];

    // Skip local plugins - they are not in remote and should not be touched
    if (localManifest.local === true) {
      localPlugins.push({ name, version: localManifest.version });
      syncedPlugins[name] = localManifest;
      continue;
    }

    if (remoteManifest) {
      // Plugin exists in both - check if needs update
      if (localManifest.version !== remoteManifest.version) {
        updatedPlugins.push({
          name,
          oldVersion: localManifest.version,
          newVersion: remoteManifest.version
        });
        // Use remote version (it's newer)
        syncedPlugins[name] = remoteManifest;
      } else {
        keptPlugins.push({ name, version: localManifest.version });
        syncedPlugins[name] = localManifest;
      }
    } else {
      // Plugin only exists locally - keep it (source of truth)
      keptPlugins.push({ name, version: localManifest.version });
      syncedPlugins[name] = localManifest;
    }
  }

  // Check for plugins that only exist in remote (not locally installed)
  // These should be removed from registry (not synced)
  for (const name of Object.keys(remoteRegistry.plugins || {})) {
    if (!localRegistry.plugins?.[name]) {
      removedPlugins.push({ name, version: remoteRegistry.plugins[name].version });
      // Don't add to syncedPlugins - local is source of truth
    }
  }

  // Also check for plugins in plugins/ dir that aren't in registry at all
  // Add them if they have a valid manyplug.json
  if (await fs.pathExists(PLUGINS_DIR)) {
    const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(PLUGINS_DIR, entry.name, 'manyplug.json');
      if (await fs.pathExists(manifestPath)) {
        if (!syncedPlugins[entry.name]) {
          try {
            const manifest = await fs.readJson(manifestPath);
            newPlugins.push({ name: entry.name, version: manifest.version });
            syncedPlugins[entry.name] = manifest;
          } catch {
            // Invalid manifest, skip
          }
        }
      }
    }
  }

  // Show changes
  logger.newline();
  logger.header('Sync Summary');
  logger.separator();

  // Build summary table
  const summaryData = [];

  // New plugins (from local dir)
  if (newPlugins.length > 0) {
    summaryData.push({
      icon: chalk.green('+'),
      label: 'Added to registry',
      count: chalk.green(newPlugins.length),
      detail: newPlugins.map(p => `${p.name} ${chalk.green(p.version)}`).join(', ')
    });
  }

  // Updated plugins
  if (updatedPlugins.length > 0) {
    summaryData.push({
      icon: chalk.yellow('~'),
      label: 'Updated',
      count: chalk.yellow(updatedPlugins.length),
      detail: updatedPlugins.map(p => `${p.name} ${chalk.gray(p.oldVersion)}→${chalk.green(p.newVersion)}`).join(', ')
    });
  }

  // Kept (unchanged)
  if (keptPlugins.length > 0) {
    summaryData.push({
      icon: chalk.gray('○'),
      label: 'Unchanged',
      count: chalk.gray(keptPlugins.length),
      detail: ''
    });
  }

  // Local plugins (not in remote)
  if (localPlugins.length > 0) {
    summaryData.push({
      icon: chalk.magenta('⬤'),
      label: 'Local only',
      count: chalk.magenta(localPlugins.length),
      detail: localPlugins.map(p => p.name).join(', ')
    });
  }

  // Removed from remote (not in local)
  if (removedPlugins.length > 0) {
    summaryData.push({
      icon: chalk.red('-'),
      label: 'Skipped (not installed)',
      count: chalk.red(removedPlugins.length),
      detail: options.verbose ? removedPlugins.map(p => p.name).join(', ') : ''
    });
  }

  if (summaryData.length > 0) {
    const table = createTable(summaryData, [
      { key: 'icon', header: '', minWidth: 2, format: v => v },
      { key: 'label', header: 'Change', minWidth: 22 },
      { key: 'count', header: 'Count', minWidth: 6, format: v => v },
      { key: 'detail', header: 'Details', minWidth: 30, format: v => chalk.gray(v) }
    ], { compact: true });
    console.log(table.toString());
  } else {
    console.log(`  ${ICONS.success} ${chalk.green('Registry is up to date')}`);
  }

  logger.separator();
  console.log(`  ${chalk.gray('Source:')} ${chalk.cyan(selectedMirror.name)}`);
  console.log(`  ${chalk.gray('Remote plugins:')} ${chalk.gray(Object.keys(remoteRegistry.plugins || {}).length)}`);
  console.log(`  ${chalk.gray('Local plugins:')} ${chalk.gray(Object.keys(localRegistry.plugins || {}).length)}`);
  console.log(`  ${chalk.gray('Synced:')} ${chalk.white(Object.keys(syncedPlugins).length)}`);

  // Save synced registry
  const hasChanges = newPlugins.length > 0 || updatedPlugins.length > 0;

  if (hasChanges || options.force) {
    const syncSpinner = createSpinner('Saving registry...');
    syncSpinner.start();

    try {
      await saveRegistry({ plugins: syncedPlugins });
      syncSpinner.succeed('Registry synced');
    } catch (err) {
      syncSpinner.fail(`Failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Final summary
  const duration = Date.now() - startTime;
  logger.newline();
  logger.success(`Sync completed in ${formatDuration(duration)}`);
}
