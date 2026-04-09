import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

const PLUGIN_TEMPLATE = `/**
 * {{name}} plugin
 */

/**
 * Main plugin function - called on every message
 * @param {Object} ctx - { msg, chat, api }
 */
export default async function {{name}}Plugin({ msg, chat, api }) {
  // Your plugin logic here
  // Return true to stop further processing
  return false;
}

/**
 * Optional setup function - called once on bot initialization
 * @param {Object} api - API without message context
 */
export async function setup(api) {
  // Initialize databases, schedules, etc.
}

/**
 * Optional API exports for other plugins
 */
export const api = {
  // Expose methods for other plugins
};
`;

export async function initCommand(name, options) {
  const pluginDir = path.resolve(name);

  if (await fs.pathExists(pluginDir)) {
    console.error(chalk.red(`❌ Directory "${name}" already exists`));
    process.exit(1);
  }

  console.log(chalk.blue(`Creating plugin "${name}"...`));

  await fs.ensureDir(pluginDir);

  // Create manyplug.json
  const manifest = {
    name,
    version: '1.0.0',
    category: options.category || 'utility',
    service: false,
    description: '',
    author: '',
    dependencies: {}
  };

  await fs.writeJson(path.join(pluginDir, 'manyplug.json'), manifest, { spaces: 2 });

  // Create index.js
  const indexContent = PLUGIN_TEMPLATE.replace(/\{\{name\}\}/g, name);
  await fs.writeFile(path.join(pluginDir, 'index.js'), indexContent);

  // Create locale directory
  await fs.ensureDir(path.join(pluginDir, 'locale'));
  await fs.writeJson(
    path.join(pluginDir, 'locale', 'pt.json'),
    { plugin: { name } },
    { spaces: 2 }
  );

  console.log(chalk.green(`✅ Plugin "${name}" created at ./${name}`));
  console.log(chalk.gray(`   Category: ${options.category}`));
  console.log(chalk.gray(`   Edit manyplug.json to add dependencies`));
}
