import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';

const PLUGINS_DIR = path.resolve('src/plugins');
const REGISTRY_PATH = path.resolve('registry.json');

/**
 * Check and update plugins to match registry versions
 * @param {string} pluginName - specific plugin to update, or undefined for all
 * @param {object} options - command options
 */
export async function updateCommand(pluginName, options) {
  // Check if registry exists
  if (!await fs.pathExists(REGISTRY_PATH)) {
    console.error(chalk.red('❌ registry.json not found. Run "manyplug sync" first.'));
    process.exit(1);
  }

  const registry = await fs.readJson(REGISTRY_PATH);

  if (pluginName) {
    // Update specific plugin
    await updatePlugin(pluginName, registry.plugins[pluginName]);
  } else {
    // Update all plugins
    const plugins = Object.keys(registry.plugins);
    if (plugins.length === 0) {
      console.log(chalk.gray('No plugins in registry'));
      return;
    }

    console.log(chalk.blue(`Checking ${plugins.length} plugin(s)...\n`));

    let updated = 0;
    let upToDate = 0;
    let notInstalled = 0;
    let errors = 0;

    for (const name of plugins) {
      const result = await updatePlugin(name, registry.plugins[name], { silent: true });
      if (result === 'updated') updated++;
      else if (result === 'upToDate') upToDate++;
      else if (result === 'notInstalled') notInstalled++;
      else errors++;
    }

    console.log(chalk.bold('\nUpdate Summary:'));
    console.log(chalk.green(`  Updated: ${updated}`));
    console.log(chalk.gray(`  Up to date: ${upToDate}`));
    if (notInstalled > 0) console.log(chalk.yellow(`  Not installed: ${notInstalled}`));
    if (errors > 0) console.log(chalk.red(`  Errors: ${errors}`));
  }
}

async function updatePlugin(name, registryEntry, { silent = false } = {}) {
  if (!registryEntry) {
    if (!silent) console.error(chalk.red(`❌ "${name}" not found in registry`));
    return 'error';
  }

  const pluginDir = path.join(PLUGINS_DIR, name);
  const manifestPath = path.join(pluginDir, 'manyplug.json');

  // Check if plugin is installed
  if (!await fs.pathExists(manifestPath)) {
    // Plugin exists in registry but not installed - try to install it
    if (registryEntry._sourcePath) {
      if (!silent) console.log(chalk.blue(`Installing "${name}" from registry...`));
      await installFromSource(name, registryEntry);
      return 'updated';
    }
    if (!silent) console.log(chalk.yellow(`⚠️  "${name}" not installed (run "manyplug install ${name}")`));
    return 'notInstalled';
  }

  // Read installed manifest
  const installed = await fs.readJson(manifestPath);

  // Compare versions
  if (installed.version === registryEntry.version) {
    if (!silent) console.log(chalk.gray(`  ${name}: ${installed.version} (up to date)`));
    return 'upToDate';
  }

  // Version differs - update
  if (!silent) console.log(chalk.blue(`Updating "${name}"...`));
  console.log(chalk.gray(`  ${installed.version} → ${registryEntry.version}`));

  // If we have a source path in registry, re-copy from there
  if (registryEntry._sourcePath && await fs.pathExists(registryEntry._sourcePath)) {
    // Backup current
    const backupDir = `${pluginDir}.backup-${Date.now()}`;
    await fs.copy(pluginDir, backupDir);

    try {
      // Remove old version
      await fs.remove(pluginDir);

      // Copy new version
      await fs.copy(registryEntry._sourcePath, pluginDir);

      // Install dependencies
      if (registryEntry.dependencies && Object.keys(registryEntry.dependencies).length > 0) {
        await installNpmDeps(registryEntry.dependencies);
      }

      if (!silent) console.log(chalk.green(`  ✅ Updated to ${registryEntry.version}`));
      return 'updated';
    } catch (err) {
      // Restore backup on error
      console.error(chalk.red(`  ❌ Update failed: ${err.message}`));
      console.log(chalk.yellow('  Restoring backup...'));
      await fs.copy(backupDir, pluginDir);
      await fs.remove(backupDir);
      return 'error';
    }
  }

  // No source path - just update the version in manifest (metadata update)
  await fs.writeJson(manifestPath, { ...installed, version: registryEntry.version }, { spaces: 2 });
  if (!silent) console.log(chalk.yellow(`  ⚠️  Updated version only (no source available)`));
  return 'updated';
}

async function installFromSource(name, registryEntry) {
  const sourcePath = registryEntry._sourcePath;
  const targetDir = path.join(PLUGINS_DIR, name);

  if (!await fs.pathExists(sourcePath)) {
    console.error(chalk.red(`  ❌ Source not found: ${sourcePath}`));
    return;
  }

  await fs.ensureDir(PLUGINS_DIR);
  await fs.copy(sourcePath, targetDir);

  if (registryEntry.dependencies && Object.keys(registryEntry.dependencies).length > 0) {
    await installNpmDeps(registryEntry.dependencies);
  }

  console.log(chalk.green(`  ✅ Installed "${name}" v${registryEntry.version}`));
}

async function installNpmDeps(dependencies) {
  const deps = Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version === '*' ? 'latest' : version}`)
    .join(' ');

  if (!deps) return;

  try {
    execSync(`npm install ${deps}`, { cwd: process.cwd(), stdio: 'pipe' });
  } catch (err) {
    console.warn(chalk.yellow(`  ⚠️  Failed to install dependencies: ${err.message}`));
  }
}
