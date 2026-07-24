import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { log } from './logger.js';
import { t } from './i18n.js';
import { VALID_CATEGORIES, KEY_RE, nameError } from './schema.js';

// ------------------------------------------------------------
// rules — each returns an error string or null
// ------------------------------------------------------------

const RULES = {
	name: v => nameError(v),

	key: v => {
		if (v === undefined) return null; // optional but validated if present
		if (typeof v !== 'string') return 'must be string';
		if (!KEY_RE.test(v)) return 'must be format author/name';
		return null;
	},

	version: v =>
		typeof v !== 'string' || !v        ? 'required string'
		: null,

	manybotVersion: v =>
		v !== undefined && typeof v !== 'string' ? 'must be string' : null,

	category: v => !VALID_CATEGORIES.includes(v)
		? `must be one of: ${VALID_CATEGORIES.join(', ')}`
		: null,

	author: v => {
		if (v === undefined || v === null) return null;
		if (typeof v === 'string') return null; // legacy plain string ok
		if (typeof v !== 'object') return 'must be string or object';
		if (!v.name || typeof v.name !== 'string') return 'author.name must be a string';
		return null;
	},

	local:    v => v !== undefined && typeof v !== 'boolean' ? 'must be boolean' : null,
	main:     v => v !== undefined && typeof v !== 'string'  ? 'must be string'  : null,
	type:     v => v !== undefined && !['plugin', 'pluginpack', 'profile'].includes(v) ? 'must be "plugin", "pluginpack" or "profile"' : null,

	dependencies: v =>
		v !== undefined && typeof v !== 'object' ? 'must be object' : null,

	externalDependencies: v => {
		if (v === undefined) return null;
		if (typeof v !== 'object') return 'must be object';
		for (const [n, c] of Object.entries(v)) {
			if (typeof c === 'string') continue;
			if (typeof c !== 'object') return `${n}: must be string or object`;
			if (c.command  !== undefined && typeof c.command  !== 'string')  return `${n}.command must be string`;
			if (c.optional !== undefined && typeof c.optional !== 'boolean') return `${n}.optional must be boolean`;
		}
		return null;
	},

	plugins: v =>
		v !== undefined && !Array.isArray(v) ? 'must be array' : null,
};

const REQUIRED = ['name', 'version', 'category'];
const KNOWN    = new Set([
	...REQUIRED,
	'key', 'author', 'local', 'description', 'manybotVersion', 'repo',
	'license', 'main', 'dependencies', 'externalDependencies', 'type', 'plugins',
]);

// fields that don't apply to pluginpack/profile manifests
const SKIP_FOR_PACK    = new Set(['main', 'category']);
const SKIP_FOR_PROFILE = new Set(['main', 'category']);

function commandExists(cmd) {
	try {
		execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'pipe' });
		return true;
	} catch { return false; }
}

// ------------------------------------------------------------
// validation helpers for i18n & code scanning
// ------------------------------------------------------------

function getDeepKeys(obj, prefix = '') {
	let keys = [];
	if (!obj || typeof obj !== 'object') return keys;
	for (const [k, v] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			keys.push(...getDeepKeys(v, fullKey));
		} else {
			keys.push(fullKey);
		}
	}
	return keys;
}

async function getJsFiles(dir) {
	const results = [];
	if (!await fs.pathExists(dir)) return results;
	const list = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of list) {
		const res = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.git') continue;
			results.push(...await getJsFiles(res));
		} else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
			results.push(res);
		}
	}
	return results;
}

