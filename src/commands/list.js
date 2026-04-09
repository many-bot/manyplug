import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

const PLUGINS_DIR = path.resolve('src/plugins');

export async function listCommand(options) {
  const pluginsDir = PLUGINS_DIR;

  if (!await fs.pathExists(pluginsDir)) {
    console.log(chalk.yellow('No plugins directory found'));
    return;
  }

  const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
  const plugins = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(pluginsDir, entry.name, 'manyplug.json');
    const indexPath = path.join(pluginsDir, entry.name, 'index.js');

    const exists = await fs.pathExists(manifestPath);
    if (!exists && !options.all) continue;

    let manifest = null;
    let hasEntry = await fs.pathExists(indexPath);

    if (exists) {
      try {
        manifest = await fs.readJson(manifestPath);
      } catch {
        manifest = { name: entry.name, version: '?', category: 'unknown', error: true };
      }
    } else {
      manifest = { name: entry.name, category: 'unknown', noManifest: true };
    }

    plugins.push({
      name: manifest.name || entry.name,
      version: manifest.version || '-',
      category: manifest.category || '-',
      service: manifest.service === true,
      status: hasEntry ? chalk.green('✓') : chalk.red('✗'),
      path: path.join('src/plugins', entry.name)
    });
  }

  if (plugins.length === 0) {
    console.log(chalk.gray('No plugins found'));
    return;
  }

  console.log(chalk.bold('\nInstalled Plugins:\n'));
  console.log(`${chalk.gray('NAME'.padEnd(18))} ${chalk.gray('VERSION'.padEnd(10))} ${chalk.gray('CATEGORY'.padEnd(12))} ${chalk.gray('SRV')} STATUS`);
  console.log(chalk.gray('─'.repeat(60)));

  for (const p of plugins) {
    const serviceIcon = p.service ? chalk.cyan('●') : chalk.gray('○');
    console.log(`${p.name.padEnd(18)} ${p.version.padEnd(10)} ${p.category.padEnd(12)} ${serviceIcon}   ${p.status}`);
  }

  console.log(chalk.gray(`\nTotal: ${plugins.length} plugin(s)`));
  console.log(chalk.gray(`Legend: ${chalk.cyan('●')} service (background)  ${chalk.gray('○')} standard (respects isPluginRunning)`));
}
