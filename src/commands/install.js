import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

const PLUGINS_DIR = path.resolve('src/plugins');

export async function installCommand(pluginName, options) {
  // Install from local path
  if (options.local) {
    await installLocal(options.local);
    return;
  }

  // Install by name (from registry - placeholder for future)
  if (pluginName) {
    console.log(chalk.blue(`Installing "${pluginName}"...`));
    console.log(chalk.yellow('Registry not implemented yet. Use --local for local plugins.'));
    return;
  }

  // Install dependencies for current plugin
  await installDependencies(process.cwd());
}

async function installLocal(sourcePath) {
  const absSource = path.resolve(sourcePath);

  if (!await fs.pathExists(absSource)) {
    console.error(chalk.red(`❌ Path not found: ${sourcePath}`));
    process.exit(1);
  }

  const manifestPath = path.join(absSource, 'manyplug.json');
  if (!await fs.pathExists(manifestPath)) {
    console.error(chalk.red(`❌ No manyplug.json found in ${sourcePath}`));
    console.error(chalk.gray('   Run "manyplug init <name>" to create a valid plugin'));
    process.exit(1);
  }

  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch (err) {
    console.error(chalk.red(`❌ Invalid manyplug.json: ${err.message}`));
    process.exit(1);
  }

  const pluginName = manifest.name || path.basename(absSource);
  const targetDir = path.join(PLUGINS_DIR, pluginName);

  if (await fs.pathExists(targetDir)) {
    console.error(chalk.red(`❌ Plugin "${pluginName}" already installed`));
    process.exit(1);
  }

  await fs.ensureDir(PLUGINS_DIR);
  await fs.copy(absSource, targetDir);

  console.log(chalk.green(`✅ Installed "${pluginName}" to ${path.relative(process.cwd(), targetDir)}`));

  // Install npm dependencies if any
  if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
    await installNpmDeps(manifest.dependencies, targetDir);
  }
}

async function installNpmDeps(dependencies, pluginDir) {
  const deps = Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version === '*' ? 'latest' : version}`)
    .join(' ');

  if (!deps) return;

  console.log(chalk.blue(`Installing npm dependencies...`));
  try {
    execSync(`npm install ${deps}`, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
    console.log(chalk.green('✅ Dependencies installed'));
  } catch (err) {
    console.warn(chalk.yellow(`⚠️  Failed to install some dependencies: ${err.message}`));
  }
}

async function installDependencies(pluginDir) {
  const manifestPath = path.join(pluginDir, 'manyplug.json');

  if (!await fs.pathExists(manifestPath)) {
    console.error(chalk.red('❌ No manyplug.json found'));
    return;
  }

  const manifest = await fs.readJson(manifestPath);
  if (manifest.dependencies) {
    await installNpmDeps(manifest.dependencies, pluginDir);
  }
}
