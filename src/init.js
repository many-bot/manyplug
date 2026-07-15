import fs from 'fs-extra';
import path from 'path';
import { formatSize } from './ui.js';
import { ask, confirm } from './ui.js';
import { getDirSize } from './utils.js';
import { log } from './logger.js';
import { t, getCurrentLang } from './i18n.js';

const isPt = () => getCurrentLang() === 'pt';

const VALID_CATEGORIES = ['integration', 'games', 'media', 'utility', 'admin', 'fun', 'moderation', 'ai', 'education', 'social', 'economy', 'automation', 'tools'];

// ------------------------------------------------------------
// plugin templates
// ------------------------------------------------------------

const manyplugJson = (name, author, category, main) => ({
	name,
	key:         `${author}/${name}`,
	version:     '1.0.0',
	description: `${name} plugin for ManyBot`,
	category,
	author:      { name: author },
	license:     'MIT',
	repo:        `https://github.com/${author}/${name}.many`,
	main,
	dependencies:         {},
	externalDependencies: {},
});

const indexJs = (name) => `\
// ${name} - plugin do ManyBot
// Veja a referência da API em: https://manybot.stxerr.dev/docs/api-reference

/** @param {import('@manybot/types').PluginContext} ctx */
export default async function (ctx) {
  const { msg } = ctx;

  if (!msg.is("ping")) return;
  await msg.reply.text("Pong!");
}
`;

const indexJsEn = (name) => `\
// ${name} - ManyBot plugin
// See API reference here: https://manybot.stxerr.dev/docs/api-reference

/** @param {import('@manybot/types').PluginContext} ctx */
export default async function (ctx) {
  const { msg } = ctx;

  if (!msg.is("ping")) return;
  await msg.reply.text("Pong!");
}
`;

const indexTs = (name) => `\
// ${name} - plugin do ManyBot
// Veja a referência da API em: https://manybot.stxerr.dev/docs/api-reference

import type { PluginContext } from "@manybot/types";

export default async function (ctx: PluginContext) {
  const { msg } = ctx;

  if (!msg.is("ping")) return;
  await msg.reply.text("Pong!");
}
`;

const indexTsEn = (name) => `\
// ${name} - ManyBot plugin
// See API reference here: https://manybot.stxerr.dev/docs/api-reference

import type { PluginContext } from "@manybot/types";

export default async function (ctx: PluginContext) {
  const { msg } = ctx;

  if (!msg.is("ping")) return;
  await msg.reply.text("Pong!");
}
`;

const tsconfigJson = () => ({
	compilerOptions: {
		target:           'ES2022',
		module:           'NodeNext',
		moduleResolution: 'NodeNext',
		outDir:           'dist',
		rootDir:          'src',
		strict:           true,
		skipLibCheck:     true,
		esModuleInterop:  true,
	},
	include: ['src'],
});

const localePt = (name) => ({ plugin: { name, description: `Plugin ${name} para ManyBot` }, commands: {} });
const localeEn = (name) => ({ plugin: { name, description: `${name} plugin for ManyBot` },  commands: {} });

const gitignore = (lang) => [
	'node_modules/',
	'package-lock.json',
	'*.log',
	'.vscode/',
	'.DS_Store',
	'coverage/',
	...(lang === 'ts' ? ['dist/'] : []),
	isPt()
		? '# NÃO coloque manyplug.json aqui. Ele precisa estar no repositório.'
		: '# DO NOT put manyplug.json here. It needs to be on the repository.',
].join('\n') + '\n';

const readme = (name) => isPt() ? `\
# ${name}

Plugin para o ManyBot.

## Uso

Descreva aqui como usar o seu plugin.

## Licença

MIT
` : `\
# ${name}

Plugin for ManyBot.

## Usage

Describe how to use your plugin here.

## License

MIT
`;

// ------------------------------------------------------------
// pack / profile templates
// ------------------------------------------------------------

const packManifest = (name, author) => ({
	name,
	key:         `${author}/${name}`,
	version:     '1.0.0',
	description: `${name} — a pluginpack for ManyBot`,
	type:        'pluginpack',
	author:      { name: author },
	license:     'MIT',
	repo:        `https://github.com/${author}/${name}.many`,
});

const packReadme = (name) => isPt() ? `\
# ${name}

Um pluginpack do ManyBot — um único repositório reunindo vários plugins.

## Como funciona

Todo subdiretório imediato que tiver seu próprio \`manyplug.json\` é
instalado como um plugin independente — \`manyplug install ${name}\` (ou
\`manyplug install --local .\`) instala todos de uma vez. O pack em si é
só uma conveniência no momento da instalação: depois de instalado, cada
plugin fica por conta própria, exatamente como se tivesse sido instalado
individualmente.

Este scaffold inclui um plugin de exemplo (\`example-plugin/\`) para
mostrar a estrutura. Adicione mais diretórios irmãos da mesma forma e
remova o exemplo quando estiver pronto.
` : `\
# ${name}

A ManyBot pluginpack — a single repo bundling several plugins.

## How it works

Every immediate subdirectory that has its own \`manyplug.json\` is installed
as its own independent plugin — \`manyplug install ${name}\` (or
\`manyplug install --local .\`) installs all of them at once. This pack
itself is only an install-time convenience: once installed, each plugin
lives on its own, exactly like anything installed individually.

This scaffold includes one example plugin (\`example-plugin/\`) to show the
structure. Add more sibling directories the same way, and remove the
example when you're ready.
`;

const profileManifest = (name, author) => ({
	name,
	key:         `${author}/${name}`,
	version:     '1.0.0',
	description: `${name} — a plugin profile for ManyBot`,
	type:        'profile',
	author:      { name: author },
	license:     'MIT',
	plugins:     [],
});

