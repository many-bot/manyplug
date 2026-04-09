import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';

const PLUGINS_DIR = path.resolve('src/plugins');
const REGISTRY_PATH = path.resolve('registry.json');

/**
 * Remove an installed plugin
 * @param {string} pluginName - plugin name to remove
 * @param {object} options - command options
 */
export async function removeCommand(pluginName, options) {
  if (!pluginName) {
    console.error(chalk.red('❌ Please specify a plugin name'));
    console.log(chalk.gray('   Usage: manyplug remove <plugin-name>'));
    process.exit(1);
  }

  const pluginDir = path.join(PLUGINS_DIR, pluginName);
  const manifestPath = path.join(pluginDir, 'manyplug.json');

  // Check if plugin exists
  if (!await fs.pathExists(manifestPath)) {
    console.error(chalk.red(`❌ Plugin "${pluginName}" is not installed`));
    process.exit(1);
  }

  // Read manifest to get info before removing
  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch (err) {
    manifest = { name: pluginName, version: '?' };
  }

  // Confirm removal unless --yes flag
  if (!options.yes) {
    console.log(chalk.yellow(`⚠️  You are about to remove:`));
    console.log(chalk.white(`   ${manifest.name} v${manifest.version}`));
    if (manifest.description) {
      console.log(chalk.gray(`   ${manifest.description}`));
    }
    console.log(chalk.yellow('\nThis action cannot be undone.\n'));
    console.log(chalk.gray('Use --yes to skip this confirmation'));
    process.exit(1);
  }

  console.log(chalk.blue(`Removing "${pluginName}"...`));

  // Track dependencies to possibly remove
  const deps = manifest.dependencies || {};
  const hasDeps = Object.keys(deps).length > 0;

  try {
    // Remove plugin directory
    await fs.remove(pluginDir);
    console.log(chalk.green(`✅ Removed "${pluginName}"`));

    // Update registry if exists
    if (await fs.pathExists(REGISTRY_PATH)) {
      try {
        const registry = await fs.readJson(REGISTRY_PATH);
        if (registry.plugins && registry.plugins[pluginName]) {
          delete registry.plugins[pluginName];
          registry.lastUpdated = new Date().toISOString();
          await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });
          console.log(chalk.gray('   Updated registry'));
        }
      } catch (err) {
        // Ignore registry update errors
      }
    }

    // Warning about orphaned dependencies
    if (hasDeps && !options.removeDeps) {
      console.log(chalk.yellow('\n⚠️  Plugin had npm dependencies:'));
      for (const [dep, version] of Object.entries(deps)) {
        console.log(chalk.gray(`   - ${dep}@${version}`));
      }
      console.log(chalk.gray('Run with --remove-deps to also uninstall these'));
    }

    // Remove npm dependencies if requested
    if (hasDeps && options.removeDeps) {
      console.log(chalk.blue('\nRemoving npm dependencies...'));
      const depList = Object.keys(deps).join(' ');
      try {
        execSync(`npm uninstall ${depList}`, { cwd: process.cwd(), stdio: 'pipe' });
        console.log(chalk.green('✅ Dependencies removed'));
      } catch (err) {
        console.warn(chalk.yellow(`⚠️  Could not remove dependencies: ${err.message}`));
      }
    }
  } catch (err) {
    console.error(chalk.red(`❌ Failed to remove plugin: ${err.message}`));
    process.exit(1);
  }
}
