#!/usr/bin/env node

import { program } from 'commander';
import { createRequire } from 'module';
import chalk from 'chalk';
import { installCommand } from '../src/install.js';
import { listCommand } from '../src/list.js';
import { removeCommand } from '../src/remove.js';
import { enableCommand, disableCommand } from '../src/enable.js';
import { syncCommand } from '../src/sync.js';
import { initCommand } from '../src/init.js';
import { validateCommand } from '../src/validate.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

import gradient from 'gradient-string';

const logo = gradient(['#22d3ee', '#3b82f6', '#8b5cf6']).multiline(`
 ███╗   ███╗ █████╗ ███╗   ██╗██╗   ██╗██████╗ ██╗     ██╗   ██╗ ██████╗
 ████╗ ████║██╔══██╗████╗  ██║╚██╗ ██╔╝██╔══██╗██║     ██║   ██║██╔════╝
 ██╔████╔██║███████║██╔██╗ ██║ ╚████╔╝ ██████╔╝██║     ██║   ██║██║  ███╗
 ██║╚██╔╝██║██╔══██║██║╚██╗██║  ╚██╔╝  ██╔═══╝ ██║     ██║   ██║██║   ██║
 ██║ ╚═╝ ██║██║  ██║██║ ╚████║   ██║   ██║     ███████╗╚██████╔╝╚██████╔╝
 ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝     ╚══════╝ ╚═════╝  ╚═════╝
`);

const customHelp = () => {
  console.log(logo);
  console.log();
  console.log(chalk.gray(`  CLI plugin manager for SyntaxError! ManyBot`));
  console.log(chalk.dim(`  https://codeberg.com/synt-xerror/manybot`));
  console.log();

  console.log(chalk.bold.cyan('  Commands:'));
  console.log(chalk.white('    init, install, remove, list, enable, disable, sync, update, validate'));
  console.log();

  console.log(chalk.bold.cyan('  Global Options:'));
  console.log(`    ${chalk.cyan('-v, --version')}     Display version number`);
  console.log(`    ${chalk.cyan('-h, --help')}        Display help`);
  console.log(`    ${chalk.cyan('help [command]')}    Display help for a specific command`);
  console.log();
  console.log(chalk.dim('  Run `man manyplug` for full documentation'));
  console.log();
};

program
  .name('manyplug')
  .description('CLI plugin manager for SyntaxError! ManyBot\nhttps://codeberg.com/synt-xerror/manybot')
  .version(pkg.version, '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help')
  // Substituir o outputHelp do Commander pelo nosso customHelp
  .configureHelp({ formatHelp: () => '' });

// Intercepta a flag -h/--help antes do Commander processar
program.hook('preAction', () => {});

// Sobrescreve o outputHelp para não imprimir nada (nosso customHelp cuida disso)
program.configureOutput({
  writeOut: () => {},
  writeErr: (str) => process.stderr.write(str),
});

// Adiciona o help customizado como ação da flag -h
const originalHelp = program.helpInformation.bind(program);
program.helpInformation = () => {
  customHelp();
  return '';
};

// Help command
program
  .command('help [command]')
  .description('Display help for a specific command')
  .action((cmd) => {
    if (!cmd) {
      customHelp();
      process.exit(0);
    }

    const command = program.commands.find(c => c.name() === cmd || c.aliases().includes(cmd));
    if (command) {
      console.log();
      const name = command.name();
      const aliases = command.aliases();

      console.log(chalk.bold.cyan(`  manyplug ${name}`));
      console.log(chalk.gray(`  ${command.description()}`));
      console.log();

      // Usage
      const usageName = `manyplug ${name}`;
      const args = command.registeredArguments.map(arg => {
        const name = arg._name || arg.name;
        return arg.required ? `<${name}>` : `[${name}]`;
      }).join(' ');
      console.log(chalk.bold.cyan('  Usage:'));
      console.log(`    ${usageName}${args ? ' ' + args : ''}`);
      console.log();

      // Aliases
      if (aliases.length > 0) {
        console.log(chalk.bold.cyan('  Aliases:'));
        console.log(`    ${aliases.join(', ')}`);
        console.log();
      }

      // Arguments
      const argsList = command.registeredArguments.filter(arg => arg.description);
      if (argsList.length > 0) {
        console.log(chalk.bold.cyan('  Arguments:'));
        for (const arg of argsList) {
          const name = arg._name || arg.name;
          const desc = arg.description || '';
          console.log(`    ${chalk.cyan(name.padEnd(15))} ${desc}`);
        }
        console.log();
      }

      // Options
      const options = command.options;
      if (options.length > 0) {
        console.log(chalk.bold.cyan('  Options:'));
        for (const opt of options) {
          const flags = opt.flags;
          const desc = opt.description || '';
          console.log(`    ${chalk.cyan(flags.padEnd(20))} ${desc}`);
        }
        console.log();
      }
    } else {
      console.log();
      console.log(chalk.red(`  Unknown command: ${cmd}`));
      console.log();
      customHelp();
      process.exit(1);
    }
  });

// Commands
program
  .command('init [name]')
  .description('Create new plugin boilerplate')
  .option('-c, --category <cat>', 'Plugin category (games, media, utility, service, admin, fun)', 'utility')
  .option('--service', 'Mark as service plugin (runs in background)', false)
  .action(initCommand);

program
  .command('install [plugins...]')
  .description('Install plugins from registry or local path')
  .option('-l, --local <path>', 'Install from local path (single plugin only)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--needed', 'Do not reinstall up to date plugins (pacman-style)')
  .action(installCommand);

program
  .command('remove [plugins...]')
  .alias('rm')
  .description('Remove installed plugins')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--remove-deps', 'Also remove npm dependencies')
  .action(removeCommand);

program
  .command('list')
  .alias('ls')
  .description('List installed plugins (shows only enabled by default)')
  .option('-a, --all', 'Include disabled plugins')
  .action(listCommand);

program
  .command('enable [plugins...]')
  .description('Enable installed plugins')
  .action(enableCommand);

program
  .command('disable [plugins...]')
  .description('Disable installed plugins')
  .action(disableCommand);

program
  .command('validate [path]')
  .alias('val')
  .description('Validate manyplug.json configuration')
  .action(validateCommand);

program
  .command('sync')
  .description('Sync local registry with remote')
  .option('--no-add', 'Do not add new plugins to registry')
  .option('-u, --update', 'Install/update plugins from remote')
  .action(syncCommand);

program
  .command('update')
  .description('Update all plugins from remote (same as sync --update)')
  .action(() => {
    process.argv.push('--update');
    return syncCommand();
  });

// Sem args → mostra nosso help e sai
if (process.argv.length <= 2) {
  customHelp();
  process.exit(0);
}

// Handle unknown commands
program.on('command:*', (operands) => {
  console.log();
  console.log(chalk.red(`  Unknown command: ${operands[0]}`));
  console.log();
  console.log(chalk.gray('  Run') + chalk.cyan(' manyplug --help') + chalk.gray(' to see available commands'));
  console.log();
  process.exit(1);
});

program.parse();
