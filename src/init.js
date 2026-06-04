import fs from 'fs-extra';
import path from 'path';
import { formatSize } from './ui.js';

const VALID_CATEGORIES = ['games', 'media', 'utility', 'service', 'admin', 'fun'];

// ------------------------------------------------------------
// templates
// ------------------------------------------------------------

const manyplugJson = (name, category, service) => ({
	name, version: '1.0.0',
	description: `${name} plugin for ManyBot`,
	category, service,
	author: '', license: 'MIT', main: 'index.js',
	dependencies: {}, externalDependencies: {}
});

const indexJs = (name) => `\
// ${name} — ManyBot plugin
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "hi")) return;
  await msg.reply("Hello!");
}
`;

const localePt = (name) => ({ plugin: { name, description: `Plugin ${name} para ManyBot` }, commands: {} });
const localeEn = (name) => ({ plugin: { name, description: `${name} plugin for ManyBot` },  commands: {} });

const gitignore = () => `node_modules/\npackage-lock.json\n*.log\n.vscode/\n.DS_Store\ncoverage/\n`;

const readme = (name) => `\
# ${name}

Plugin for ManyBot.

## Installation

\`\`\`bash
manyplug install ${name}
\`\`\`

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

	if (!name || !/^[a-z0-9-]+$/.test(name)) {
		console.error('error: name must be lowercase letters, numbers, and hyphens only');
		process.exit(1);
	}

	const category = VALID_CATEGORIES.includes(options.category) ? options.category : 'utility';
	if (!VALID_CATEGORIES.includes(options.category)) {
		console.warn(`warn: unknown category, using "utility"`);
	}

	const dir     = path.resolve(name);
	const service = options.service || false;

	if (await fs.pathExists(dir)) {
		process.stdout.write(`"${name}" already exists, overwrite? [y/N] `);
		const answer = await new Promise(res => process.stdin.once('data', d => res(d.toString().trim().toLowerCase())));
		if (answer !== 'y') { console.log('cancelled'); process.exit(0); }
	}

	const f = (...p) => path.join(dir, ...p);

	console.log(`creating ${name}  category=${category}  service=${service}`);

	try {
		await fs.ensureDir(f('locale'));
		await fs.writeJson(f('manyplug.json'), manyplugJson(name, category, service), { spaces: 2 });
		await fs.writeFile(f('index.js'), indexJs(name));
		await fs.writeJson(f('locale', 'pt.json'), localePt(name), { spaces: 2 });
		await fs.writeJson(f('locale', 'en.json'), localeEn(name), { spaces: 2 });
		await fs.writeFile(f('.gitignore'), gitignore());
		await fs.writeFile(f('README.md'), readme(name));
	} catch (e) {
		console.error(`error: ${e.message}`);
		process.exit(1);
	}

	const size = await fs.stat(dir).then(() => getDirSize(dir));
	console.log(`done  size=${formatSize(size)}  time=${((Date.now() - t) / 1000).toFixed(2)}s`);
	console.log(`  cd ${name}`);
	console.log(`  manyplug validate .`);
	console.log(`  manyplug install --local .`);
}

async function getDirSize(dir) {
	let total = 0;
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		total += entry.isDirectory() ? await getDirSize(p) : (await fs.stat(p)).size;
	}
	return total;
}
