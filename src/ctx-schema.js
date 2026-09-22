import fs from 'fs-extra';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import chalk from 'chalk';
import { run } from './utils.js';
import { log } from './logger.js';
import { t } from './i18n.js';

// Derives the plugin ctx surface (ROOT_KEYS + VALID_CTX_KEYS) straight from
// @manybot/types (BaseApi + PluginContext + SetupContext), so validate.js
// never needs manual updates when the API changes — bump the dependency and
// the schema follows.

const require = createRequire(import.meta.url);

let cached = null;

// The interfaces live in the locale submodules (en/, pt/) — the package's
// root entry (".") is just `export * from "./en/index.js"`, which has no
// interface declarations of its own, so resolving "." here would always
// yield an empty schema. Property names are identical across locales (only
// the JSDoc comments are translated), so "en" is used regardless of the
// bot's configured language.
function resolveTypesFile() {
	try {
		return require.resolve('@manybot/types/en');
	} catch {
		return null;
	}
}

function getInstalledTypesVersion() {
	const file = resolveTypesFile();
	if (!file) return null;
	try {
		// file is .../node_modules/@manybot/types/en/index.d.ts
		const pkgRoot = path.dirname(path.dirname(file));
		return fs.readJsonSync(path.join(pkgRoot, 'package.json')).version || null;
	} catch {
		return null;
	}
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_URL = 'https://registry.npmjs.org/@manybot/types/latest';
const FETCH_TIMEOUT_MS = 3000;

// Keeps the ctx-usage checks current with the real API by pulling the
// latest @manybot/types from npm before each validate run, instead of
// relying on whatever version happened to get installed alongside
// manyplug. Best-effort and silent by design: offline, a down registry, a
// read-only global install, or npm itself being unavailable should never
// block `manyplug validate` — it just falls back to whatever version is
// already resolvable (or to the "unavailable" state loadCtxSchema already
// handles).
export async function ensureLatestTypes() {
	let latest;
	try {
		const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) return;
		latest = (await res.json()).version;
		if (!latest) return;
	} catch {
		return; // offline / registry unreachable
	}

	if (getInstalledTypesVersion() === latest) return;

	try {
		await run(
			`npm install @manybot/types@${latest} --no-save --no-package-lock --no-audit --no-fund --loglevel=error`,
			PACKAGE_ROOT
		);
		cached = null; // drop any stale parse so loadCtxSchema() picks up the new version
		log.plain(`  ${chalk.cyan('info')}    @manybot/types           ${t('validate.typesUpdated', { version: latest })}`);
	} catch {
		// install failed (no perms, read-only global install, npm missing...) —
		// keep validating against whatever was already installed
	}
}

function collectInterfaces(sourceFile) {
	const interfaces = new Map(); // name -> { members: Map<name, typeNode|null>, extends: string[] }

	function visit(node) {
		if (ts.isInterfaceDeclaration(node)) {
			const members = new Map();
			for (const m of node.members) {
				if (!m.name || !ts.isIdentifier(m.name)) continue;
				const typeNode = ts.isPropertySignature(m) ? m.type : null;
				members.set(m.name.text, typeNode);
			}
			const extendsClauses = [];
			for (const h of node.heritageClauses || []) {
				for (const t of h.types) {
					if (ts.isIdentifier(t.expression)) extendsClauses.push(t.expression.text);
				}
			}
			interfaces.set(node.name.text, { members, extends: extendsClauses });
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return interfaces;
}

function getMemberNames(interfaces, name, visited = new Set()) {
	if (visited.has(name)) return [];
	visited.add(name);
	const iface = interfaces.get(name);
	if (!iface) return [];
	let names = [...iface.members.keys()];
	for (const parent of iface.extends) names = names.concat(getMemberNames(interfaces, parent, visited));
	return names;
}

function findPropTypeNode(interfaces, ifaceName, propName, visited = new Set()) {
	if (visited.has(ifaceName)) return null;
	visited.add(ifaceName);
	const iface = interfaces.get(ifaceName);
	if (!iface) return null;
	if (iface.members.has(propName)) return iface.members.get(propName);
	for (const parent of iface.extends) {
		const found = findPropTypeNode(interfaces, parent, propName, visited);
		if (found) return found;
	}
	return null;
}

function typeRefName(typeNode) {
	return typeNode && ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)
		? typeNode.typeName.text
		: null;
}

function inlineMembers(typeNode) {
	if (!typeNode || !ts.isTypeLiteralNode(typeNode)) return null;
	return typeNode.members.filter(m => m.name && ts.isIdentifier(m.name)).map(m => m.name.text);
}

// Returns { available, file, ROOT_KEYS: Set<string>, VALID_CTX_KEYS: object }.
// Result is cached for the process lifetime.
export function loadCtxSchema() {
	if (cached) return cached;

	const file = resolveTypesFile();
	if (!file) return (cached = { available: false, file: null, ROOT_KEYS: null, VALID_CTX_KEYS: null });

	let sourceFile;
	try {
		const text = fs.readFileSync(file, 'utf8');
		sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	} catch {
		return (cached = { available: false, file, ROOT_KEYS: null, VALID_CTX_KEYS: null });
	}

	const interfaces = collectInterfaces(sourceFile);
	if (!interfaces.has('PluginContext') || !interfaces.has('BaseApi')) {
		return (cached = { available: false, file, ROOT_KEYS: null, VALID_CTX_KEYS: null });
	}

	const ROOT_KEYS = new Set([
		...getMemberNames(interfaces, 'BaseApi'),
		...getMemberNames(interfaces, 'PluginContext'),
		...getMemberNames(interfaces, 'SetupContext'),
	]);

	const VALID_CTX_KEYS = {};
	for (const propName of ROOT_KEYS) {
		const typeNode =
			findPropTypeNode(interfaces, 'PluginContext', propName) ||
			findPropTypeNode(interfaces, 'SetupContext', propName) ||
			findPropTypeNode(interfaces, 'BaseApi', propName);
		if (!typeNode) continue;

		const refName = typeRefName(typeNode);
		if (refName && interfaces.has(refName)) {
			VALID_CTX_KEYS[propName] = getMemberNames(interfaces, refName);
		} else {
			const inline = inlineMembers(typeNode);
			if (inline) VALID_CTX_KEYS[propName] = inline;
		}
	}

	return (cached = { available: true, file, ROOT_KEYS, VALID_CTX_KEYS });
}