const profileReadme = (name) => isPt() ? `\
# ${name}

Um profile de plugins do ManyBot — apenas uma lista selecionada de
plugins para instalar, sem código próprio.

## Como funciona

Liste as keys dos plugins desejados no array \`plugins\` do
\`manyplug.json\`, por exemplo:

\`\`\`json
"plugins": ["alguem/weather", "alguem/antispam"]
\`\`\`

Rodar \`manyplug install ${name}\` (depois de publicado) ou
\`manyplug install --local .\` busca todos os plugins listados no
registro — nada aqui é instalado diretamente.
` : `\
# ${name}

A ManyBot plugin profile — just a curated list of plugins to install, no
code of its own.

## How it works

List the plugin keys you want in \`manyplug.json\`'s \`plugins\` array, e.g.:

\`\`\`json
"plugins": ["someone/weather", "someone/antispam"]
\`\`\`

Running \`manyplug install ${name}\` (once published) or
\`manyplug install --local .\` fetches every plugin listed from the
registry — nothing here is installed directly.
`;

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

async function promptAuthor() {
	const author = await ask(t('init.authorPrompt'));
	if (!author || !/^[a-z0-9-]+$/i.test(author)) {
		log.error(t('init.invalidAuthor'));
		process.exit(1);
	}
	return author;
}

async function confirmOverwriteIfExists(dir, name) {
	if (!await fs.pathExists(dir)) return;
	const ok = await confirm(t('init.overwritePrompt', { name }), false);
	if (!ok) { log.info(t('common.cancelled')); process.exit(0); }
}

async function promptLang(explicit) {
	if (explicit === 'js' || explicit === 'ts') return explicit;
	while (true) {
		const answer = (await ask(`${t('init.langPrompt')} [js] `)).toLowerCase() || 'js';
		if (answer === 'js' || answer === 'ts') return answer;
		log.warn(t('init.invalidLang'));
	}
}

function validateName(name) {
	if (!name || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(name)) {
		log.error(t('init.invalidName'));
		process.exit(1);
	}
}

// ------------------------------------------------------------
// scaffold a single plugin directory (used directly, and reused for
// the example child inside a pluginpack scaffold)
// ------------------------------------------------------------

async function scaffoldPlugin(dir, name, author, category, lang) {
	const f    = (...p) => path.join(dir, ...p);
	const main = lang === 'ts' ? 'dist/index.js' : 'index.js';

	await fs.ensureDir(f('locale'));
	await fs.writeJson(f('manyplug.json'), manyplugJson(name, author, category, main), { spaces: 2 });
	await fs.writeJson(f('locale', 'pt.json'), localePt(name), { spaces: 2 });
	await fs.writeJson(f('locale', 'en.json'), localeEn(name), { spaces: 2 });
	await fs.writeFile(f('.gitignore'), gitignore(lang));
	await fs.writeFile(f('README.md'), readme(name));

	if (lang === 'ts') {
		await fs.ensureDir(f('src'));
		await fs.writeFile(f('src', 'index.ts'), isPt() ? indexTs(name) : indexTsEn(name));
		await fs.writeJson(f('tsconfig.json'), tsconfigJson(), { spaces: 2 });
		await fs.writeJson(f('package.json'), {
			type: 'module',
			scripts: { build: 'tsc' },
			devDependencies: { typescript: '^5.7.3', '@manybot/types': '^1.0.0' },
		}, { spaces: 2 });
	} else {
		await fs.writeFile(f('index.js'), isPt() ? indexJs(name) : indexJsEn(name));
		await fs.writeJson(f('package.json'), {
			type: 'module',
			devDependencies: { '@manybot/types': '^1.0.0' },
		}, { spaces: 2 });
	}
}

// ------------------------------------------------------------
// init command
// ------------------------------------------------------------

export async function initCommand(name, options = {}) {
	const t0   = Date.now();
	const type = ['plugin', 'pluginpack', 'profile'].includes(options.type) ? options.type : 'plugin';

	validateName(name);

	const category = VALID_CATEGORIES.includes(options.category) ? options.category : 'utility';
	if (options.category && !VALID_CATEGORIES.includes(options.category))
		log.warn(t('init.unknownCategory'));

	const author = await promptAuthor();
	const dir    = path.resolve(name);

	await confirmOverwriteIfExists(dir, name);

	try {
		if (type === 'pluginpack') {
			log.info(t('init.creatingPack', { key: `${author}/${name}` }));
			await fs.ensureDir(dir);
			await fs.writeJson(path.join(dir, 'manyplug.json'), packManifest(name, author), { spaces: 2 });
			await fs.writeFile(path.join(dir, 'README.md'), packReadme(name));
			const lang = await promptLang(options.lang);
			await scaffoldPlugin(path.join(dir, 'example-plugin'), 'example-plugin', author, category, lang);

		} else if (type === 'profile') {
			log.info(t('init.creatingProfile', { key: `${author}/${name}` }));
			await fs.ensureDir(dir);
			await fs.writeJson(path.join(dir, 'manyplug.json'), profileManifest(name, author), { spaces: 2 });
			await fs.writeFile(path.join(dir, 'README.md'), profileReadme(name));

		} else {
			const lang = await promptLang(options.lang);
			log.info(t('init.creating', { key: `${author}/${name}`, category, lang }));
			await scaffoldPlugin(dir, name, author, category, lang);
		}
	} catch (e) {
		log.error(e.message);
		process.exit(1);
	}

	const size = await getDirSize(dir);
	log.success(t('init.done', { size: formatSize(size), time: ((Date.now() - t0) / 1000).toFixed(2) }));

	if (type === 'plugin') {
		log.plain(t('init.publishHint'));
		log.plain(t('init.nextSteps', { name }));
	}
}
