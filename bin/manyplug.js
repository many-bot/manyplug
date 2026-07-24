#!/usr/bin/env node

import { program } from 'commander';
import { createRequire } from 'module';
import { installCommand, updateCommand } from '../src/install.js';
import { listCommand }                   from '../src/list.js';
import { removeCommand }                 from '../src/remove.js';
import { enableCommand, disableCommand } from '../src/enable.js';
import { initCommand }                   from '../src/init.js';
import { validateCommand }               from '../src/validate.js';
import { linkCommand, unlinkCommand }    from '../src/link.js';
import { infoCommand }                   from '../src/info.js';
import { versionCommand }                from '../src/version.js';
import { searchCommand }                 from '../src/search.js';
import { t } from '../src/i18n.js';

const pkg = createRequire(import.meta.url)('../package.json');

// ------------------------------------------------------------
// help
// ------------------------------------------------------------

// falls back to the raw commander string when a locale has no translation
// for this key yet, instead of leaking the dotted key itself
function tr(key, fallback) {
	const value = t(key);
	return value === key ? fallback : value;
}

// stable id for an option's locale key, e.g. "-c, --category <cat>" -> "category"
function optionKey(flags) {
	const long = flags.match(/--([a-zA-Z][\w-]*)/);
	if (long) return long[1];
	return flags.replace(/^-+/, '');
}

function printHelp(cmd) {
	if (!cmd) {
		console.log(t('help.title', { version: pkg.version }) + '\n');
		console.log(t('help.commandsLine'));
		console.log(t('help.optionsLine'));
		console.log(t('help.aliasesLine'));
		return;
	}

	const c = program.commands.find(c => c.name() === cmd || c.aliases().includes(cmd));
	if (!c) { console.error(t('help.unknownCommand', { cmd })); process.exit(1); }

	const args = c.registeredArguments
		.map(a => (a.required ? `<${a._name}>` : `[${a._name}]`)).join(' ');

	console.log(`manyplug ${c.name()} ${args}`);
	console.log(tr(`help.commands.${c.name()}.description`, c.description()));

	if (c.aliases().length)
		console.log(`aliases: ${c.aliases().join(', ')}`);

	const opts = c.options;
	if (opts.length) {
		console.log('\noptions:');
		for (const o of opts) {
			const desc = tr(`help.commands.${c.name()}.options.${optionKey(o.flags)}`, o.description);
			console.log(`  ${o.flags.padEnd(22)} ${desc}`);
		}
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
	.action(cmd => {
    cmd ||= "help";
    printHelp(cmd); process.exit(0);
  });

program.command('init [name]').description('create new plugin, pluginpack, or profile boilerplate')
	.option('-c, --category <cat>', 'category (integration games media utility admin fun moderation ai education social economy automation tools)', 'utility')
	.option('-t, --type <type>',    'plugin, pluginpack, or profile', 'plugin')
	.option('--lang <lang>',        'plugin language: js or ts (prompted if omitted)')
	.action(initCommand);

program.command('install [plugins...]').alias('i').description('install plugins, pluginpacks, or profiles from registry or local path')
	.option('-l, --local <path>',    'install from local path')
	.option('-w, --watch',           'watch for changes and reinstall (requires --local)')
	.option('-b, --branch <branch>', 'install from a specific branch')
	.option('-y, --yes',             'skip confirmation')
	.action(installCommand);

program.command('update [plugins...]').alias('up').description('reinstall non-local plugins whose remote version changed (all if none given)')
	.option('-y, --yes',   'skip confirmation')
	.option('-f, --force', 'reinstall even if already up to date')
	.action(updateCommand);

program.command('link [path]').alias('ln').description('symlink a local plugin into the plugins dir (like npm link) — edits apply live, no reinstall needed')
	.action(linkCommand);

program.command('unlink [plugins...]').alias('unln').description('remove a linked plugin (undo link) — leaves the source directory untouched')
	.option('-y, --yes', 'skip confirmation')
	.action(unlinkCommand);

program.command('remove [plugins...]').alias('rm').description('remove installed plugins')
	.option('-y, --yes', 'skip confirmation')
	.option('-Y', 'skip confirmation even for plugin data')
	.action(removeCommand);

program.command('search <query>').alias('s').description('search the registry for plugins')
	.option('-c, --category <cat>', 'filter by category')
	.action(searchCommand);

program.command('list').alias('ls').description('list installed plugins (enabled only by default)')
	.option('-a, --all', 'include disabled plugins')
	.action(listCommand);

program.command('enable [plugins...]').alias('en').description('enable plugins')
	.option('-a, --all', 'enable all plugins')
	.option('-p, --profile <name>', 'enable every plugin installed via this profile')
	.action(enableCommand);

program.command('disable [plugins...]').alias('dis').description('disable plugins')
	.option('-a, --all', 'disable all plugins')
	.option('-p, --profile <name>', 'disable every plugin installed via this profile')
	.action(disableCommand);

program.command('validate [path]').alias('val').description('validate manyplug.json')
	.action(validateCommand);

program.command('version [version]').description('apply a version to your plugin manifest (it can be any string)')
	.action(versionCommand);

program.command('info <plugin>').description('show information about an installed plugin')
	.action(infoCommand);

// ------------------------------------------------------------

if (process.argv.length <= 2) { printHelp(); process.exit(0); }

program.on('command:*', ([op]) => {
	console.error(t('help.unknownCommand', { cmd: op }));
	console.error(t('help.runHelp'));
	process.exit(1);
});

await program.parseAsync();
process.exit(0);
