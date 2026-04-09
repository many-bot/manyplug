import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

const PLUGINS_DIR = path.resolve('src/plugins');
const REGISTRY_PATH = path.resolve('registry.json');

/**
 * Sync registry.json with installed plugins.
 * Scans all plugins in src/plugins/ and updates registry.json
 */
export async function syncCommand() {
  console.log(chalk.blue('Syncing registry...'));

  // Load existing registry or create new one
  let registry = { lastUpdated: new Date().toISOString(), plugins: {} };

  if (await fs.pathExists(REGISTRY_PATH)) {
    try {
      registry = await fs.readJson(REGISTRY_PATH);
    } catch (err) {
      console.warn(chalk.yellow('⚠️  Could not read existing registry, creating new one'));
    }
  }

  // Scan plugins directory
  if (!await fs.pathExists(PLUGINS_DIR)) {
    console.warn(chalk.yellow('⚠️  No plugins directory found'));
    await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });
    console.log(chalk.green(`✅ Registry updated at ${path.relative(process.cwd(), REGISTRY_PATH)}`));
    return;
  }

  const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
  let updated = 0;
  let added = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(PLUGINS_DIR, entry.name, 'manyplug.json');
    if (!await fs.pathExists(manifestPath)) continue;

    try {
      const manifest = await fs.readJson(manifestPath);
      const pluginName = manifest.name || entry.name;

      // Check if plugin exists in registry and version changed
      const existing = registry.plugins[pluginName];
      if (!existing) {
        added++;
      } else if (existing.version !== manifest.version) {
        updated++;
      }

      registry.plugins[pluginName] = {
        ...manifest,
        _syncedAt: new Date().toISOString(),
        _sourcePath: path.join('src/plugins', entry.name)
      };
    } catch (err) {
      console.warn(chalk.yellow(`⚠️  Failed to read ${entry.name}: ${err.message}`));
    }
  }

  // Update timestamp
  registry.lastUpdated = new Date().toISOString();

  await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });

  console.log(chalk.green(`✅ Registry synced`));
  console.log(chalk.gray(`   Added: ${added}`));
  console.log(chalk.gray(`   Updated: ${updated}`));
  console.log(chalk.gray(`   Total plugins: ${Object.keys(registry.plugins).length}`));
}
