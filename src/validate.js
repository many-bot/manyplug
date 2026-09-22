import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ts from 'typescript';
import { log } from './logger.js';
import { t } from './i18n.js';
import { VALID_CATEGORIES, KEY_RE, nameError } from './schema.js';
import { loadCtxSchema, ensureLatestTypes } from './ctx-schema.js';
import { typecheckEntry } from './typecheck.js';

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

// ------------------------------------------------------------
// TypeScript-style location + source preview for code-scan findings
// ------------------------------------------------------------

// 1-based { line, col } of a character offset into `content`.
function locate(content, index) {
	const before = content.slice(0, index);
	const lines = before.split('\n');
	return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

// Renders a `tsc`-style two-line preview: the source line, then a caret
// (~~~) under the exact span that triggered the warning.
//   12 │   await ctx.send(
//      │         ~~~~~~~~
function snippetAt(content, index, length) {
	const { line, col } = locate(content, index);
	const lineText = (content.split('\n')[line - 1] ?? '').replace(/\t/g, ' ');
	const gutter = String(line);
	const pad = ' '.repeat(gutter.length);
	const caret = chalk.red('~'.repeat(Math.max(1, length)));
	return {
		line, col,
		text:
			`\n      ${chalk.dim(gutter)} │ ${lineText}\n` +
			`      ${pad} │ ${' '.repeat(Math.max(0, col - 1))}${caret}`,
	};
}

// Maps each top-level key of a JSON object to its exact { start, end }
// span (covering `"key": value`, comma excluded) via TypeScript's own JSON
// parser — same trick used for the ctx.* source scan, just pointed at
// manyplug.json instead of plugin code. Returns an empty Map on anything
// that isn't a plain top-level object (parse error, array root, etc.).
function mapManifestFields(rawManifest) {
	const fields = new Map();
	const sourceFile = ts.parseJsonText('manyplug.json', rawManifest);
	const root = sourceFile.statements[0]?.expression;
	if (!root || !ts.isObjectLiteralExpression(root)) return fields;

	for (const prop of root.properties) {
		if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
		const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(sourceFile);
		fields.set(key, { start: prop.getStart(sourceFile), end: prop.getEnd() });
	}
	return fields;
}


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

// major.minor.patch only — a leading "v" and any -rc/-beta/etc. suffix are
// dropped, so an installed RC doesn't get flagged as "outdated" against a
// same-numbered (or lower) stable release still sitting on the registry.
function versionCore(v) {
	const clean = (v || '').replace(/^v/, '').split('-')[0];
	const [major = 0, minor = 0, patch = 0] = clean.split('.').map(Number);
	return { major, minor, patch };
}

function isNewerVersion(latest, installed) {
	const a = versionCore(latest), b = versionCore(installed);
	if (a.major !== b.major) return a.major > b.major;
	if (a.minor !== b.minor) return a.minor > b.minor;
	return a.patch > b.patch;
}

// Best-effort, silent-on-failure check against the npm registry — same
// spirit as ensureLatestTypes() in ctx-schema.js, but this one never
// installs anything on its own: upgrading the user's actual running bot
// is their call, so validate only surfaces that an update exists.
async function getLatestManybotVersion() {
	try {
		const res = await fetch('https://registry.npmjs.org/@manybot/manybot/latest', {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return null;
		return (await res.json()).version || null;
	} catch {
		return null; // offline / registry unreachable
	}
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

	let manifest, rawManifest;
	try {
		rawManifest = await fs.readFile(manifestPath, 'utf8');
		manifest = JSON.parse(rawManifest);
	}
	catch (e) { log.error(t('validate.invalidManifest', { message: e.message })); process.exit(1); }

	const isPack    = manifest.type === 'pluginpack';
	const isProfile = manifest.type === 'profile';
	const skipField = isPack ? SKIP_FOR_PACK : isProfile ? SKIP_FOR_PROFILE : new Set();

	const errors = [], warnings = [];
	const err  = (field, msg) => errors.push(`  ${chalk.red('error')}   ${field.padEnd(24)} ${msg}`);
	const warn = (field, msg) => warnings.push(`  ${chalk.yellow('warning')} ${field.padEnd(24)} ${msg}`);

	// Same as warn, but for a finding tied to an exact spot in a source file:
	// the field becomes `file:line:col` (clickable in most terminals) and a
	// tsc-style source preview is appended under the message.
	const warnAt = (relativeFile, content, index, length, msg) => {
		const { line, col, text } = snippetAt(content, index, length);
		warn(`${relativeFile}:${line}:${col}`, msg + text);
	};

	// Non-fatal, informational line — same column layout as err/warn so
	// everything lines up. infoContinued() indents a follow-up line under
	// where the message text starts, with no repeated "field" label.
	const info = (field, msg) => log.plain(`  ${chalk.cyan('info')}    ${field.padEnd(24)} ${msg}`);
	const infoContinued = msg => log.plain(`${' '.repeat(35)}${msg}`);

	// required fields (category isn't meaningful for a profile)
	for (const f of REQUIRED)
		if (!skipField.has(f) && !(f in manifest)) err(f, t('validate.missingRequired'));

	// field rules
	const manifestFields = mapManifestFields(rawManifest);
	for (const [f, v] of Object.entries(manifest)) {
		if (!KNOWN.has(f)) {
			const span = manifestFields.get(f);
			if (span) warnAt('manyplug.json', rawManifest, span.start, span.end - span.start, t('validate.unknownField'));
			else warn(f, t('validate.unknownField')); // fallback if the AST scan couldn't locate it
			continue;
		}
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
			}
		}

		if (mbVersion) {
			info('manybotVersion', t('validate.mbVersionInstalled', { version: mbVersion }));

			const latest = await getLatestManybotVersion();
			if (latest && isNewerVersion(latest, mbVersion)) {
				info('manybotVersion', t('validate.mbUpdateAvailable', { from: mbVersion, to: latest }));
				infoContinued(t('validate.mbUpdateCmd'));
				infoContinued(t('validate.mbUpdateNote'));
			}
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
		// ctx surface derived from @manybot/types (see ctx-schema.js) instead of
		// a hand-maintained list — stays correct as long as the dependency is
		// current, which is why the very latest version is pulled from npm
		// (best-effort, silent offline) right before parsing it.
		await ensureLatestTypes();
		const ctxSchema = loadCtxSchema();
		const { ROOT_KEYS, VALID_CTX_KEYS } = ctxSchema;

		if (!ctxSchema.available) warn('ctx-schema', t('validate.ctxSchemaUnavailable'));

		// The entry file gets a real type-check against @manybot/types (see
		// typecheck.js): ctx is typed automatically, so aliases, destructuring
		// and sent-message handles are all followed — something the regex scan
		// below can't do. Inside the handlers it checked, the checker is
		// authoritative and the regex rules stay out of its way; everything
		// else (helpers, other files) keeps using them.
		const entryFile = path.resolve(abs, manifest.main || 'index.js');
		let typed = null;
		if (ctxSchema.available) {
			try {
				typed = typecheckEntry(entryFile, ctxSchema.file);
			} catch (e) {
				warn('type-check', t('validate.typeCheckFailed', { message: e.message }));
			}
		}

		try {
			const codeFiles = await getJsFiles(abs);
			for (const file of codeFiles) {
				const relativeFile = path.relative(abs, file);
				const content = await fs.readFile(file, 'utf8');

				const covered = typed && path.resolve(file) === entryFile ? typed.covered : [];
				const warnCtx = (index, length, msg) => {
					if (covered.some(([from, to]) => index >= from && index < to)) return;
					warnAt(relativeFile, content, index, length, msg);
				};

				if (covered.length) {
					for (const issue of typed.issues) {
						const msg = issue.senderPath ? t('validate.senderNotCallable', { path: issue.senderPath })
							: issue.notCallable ? t('validate.typeNotCallable', { path: issue.notCallable }) +
								(issue.hint ? ` ${t('validate.typeNotCallableHint', { path: issue.notCallable, prop: issue.hint })}` : '')
							: issue.message;
						warnAt(relativeFile, content, issue.start, issue.length, `${msg} ${chalk.dim(`TS${issue.code}`)}`);
					}
				}

				if (ctxSchema.available) {
					// Check destructured keys — offsets are tracked per comma-separated
					// segment so a rename like `{ msg: message }` still flags/points at
					// the actual key ("msg"), not the local alias ("message").
					const destructureRegex = /const\s*\{\s*([^}]+)\s*\}\s*=\s*ctx\b/g;
					for (const match of content.matchAll(destructureRegex)) {
						const propsText  = match[1];
						const propsStart = match.index + match[0].indexOf(propsText);
						let cursor = 0;
						for (const segment of propsText.split(',')) {
							const segStart = propsStart + cursor;
							cursor += segment.length + 1; // +1 for the comma consumed by split()
							const keyPart = segment.split(':')[0];
							const prop = keyPart.trim();
							if (!prop || ROOT_KEYS.has(prop)) continue;
							const idx = segStart + (keyPart.length - keyPart.trimStart().length);
							warnCtx(idx, prop.length, t('validate.destructuredUnknown', { prop }));
						}
					}

					// Check ctx.<prop> and ctx.<prop>.<nested> usage
					const ctxRegex = /\bctx\.([a-zA-Z0-9_$]+)(?:\.([a-zA-Z0-9_$]+))?/g;
					for (const match of content.matchAll(ctxRegex)) {
						const prop   = match[1];
						const nested = match[2];

						if (!ROOT_KEYS.has(prop)) {
							warnCtx(match.index, match[0].length, t('validate.unknownCtxProp', { prop }));
						} else if (nested && VALID_CTX_KEYS[prop] && !VALID_CTX_KEYS[prop].includes(nested)) {
							warnCtx(match.index, match[0].length, t('validate.unknownCtxMethod', { prop, nested }));
						}
					}

					// Some ctx properties are sender objects (WAMessageSender) — they expose
					// methods like .text()/.image()/etc but aren't callable themselves. The
					// 2-level regex above can't tell "ctx.send.text(...)" (valid) apart from
					// "ctx.send(...)" (invalid), so check those known paths directly.
					const NON_CALLABLE_SENDERS = ['send', 'msg.reply'];
					for (const senderPath of NON_CALLABLE_SENDERS) {
						const escaped = senderPath.replace(/\./g, '\\.');
						const directCallRegex = new RegExp(`\\bctx\\.${escaped}\\s*\\(`, 'g');
						for (const match of content.matchAll(directCallRegex)) {
							warnCtx(match.index, match[0].length, t('validate.senderNotCallable', { path: `ctx.${senderPath}` }));
						}
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
					const binIndex = match.index + match[0].lastIndexOf(bin);

					if (!commandExists(bin)) {
						warnAt(relativeFile, content, binIndex, bin.length, t('validate.binaryMissing', { bin }));
					} else {
						const version = getBinaryVersion(bin);
						if (version) {
							log.plain(`  ${chalk.cyan('info')}    ${relativeFile.padEnd(24)} ${t('validate.binaryFoundVersion', { bin, version })}`);
						} else {
							warnAt(relativeFile, content, binIndex, bin.length, t('validate.binaryVersionUnknown', { bin }));
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

