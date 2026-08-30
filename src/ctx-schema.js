import fs from 'fs-extra';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Derives the plugin ctx surface (ROOT_KEYS + VALID_CTX_KEYS) straight from
// @manybot/types (BaseApi + PluginContext + SetupContext), so validate.js
// never needs manual updates when the API changes — bump the dependency and
// the schema follows.

const require = createRequire(import.meta.url);

let cached = null;

function resolveTypesFile() {
	try {
		return require.resolve('@manybot/types');
	} catch {
		return null;
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
