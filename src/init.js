import fs from 'fs-extra';
import path from 'path';
import { formatSize } from './ui.js';
import { getDirSize } from './utils.js';

const VALID_CATEGORIES = ['games', 'media', 'utility', 'service', 'admin', 'fun'];

// ------------------------------------------------------------
// templates
// ------------------------------------------------------------

const manyplugJson = (name, author, category, service) => ({
	name,
	key:         `${author}/${name}`,
	version:     '1.0.0',
	description: `${name} plugin for ManyBot`,
	category,
	service,
	author:      { name: author },
	license:     'MIT',
  repo:        `https://github.com/${author}/${name}.many`,
	main:        'index.js',
	dependencies:         {},
	externalDependencies: {},
});

const indexJs = (name) => `\
// ${name} - ManyBot plugin
// See API reference here: https://manybot.stxerr.dev/docs/api-reference

export default async function (ctx) {
  const { msg } = ctx;

  if (!msg.is("ping")) return;
  await msg.reply.text("Pong!");
}
`;

const localePt = (name) => ({ plugin: { name, description: `Plugin ${name} para ManyBot` }, commands: {} });
const localeEn = (name) => ({ plugin: { name, description: `${name} plugin for ManyBot` },  commands: {} });

const gitignore = () => `node_modules/\npackage-lock.json\n*.log\n.vscode/\n.DS_Store\ncoverage/\n# DO NOT put manyplug.json here. It needs to be on the repository.`;

const readme = (name) => `\
# ${name}

Plugin for ManyBot.

## Usage

Describe how to use your plugin here.

## License

MIT
`;

// ------------------------------------------------------------
// init command
// ------------------------------------------------------------

export async function initCommand(name, options = {}) {
	const t = Date.now();

  if (!name || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(name)) {
    console.error('error: name must be lowercase letters, numbers, dots, underscores and hyphens only');
    process.exit(1);
  }

	const category = VALID_CATEGORIES.includes(options.category) ? options.category : 'utility';
	if (!VALID_CATEGORIES.includes(options.category))
		console.warn('warn: unknown category, using "utility"');

	// prompt for author handle
	process.stdout.write('author handle (e.g. your GitHub username): ');
	const author = await new Promise(res =>
		process.stdin.once('data', d => res(d.toString().trim()))
	);
	if (!author || !/^[a-z0-9-]+$/i.test(author)) {
		console.error('error: author must be alphanumeric');
		process.exit(1);
	}

	const dir     = path.resolve(name);
	const service = options.service || false;

	if (await fs.pathExists(dir)) {
		process.stdout.write(`"${name}" already exists, overwrite? [y/N] `);
		const answer = await new Promise(res =>
			process.stdin.once('data', d => res(d.toString().trim().toLowerCase()))
		);
		if (answer !== 'y') { console.log('cancelled'); process.exit(0); }
	}

	const f = (...p) => path.join(dir, ...p);

	console.log(`creating ${author}/${name}  category=${category}  service=${service}`);

	try {
		await fs.ensureDir(f('locale'));
		await fs.writeJson(f('manyplug.json'), manyplugJson(name, author, category, service), { spaces: 2 });
		await fs.writeJson(f('package.json'), { type: 'module' }, { spaces: 2 });
		await fs.writeFile(f('index.js'), indexJs(name));
		await fs.writeJson(f('locale', 'pt.json'), localePt(name), { spaces: 2 });
		await fs.writeJson(f('locale', 'en.json'), localeEn(name), { spaces: 2 });
		await fs.writeFile(f('.gitignore'), gitignore());
		await fs.writeFile(f('README.md'), readme(name));
	} catch (e) {
		console.error(`error: ${e.message}`);
		process.exit(1);
	}

	const size = await getDirSize(dir);
	console.log(`done  size=${formatSize(size)}  time=${((Date.now() - t) / 1000).toFixed(2)}s`);
	console.log(`if you wish to publish, make sure to read manyplug.json and edit with the correct information`);
	console.log(`  cd ${name}`);
	console.log(`  manyplug validate .`);
	console.log(`  manyplug install --local .`);
}
