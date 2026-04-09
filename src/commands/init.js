import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

const PLUGIN_TEMPLATE = `/**
 * {{name}} plugin
 *
 * SERVICE BEHAVIOR:
 * - If service: true in manyplug.json, this plugin runs as a background service.
 * - Services can choose whether to respect api.isPluginRunning(chatId) or not.
 * - If service: false, the plugin is BLOCKED when isPluginRunning(chatId) is true.
 */

/**
 * Main plugin function - called on every message
 * @param {Object} ctx - { msg, chat, api }
 */
export default async function {{name}}Plugin({ msg, chat, api }) {
  // Check if another plugin is running in this chat
  // Only works if service: false in manyplug.json
  if (!api.isService && api.isPluginRunning && api.isPluginRunning(msg.from)) {
    // This plugin is blocked because another plugin is running
    return false;
  }

  // For services (service: true), you can choose to respect or ignore:
  // if (!api.ignoreIsRunning && api.isPluginRunning?.(msg.from)) {
  //   return false; // Service choosing to respect the lock
  // }

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
  // Services can use api.schedule() for background tasks
}

/**
 * Optional API exports for other plugins
 */
export const api = {
  // Expose methods for other plugins
};
`;

const SERVICE_TEMPLATE = `/**
 * {{name}} service
 *
 * This is a BACKGROUND SERVICE that can run regardless of isPluginRunning state.
 * Services can optionally respect the lock by checking api.isPluginRunning(chatId).
 */

/**
 * Service function - called on every message
 * Services run even when other plugins have the lock
 * @param {Object} ctx - { msg, chat, api }
 */
export default async function {{name}}Service({ msg, chat, api }) {
  // This service runs even when isPluginRunning is true for this chat
  // You can optionally check and respect the lock:

  const isLocked = api.isPluginRunning?.(msg.from);

  if (isLocked && !api.config.ignoreLock) {
    // Service choosing not to run while another plugin is active
    return false;
  }

  // Service logic here
  return false;
}

/**
 * Setup runs once when bot connects
 * Good place to start background tasks
 */
export async function setup(api) {
  // Services can schedule background tasks
  // api.schedule({ ... })
}

export const api = {
  // Expose service methods
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

  const isService = options.category === 'service' || options.service;

  // Create manyplug.json
  const manifest = {
    name,
    version: '1.0.0',
    category: isService ? 'service' : (options.category || 'utility'),
    service: isService,
    description: '',
    author: '',
    dependencies: {}
  };

  await fs.writeJson(path.join(pluginDir, 'manyplug.json'), manifest, { spaces: 2 });

  // Create index.js with appropriate template
  const template = isService ? SERVICE_TEMPLATE : PLUGIN_TEMPLATE;
  const indexContent = template.replace(/\{\{name\}\}/g, name);
  await fs.writeFile(path.join(pluginDir, 'index.js'), indexContent);

  // Create locale directory
  await fs.ensureDir(path.join(pluginDir, 'locale'));
  await fs.writeJson(
    path.join(pluginDir, 'locale', 'pt.json'),
    { plugin: { name } },
    { spaces: 2 }
  );

  console.log(chalk.green(`✅ ${isService ? 'Service' : 'Plugin'} "${name}" created at ./${name}`));
  console.log(chalk.gray(`   Category: ${manifest.category}`));
  console.log(chalk.gray(`   Service: ${manifest.service ? 'yes (background)' : 'no (respects isPluginRunning)'}`));
  console.log(chalk.gray(`   Edit manyplug.json to add dependencies`));
}
