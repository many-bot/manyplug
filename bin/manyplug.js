#!/usr/bin/env node

import { program } from 'commander';
import { createRequire } from 'module';
import { initCommand } from '../src/commands/init.js';
import { installCommand } from '../src/commands/install.js';
import { listCommand } from '../src/commands/list.js';
import { validateCommand } from '../src/commands/validate.js';
import { syncCommand } from '../src/commands/sync.js';
import { updateCommand } from '../src/commands/update.js';
import { removeCommand } from '../src/commands/remove.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

program
  .name('manyplug')
  .description('CLI plugin manager for ManyBot')
  .version(pkg.version);

program
  .command('init <name>')
  .description('Create a new plugin boilerplate')
  .option('-c, --category <cat>', 'Plugin category', 'utility')
  .action(initCommand);

program
  .command('install [plugin]')
  .description('Install a plugin from registry or local path')
  .option('-l, --local <path>', 'Install from local path')
  .option('-g, --global', 'Install to global registry')
  .action(installCommand);

program
  .command('remove <plugin>')
  .alias('rm')
  .description('Remove an installed plugin')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--remove-deps', 'Also remove npm dependencies')
  .action(removeCommand);

program
  .command('list')
  .alias('ls')
  .description('List installed plugins')
  .option('-a, --all', 'Include disabled plugins')
  .action(listCommand);

program
  .command('sync')
  .description('Sync registry.json with installed plugins')
  .action(syncCommand);

program
  .command('update [plugin]')
  .description('Update plugins to match registry versions')
  .option('-a, --all', 'Update all plugins (default if no name given)')
  .action(updateCommand);

program
  .command('validate [path]')
  .description('Validate manyplug.json syntax')
  .action(validateCommand);

program.parse();