// Mirrors manybot's ctx surface (drivers/whatsapp/api/index.ts buildBaseApi
// + buildApi). Kept manually in sync — if manybot's ctx API changes, this
// needs a matching update or "manyplug validate" starts flagging valid code.
const VALID_CTX_KEYS = {
	log: ['info', 'warn', 'error', 'success'],
	config: ['get'],
	i18n: ['t', 'createT', 'reload', 'getCurrentLang'],
	utils: ['emptyFolder'],
	download: ['enqueue'],
	scheduler: ['schedule'],
	plugins: ['get', 'require', 'exists'],
	contacts: ['get', 'getPfpUrl', 'getPfpPath', 'getAbout', 'block', 'unblock'],
	storage: ['dir', 'resolve'],
	send: ['text', 'image', 'video', 'audio', 'sticker', 'file', 'poll', 'to'],
	msg: ['body', 'type', 'fromMe', 'sender', 'senderName', 'command', 'args', 'is', 'hasMedia', 'isGif', 'downloadMedia', 'hasReply', 'getReply', 'reply', 'react', 'delete', 'pin', 'hasPrefix', 'getContact'],
	chat: ['id', 'name', 'isGroup', 'getParticipants', 'isAdmin', 'isSenderAdmin', 'isBotAdmin', 'clearMessages'],
	admin: ['add', 'kick', 'promote', 'demote', 'setSubject', 'setDescription', 'setProfilePic', 'getInviteLink', 'revokeInvite'],
	me: ['setName', 'setAbout', 'setProfilePic'],
	poll: ['create', 'get'],
	events: ['on', 'once', 'cleanup'],
	wa: ['sock', 'store', 'msg', 'downloadMedia'],
	settings: ['get', 'getAll', 'set', 'delete', 'deleteAll', 'global', 'forChat', 'link', 'unlink', 'getCommunityId', 'getCommunityChats'],
};

const ROOT_KEYS = new Set([
	...Object.keys(VALID_CTX_KEYS),
	't', 'botId', 'tg', 'dc',
]);

// ------------------------------------------------------------
// semver and system info helpers
// ------------------------------------------------------------

function satisfies(version, range) {
	if (!range) return true;
	if (!version) return false;

	const cleanVersion = version.replace(/^v/, '');
	const cleanRange = range.replace(/^v/, '').trim();

	const [vMajor, vMinor, vPatch] = cleanVersion.split('.').map(Number);

	const match = cleanRange.match(/^([>=<^~]+)?\s*(\d+)\.(\d+)(?:\.(\d+))?$/);
	if (!match) {
		return cleanVersion === cleanRange;
	}

	const op = match[1] || '=';
	const rMajor = Number(match[2]);
	const rMinor = Number(match[3]);
	const rPatch = Number(match[4] || 0);

	if (op === '=') {
		return vMajor === rMajor && vMinor === rMinor && vPatch === rPatch;
	}
	if (op === '>=') {
		if (vMajor !== rMajor) return vMajor > rMajor;
		if (vMinor !== rMinor) return vMinor > rMinor;
		return vPatch >= rPatch;
	}
	if (op === '>') {
		if (vMajor !== rMajor) return vMajor > rMajor;
		if (vMinor !== rMinor) return vMinor > rMinor;
		return vPatch > rPatch;
	}
	if (op === '<=') {
		if (vMajor !== rMajor) return vMajor < rMajor;
		if (vMinor !== rMinor) return vMinor < rMinor;
		return vPatch <= rPatch;
	}
	if (op === '<') {
		if (vMajor !== rMajor) return vMajor < rMajor;
		if (vMinor !== rMinor) return vMinor < rMinor;
		return vPatch < rPatch;
	}
	if (op === '^') {
		if (vMajor !== rMajor) return false;
		if (rMajor > 0) {
			if (vMinor !== rMinor) return vMinor > rMinor;
			return vPatch >= rPatch;
		} else {
			if (vMinor !== rMinor) return false;
			return vPatch >= rPatch;
		}
	}
	if (op === '~') {
		return vMajor === rMajor && vMinor === rMinor && vPatch >= rPatch;
	}

	return false;
}

// Looks for an installed manybot to check manybotVersion compatibility
// against. Checked in order: MANYBOT_DEV_PATH env var (for anyone working
// against a local manybot checkout), the global npm install, then a couple
// of common global node_modules locations.
async function getManybotVersion() {
	const candidates = [
		process.env.MANYBOT_DEV_PATH && path.join(process.env.MANYBOT_DEV_PATH, 'package.json'),
		path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@manybot/manybot', 'package.json'),
		'/usr/lib/node_modules/@manybot/manybot/package.json',
		'/usr/local/lib/node_modules/@manybot/manybot/package.json',
	].filter(Boolean);

	for (const candidate of candidates) {
		if (await fs.pathExists(candidate)) {
			try {
				const data = await fs.readJson(candidate);
				if (data.version) return data.version;
			} catch { /* try next candidate */ }
		}
	}
	return null;
}

