#!/usr/bin/env node

import { program } from 'commander';
import { createRequire } from 'module';
import { installCommand, updateCommand } from '../src/install.js';
import { listCommand }                  from '../src/list.js';
import { removeCommand }                from '../src/remove.js';
import { enableCommand, disableCommand } from '../src/enable.js';
import { initCommand }                  from '../src/init.js';
import { validateCommand }              from '../src/validate.js';

const pkg = createRequire(import.meta.url)('../package.json');

// ------------------------------------------------------------
// help
// ------------------------------------------------------------

function printHelp(cmd) {
	if (!cmd) {
		console.log(`manyplug ${pkg.version} — plugin manager for ManyBot`);
		console.log('https://git.stxerr.dev/manyplug.git\n');
		console.log('commands: init install update remove list enable disable validate');
		console.log('options:  -v/--version  help <command>');
		return;
	}

	const c = program.commands.find(c => c.name() === cmd || c.aliases().includes(cmd));
	if (!c) { console.error(`unknown command: ${cmd}`); process.exit(1); }

	const args = c.registeredArguments
		.map(a => (a.required ? `<${a._name}>` : `[${a._name}]`)).join(' ');

	console.log(`manyplug ${c.name()} ${args}`);
	console.log(c.description());

	if (c.aliases().length)
		console.log(`aliases: ${c.aliases().join(', ')}`);

	const opts = c.options;
	if (opts.length) {
		console.log('\noptions:');
		for (const o of opts)
			console.log(`  ${o.flags.padEnd(22)} ${o.description}`);
	}
}

// ------------------------------------------------------------
// program
// ------------------------------------------------------------

program
	.name('manyplug')
	.version(pkg.version, '-v, --version')
	.helpOption(false);

program.command('help [command]').description('show help for a command')
	.action(cmd => { printHelp(cmd); process.exit(0); });

program.command('init [name]').description('create new plugin boilerplate')
	.option('-c, --category <cat>', 'category (games media utility service admin fun)', 'utility')
	.option('--service', 'mark as background service plugin', false)
	.action(initCommand);

program.command('install [plugins...]').description('install plugins from registry or local path')
	.option('-l, --local <path>',   'install from local path')
	.option('-b, --branch <branch>', 'install from a specific branch')
	.option('-y, --yes',             'skip confirmation')
	.option('--needed',              'skip already installed plugins')
	.action(installCommand);

program.command('update').description('reinstall all non-local plugins')
	.option('-y, --yes', 'skip confirmation')
	.action(updateCommand);

program.command('remove [plugins...]').alias('rm').description('remove installed plugins')
	.option('-y, --yes',          'skip confirmation')
	.option('--remove-deps',      'also uninstall npm dependencies')
	.action(removeCommand);

program.command('list').alias('ls').description('list installed plugins (enabled only by default)')
	.option('-a, --all', 'include disabled plugins')
	.action(listCommand);

program.command('enable [plugins...]').description('enable plugins')
	.action(enableCommand);

program.command('disable [plugins...]').description('disable plugins')
	.action(disableCommand);

program.command('validate [path]').alias('val').description('validate manyplug.json')
	.action(validateCommand);

// ------------------------------------------------------------

if (process.argv.length <= 2) { printHelp(); process.exit(0); }

program.on('command:*', ([op]) => {
	console.error(`unknown command: ${op}`);
	console.error('run "manyplug help" for usage');
	process.exit(1);
});

program.parse();
