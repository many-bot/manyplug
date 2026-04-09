import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

const REQUIRED_FIELDS = ['name', 'version', 'category', 'service'];
const VALID_CATEGORIES = ['games', 'media', 'utility', 'service', 'admin', 'fun'];
const VALID_SERVICES = [true, false];

export async function validateCommand(pluginPath) {
  const targetPath = pluginPath ? path.resolve(pluginPath) : process.cwd();
  const manifestPath = path.join(targetPath, 'manyplug.json');

  if (!await fs.pathExists(manifestPath)) {
    console.error(chalk.red(`❌ manyplug.json not found at ${targetPath}`));
    process.exit(1);
  }

  console.log(chalk.blue(`Validating ${path.relative(process.cwd(), manifestPath)}...`));

  let manifest;
  try {
    manifest = await fs.readJson(manifestPath);
  } catch (err) {
    console.error(chalk.red(`❌ Invalid JSON: ${err.message}`));
    process.exit(1);
  }

  const errors = [];
  const warnings = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field]) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Validate category
  if (manifest.category && !VALID_CATEGORIES.includes(manifest.category)) {
    warnings.push(`Unknown category "${manifest.category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
  }

  // Validate version format (semver-ish)
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    warnings.push(`Version "${manifest.version}" should follow semver (x.y.z)`);
  }

  // Check dependencies
  if (manifest.dependencies && typeof manifest.dependencies !== 'object') {
    errors.push('"dependencies" must be an object');
  }

  // Validate service field
  if (manifest.service !== undefined && !VALID_SERVICES.includes(manifest.service)) {
    errors.push('"service" must be a boolean (true or false)');
  }

  // Warn if service is true but no category hints
  if (manifest.service === true && manifest.category !== 'service') {
    warnings.push('Plugin marked as service=true but category is not "service"');
  }

  // Report
  if (errors.length === 0 && warnings.length === 0) {
    console.log(chalk.green('✅ Valid manyplug.json'));
    console.log(chalk.gray(`   Name: ${manifest.name}`));
    console.log(chalk.gray(`   Version: ${manifest.version}`));
    console.log(chalk.gray(`   Category: ${manifest.category}`));
    console.log(chalk.gray(`   Service: ${manifest.service === true ? 'yes (background)' : 'no (respects isPluginRunning)'}`));
    return;
  }

  for (const error of errors) {
    console.error(chalk.red(`❌ ${error}`));
  }

  for (const warning of warnings) {
    console.warn(chalk.yellow(`⚠️  ${warning}`));
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}