function getBinaryVersion(cmd) {
	for (const flag of ['--version', '-version', '-v']) {
		try {
			const out = execSync(`${cmd} ${flag}`, { stdio: 'pipe' }).toString();
			const match = out.match(/version\s*([\d.]+)/i) || out.match(/([\d.]+)/);
			if (match) return match[1];
		} catch { /* try next flag */ }
	}
	return null;
}

// ------------------------------------------------------------
// type-specific manifest validation
// ------------------------------------------------------------

async function validatePackPlugins(abs, err) {
	const childDirs = [];
	for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (await fs.pathExists(path.join(abs, entry.name, 'manyplug.json'))) childDirs.push(entry.name);
	}
	if (!childDirs.length) err('plugins', t('validate.packNoChildren'));
	return childDirs;
}

function validateProfilePlugins(manifest, err, warn) {
	const list = Array.isArray(manifest.plugins) ? manifest.plugins : [];
	if (!list.length) { warn('plugins', t('validate.profileEmptyList')); return; }
	list.forEach((entry, i) => {
		if (typeof entry !== 'string' || !entry) err(`plugins[${i}]`, t('validate.profileEntryInvalid', { index: i }));
	});
}

// ------------------------------------------------------------
// validate command
// ------------------------------------------------------------

export async function validateCommand(pluginPath = '.') {
	const abs = path.resolve(pluginPath);

	if (!await fs.pathExists(abs)) {
		log.error(t('validate.pathNotFound', { path: pluginPath }));
		process.exit(1);
	}

	const manifestPath = path.join(abs, 'manyplug.json');
	if (!await fs.pathExists(manifestPath)) {
		log.error(t('validate.manifestNotFound', { path: pluginPath }));
		log.plain(t('validate.manifestNotFoundHint'));
		process.exit(1);
	}

	let manifest;
	try { manifest = await fs.readJson(manifestPath); }
	catch (e) { log.error(t('validate.invalidManifest', { message: e.message })); process.exit(1); }

	const isPack    = manifest.type === 'pluginpack';
	const isProfile = manifest.type === 'profile';
	const skipField = isPack ? SKIP_FOR_PACK : isProfile ? SKIP_FOR_PROFILE : new Set();

	const errors = [], warnings = [];
	const err  = (field, msg) => errors.push(`  ${chalk.red('error')}   ${field.padEnd(24)} ${msg}`);
	const warn = (field, msg) => warnings.push(`  ${chalk.yellow('warning')} ${field.padEnd(24)} ${msg}`);

	// required fields (category isn't meaningful for a profile)
	for (const f of REQUIRED)
		if (!skipField.has(f) && !(f in manifest)) err(f, t('validate.missingRequired'));

	// field rules
	for (const [f, v] of Object.entries(manifest)) {
		if (!KNOWN.has(f)) { warn(f, t('validate.unknownField')); continue; }
		if (skipField.has(f)) continue;
		const msg = RULES[f]?.(v);
		if (msg) err(f, msg);
	}

	// key consistency check
	if (manifest.key && manifest.name) {
		const expectedSuffix = `/${manifest.name}`;
		if (!manifest.key.endsWith(expectedSuffix))
			warn('key', t('validate.keySuffixMismatch', { name: manifest.name }));
	}

	// recommended fields
	if (!manifest.key)    warn('key',    t('validate.missingKey'));
	if (!manifest.author) warn('author', t('validate.missingAuthor'));

	if (isPack) {
		await validatePackPlugins(abs, err);
	} else if (isProfile) {
		validateProfilePlugins(manifest, err, warn);
	} else {
		// entry point
		const main = manifest.main || 'index.js';
		if (!await fs.pathExists(path.join(abs, main)))
			warn('main', t('validate.entryNotFound', { main }));
	}

	// manybot version check (not applicable to packs/profiles — they don't run)
	if (!isPack && !isProfile) {
		const mbVersion = await getManybotVersion();
		if (manifest.manybotVersion) {
			if (!mbVersion) {
				warn('manybotVersion', t('validate.mbVersionMissingInstall', { range: manifest.manybotVersion }));
			} else if (!satisfies(mbVersion, manifest.manybotVersion)) {
				warn('manybotVersion', t('validate.mbVersionMismatch', { version: mbVersion, range: manifest.manybotVersion }));
			} else {
				log.plain(`  ${chalk.cyan('info')}    manybotVersion           ${t('validate.mbVersionOk', { version: mbVersion, range: manifest.manybotVersion })}`);
			}
		} else if (mbVersion) {
			log.plain(`  ${chalk.cyan('info')}    manybotVersion           ${t('validate.mbVersionDetected', { version: mbVersion })}`);
		}
	}

	// package.json dependencies check
	const pkgJsonPath = path.join(abs, 'package.json');
	if (await fs.pathExists(pkgJsonPath)) {
		try {
			const pkg = await fs.readJson(pkgJsonPath);
			const deps = pkg.dependencies || {};
			for (const dep of Object.keys(deps)) {
				const depPath = path.join(abs, 'node_modules', dep);
				if (!await fs.pathExists(depPath)) {
					warn('package.json', t('validate.npmDepMissing', { dep }));
				}
			}
		} catch (e) {
			warn('package.json', t('validate.pkgJsonInvalid', { message: e.message }));
		}
	}

	// locale folder and sync validation (not applicable to packs/profiles)
	if (!isPack && !isProfile) {
		const localeDir = path.join(abs, 'locale');
		if (!await fs.pathExists(localeDir)) {
			warn('locale', t('validate.noLocaleDir'));
		} else {
			try {
				const files = (await fs.readdir(localeDir)).filter(f => f.endsWith('.json'));
				if (files.length === 0) {
					warn('locale', t('validate.emptyLocaleDir'));
				} else {
					const parsedLocaleFiles = [];
					for (const f of files) {
						const filePath = path.join(localeDir, f);
						try {
							const content = await fs.readJson(filePath);
							parsedLocaleFiles.push([f, content]);
						} catch (e) {
							err(`locale.${f}`, t('validate.invalidLocaleJson', { message: e.message }));
						}
					}

					if (parsedLocaleFiles.length > 1) {
						const allLocaleKeys = new Set();
						const fileKeys = new Map();
						for (const [file, contentObj] of parsedLocaleFiles) {
							const keys = new Set(getDeepKeys(contentObj));
							fileKeys.set(file, keys);
							for (const k of keys) allLocaleKeys.add(k);
						}

						for (const [file, keys] of fileKeys.entries()) {
							const missing = [];
							for (const k of allLocaleKeys) {
								if (!keys.has(k)) missing.push(k);
							}
							if (missing.length > 0) {
								warn(`locale.${file}`, t('validate.missingTranslationKeys', { keys: missing.join(', ') }));
							}
						}
					}
				}
			} catch (e) {
				err('locale', t('validate.localeReadFailed', { message: e.message }));
			}
		}
	}

	// code scanning for invalid ctx usage and executed binaries
	const requiredPluginKeys = new Set();
	if (!isPack && !isProfile) {
		try {
			const codeFiles = await getJsFiles(abs);
			for (const file of codeFiles) {
				const relativeFile = path.relative(abs, file);
				const content = await fs.readFile(file, 'utf8');

				// Check destructured keys
				const destructureRegex = /const\s*\{\s*([^}]+)\s*\}\s*=\s*ctx\b/g;
				const destrMatches = [...content.matchAll(destructureRegex)];
				for (const match of destrMatches) {
					const props = match[1].split(',').map(p => p.trim().split(':')[0].trim());
					for (const prop of props) {
						if (prop && !ROOT_KEYS.has(prop)) {
							warn(`${relativeFile}`, t('validate.destructuredUnknown', { prop }));
						}
					}
				}

				// Check ctx.<prop> and ctx.<prop>.<nested> usage
				const ctxRegex = /\bctx\.([a-zA-Z0-9_$]+)(?:\.([a-zA-Z0-9_$]+))?/g;
				const matches = [...content.matchAll(ctxRegex)];
				for (const match of matches) {
					const prop = match[1];
					const nested = match[2];

					if (!ROOT_KEYS.has(prop)) {
						warn(`${relativeFile}`, t('validate.unknownCtxProp', { prop }));
					} else if (nested && VALID_CTX_KEYS[prop]) {
						if (!VALID_CTX_KEYS[prop].includes(nested)) {
							warn(`${relativeFile}`, t('validate.unknownCtxMethod', { prop, nested }));
						}
					}
				}

				// Some ctx properties are sender objects (WAMessageSender) — they expose
				// methods like .text()/.image()/etc but aren't callable themselves. The
				// 2-level regex above can't tell "ctx.send.text(...)" (valid) apart from
				// "ctx.send(...)" (invalid), so check those known paths directly.
				const NON_CALLABLE_SENDERS = ['send', 'msg.reply'];
				for (const senderPath of NON_CALLABLE_SENDERS) {
					const escaped = senderPath.replace(/\./g, '\\.');
					const directCallRegex = new RegExp(`\\bctx\\.${escaped}\\s*\\(`);
					if (directCallRegex.test(content)) {
						warn(`${relativeFile}`, t('validate.senderNotCallable', { path: `ctx.${senderPath}` }));
					}
				}

				// Track plugin dependencies declared via ctx.plugins.require("key")
				const pluginRequireRegex = /\bctx\.plugins\.require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
				for (const match of content.matchAll(pluginRequireRegex)) {
					requiredPluginKeys.add(match[1]);
				}

				// Check for executed binaries in the code (experimental)
				const binaryRegex = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
				const binMatches = [...content.matchAll(binaryRegex)];
				const checkedBinaries = new Set();
				for (const match of binMatches) {
					const bin = match[1];
					if (checkedBinaries.has(bin)) continue;
					checkedBinaries.add(bin);

					if (!commandExists(bin)) {
						warn(`${relativeFile}`, t('validate.binaryMissing', { bin }));
					} else {
						const version = getBinaryVersion(bin);
						if (version) {
							log.plain(`  ${chalk.cyan('info')}    ${relativeFile.padEnd(24)} ${t('validate.binaryFoundVersion', { bin, version })}`);
						} else {
							warn(`${relativeFile}`, t('validate.binaryVersionUnknown', { bin }));
						}
					}
				}
			}
		} catch (e) {
			warn('code-scan', t('validate.codeScanFailed', { message: e.message }));
		}

		const currentDeps = manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {};

		if (requiredPluginKeys.size) {
			const missing = [...requiredPluginKeys].filter(key => !(key in currentDeps));

			if (missing.length) {
				const nextDeps = { ...currentDeps };
				for (const key of missing) nextDeps[key] = '*';

				try {
					manifest.dependencies = nextDeps;
					await fs.writeJson(manifestPath, manifest, { spaces: 2 });
					log.plain(`  ${chalk.cyan('info')}    dependencies             ${t('validate.depsAdded', { deps: missing.join(', ') })}`);
				} catch (e) {
					warn('dependencies', t('validate.depsWriteFailed', { message: e.message }));
				}
			}
		}

		if (Object.keys(currentDeps).length) {
			const unused = Object.keys(currentDeps).filter(key => !requiredPluginKeys.has(key));
			if (unused.length) warn('dependencies', t('validate.depsUnused', { deps: unused.join(', ') }));
		}
	}

	// external deps
	for (const [n, c] of Object.entries(manifest.externalDependencies || {})) {
		const cmd = typeof c === 'string' ? c : c.command;
		const opt = typeof c === 'object' && c.optional;
		if (!commandExists(cmd))
			(opt ? warn : err)(`externalDeps.${n}`, t('validate.externalDepMissing', { cmd }));
	}

	// output
	const name = manifest.name || path.basename(abs);
	log.plain(`${chalk.bold(name)}@${manifest.version || '?'}  ${chalk.dim('path=' + abs)}`);

	if (errors.length || warnings.length) {
		if (errors.length)   log.plain('\n' + errors.join('\n'));
		if (warnings.length) log.plain('\n' + warnings.join('\n'));
	} else {
		log.success(t('validate.allOk'));
	}

	const errCount  = errors.length   ? chalk.red(errors.length)     : errors.length;
	const warnCount = warnings.length ? chalk.yellow(warnings.length) : warnings.length;
	log.plain(`\n${t('validate.summary', { errors: errCount, warnings: warnCount })}`);
	if (errors.length) process.exit(1);
}
