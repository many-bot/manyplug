import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';

// Type-checks the plugin's entry file against @manybot/types using the real
// TypeScript checker, without asking the plugin author to annotate anything.
//
// How it works:
//   1. The entry file is parsed and its exported handlers are located:
//        export default (async) function (ctx) {}      -> PluginContext
//        export default (ctx) => {}                     -> PluginContext
//        export default { setup(ctx) {}, default(ctx) {} }
//        export (async) function setup(ctx) {}         -> SetupContext
//        export { handler as default, init as setup }
//   2. A type annotation for the first parameter is injected *in memory only*
//      (a param-level `@type` JSDoc in .js files, a `: T` in .ts files), so
//      the file on disk is never touched. Functions the author already
//      annotated are left alone.
//   3. The patched text is fed to a TS Program (checkJs) through a custom
//      CompilerHost. `@manybot/types` is resolved to the copy manyplug itself
//      already located (ctx-schema.js) — the plugin's folder doesn't need it
//      installed — and every other bare import is deliberately left
//      unresolved (typed `any`), which keeps this fast and independent of
//      whatever is inside the plugin's node_modules.
//   4. Diagnostics are mapped back to original offsets and filtered down to
//      the ones that are actually about the ManyBot API (see classify()).
//
// Helpers that live in *other* files receive `ctx` as `any` — TypeScript can't
// infer parameter types from call sites — so those files stay with the regex
// scan in validate.js.

const TYPES_MODULE = /^@manybot\/types(?:\/(?:en|pt))?$/;
const JS_EXT = new Set(['.js', '.mjs', '.cjs']);
const TS_EXT = new Set(['.ts', '.mts', '.cts']);

// 2339/2551 property does not exist · 2349 not callable · 2345 argument type ·
// 2353/2561 unknown key in object literal (2561 = "did you mean ...?") ·
// 2559 no properties in common with an options type · 2554/2555 wrong
// argument count · 2769 no overload matches. Everything else (missing modules, missing
// @types/node, implicit any, ...) is environment noise for a validator.
const PROPERTY_CODES = new Set([2339, 2551]);
const CALL_CODES     = new Set([2345, 2353, 2561, 2559, 2554, 2555, 2769]);
const NOT_CALLABLE   = 2349;

// tsc prints inline object types in full, which can run for lines
const clip = m => (m.length > 240 ? `${m.slice(0, 237)}...` : m);

const norm = p => {
	const n = path.resolve(p).replace(/\\/g, '/');
	return ts.sys.useCaseSensitiveFileNames ? n : n.toLowerCase();
};

// ------------------------------------------------------------
// 1. locating the entry functions
// ------------------------------------------------------------

const unwrap = node => {
	while (node && (
		ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) ||
		ts.isNonNullExpression(node)
	)) node = node.expression;
	return node;
};

const isFnLike = n => !!n && (
	ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
	ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
);
const hasModifier = (n, kind) => !!n.modifiers?.some(m => m.kind === kind);

// Returns [{ fn, context: 'PluginContext' | 'SetupContext' }]
function findEntryFunctions(sf) {
	const locals = new Map(); // top-level name -> function declaration / initializer
	for (const st of sf.statements) {
		if (ts.isFunctionDeclaration(st) && st.name) locals.set(st.name.text, st);
		else if (ts.isVariableStatement(st))
			for (const d of st.declarationList.declarations)
				if (ts.isIdentifier(d.name) && d.initializer) locals.set(d.name.text, d.initializer);
	}

	const resolve = (node, depth = 0) => {
		node = unwrap(node);
		if (node && ts.isIdentifier(node) && depth < 5 && locals.has(node.text))
			return resolve(locals.get(node.text), depth + 1);
		return node;
	};

	const entries = [];
	const seen = new Set();
	const push = (node, context) => {
		if (!isFnLike(node) || seen.has(node)) return;
		seen.add(node);
		entries.push({ fn: node, context });
	};

	const fromModuleObject = obj => {
		for (const p of obj.properties) {
			if (!p.name || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) continue;
			const context = p.name.text === 'setup'   ? 'SetupContext'
			              : p.name.text === 'default' ? 'PluginContext'
			              : null;
			if (!context) continue;
			if (ts.isMethodDeclaration(p))               push(p, context);
			else if (ts.isPropertyAssignment(p))         push(resolve(p.initializer), context);
			else if (ts.isShorthandPropertyAssignment(p)) push(resolve(p.name), context);
		}
	};

	const fromDefault = expr => {
		const n = resolve(expr);
		if (!n) return;
		if (ts.isObjectLiteralExpression(n)) fromModuleObject(n);
		else push(n, 'PluginContext');
	};

	for (const st of sf.statements) {
		if (ts.isFunctionDeclaration(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
			if (hasModifier(st, ts.SyntaxKind.DefaultKeyword)) push(st, 'PluginContext');
			else if (st.name?.text === 'setup')                push(st, 'SetupContext');
		} else if (ts.isExportAssignment(st) && !st.isExportEquals) {
			fromDefault(st.expression);
		} else if (ts.isVariableStatement(st) && hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
			for (const d of st.declarationList.declarations)
				if (ts.isIdentifier(d.name) && d.name.text === 'setup' && d.initializer)
					push(resolve(d.initializer), 'SetupContext');
		} else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
			for (const spec of st.exportClause.elements) {
				const local = locals.get((spec.propertyName ?? spec.name).text);
				if (!local) continue;
				if (spec.name.text === 'default')    fromDefault(local);
				else if (spec.name.text === 'setup') push(resolve(local), 'SetupContext');
			}
		}
	}
	return entries;
}

// ------------------------------------------------------------
// 2. in-memory annotation
// ------------------------------------------------------------

// Returns { inserts: [{ pos, text }], covered: [[start, end]] } in ORIGINAL
// offsets. `covered` is every entry function that has a typed `ctx` after the
// edit — validate.js uses it to skip its regex checks there (the checker is
// authoritative inside those ranges).
function planEdits(sf, entries, isTs) {
	const inserts = [];
	const covered = [];

	for (const { fn, context } of entries) {
		const param = fn.parameters.find(p => !(ts.isIdentifier(p.name) && p.name.text === 'this'));
		if (!param) continue; // handler ignores ctx — nothing to type
		covered.push([fn.getStart(sf), fn.getEnd()]);

		const typeRef = `import('@manybot/types').${context}`;
		// `ctx => ...` — a parameter type/JSDoc needs parentheses around it
		const bare = ts.isArrowFunction(fn) &&
			!fn.getChildren(sf).some(c => c.kind === ts.SyntaxKind.OpenParenToken);
		const start = param.getStart(sf);

		if (isTs) {
			if (param.type) continue; // author already typed it
			const end = (param.questionToken ?? param.name).getEnd();
			if (bare) {
				inserts.push({ pos: start, text: '(' }, { pos: end, text: `: ${typeRef})` });
			} else {
				inserts.push({ pos: end, text: `: ${typeRef}` });
			}
		} else {
			if (ts.getJSDocParameterTags(param).length || ts.getJSDocType(param)) continue;
			const doc = `/** @type {${typeRef}} */ `;
			if (bare) {
				inserts.push({ pos: start, text: `(${doc}` }, { pos: param.getEnd(), text: ')' });
			} else {
				inserts.push({ pos: start, text: doc });
			}
		}
	}

	inserts.sort((a, b) => a.pos - b.pos);
	return { inserts, covered };
}

function applyInserts(text, inserts) {
	let out = '', last = 0;
	for (const ins of inserts) {
		out += text.slice(last, ins.pos) + ins.text;
		last = ins.pos;
	}
	out += text.slice(last);

	// patched offset -> original offset
	const toOriginal = pos => {
		let shift = 0;
		for (const ins of inserts) {
			const patchedStart = ins.pos + shift;
			if (pos >= patchedStart + ins.text.length) shift += ins.text.length;
			else if (pos >= patchedStart)              return ins.pos; // inside injected text
			else break;
		}
		return pos - shift;
	};
	return { patched: out, toOriginal };
}

// ------------------------------------------------------------
// 3. the check itself
// ------------------------------------------------------------

// Returns null when there is nothing to check (unsupported extension, missing
// file, `// @ts-nocheck`, no handler taking a ctx), otherwise
//   { covered: [[start, end]],
//     issues:  [{ start, length, code, message, senderPath?, notCallable?, hint? }] }
// with all offsets relative to the ORIGINAL file contents.
// Throws on unexpected failures — the caller downgrades that to a warning.
export function typecheckEntry(entryPath, typesFile) {
	const ext  = path.extname(entryPath).toLowerCase();
	const isTs = TS_EXT.has(ext);
	if (!isTs && !JS_EXT.has(ext)) return null;
	if (!fs.existsSync(entryPath)) return null;

	const text = fs.readFileSync(entryPath, 'utf8');
	if (/^\s*\/\/\s*@ts-nocheck\b/m.test(text)) return null; // author opted out

	const kind     = isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS;
	const original = ts.createSourceFile(entryPath, text, ts.ScriptTarget.Latest, true, kind);

	const { inserts, covered } = planEdits(original, findEntryFunctions(original), isTs);
	if (!covered.length) return null;

	const { patched, toOriginal } = applyInserts(text, inserts);

	const entryNorm = norm(entryPath);
	const typesNorm = norm(typesFile);

	const options = {
		allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ['lib.esnext.d.ts'], types: [],
		strict: false, noImplicitAny: false,
	};

	const host = ts.createCompilerHost(options, true);
	const readSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (fileName, languageVersionOrOptions, ...rest) =>
		norm(fileName) === entryNorm
			? ts.createSourceFile(fileName, patched, languageVersionOrOptions, true, kind)
			: readSourceFile(fileName, languageVersionOrOptions, ...rest);

	host.resolveModuleNameLiterals = (literals, containingFile, redirected, opts) =>
		literals.map(lit => {
			const name = lit.text;
			if (TYPES_MODULE.test(name)) {
				return { resolvedModule: {
					resolvedFileName: typesFile.replace(/\\/g, '/'),
					extension: ts.Extension.Dts,
					isExternalLibraryImport: false,
				} };
			}
			if (name.startsWith('.')) return ts.resolveModuleName(name, containingFile, opts, host, undefined, redirected);
			return { resolvedModule: undefined }; // bare packages stay `any`
		});

	const program = ts.createProgram({ rootNames: [entryPath], options, host });
	const sf      = program.getSourceFile(entryPath);
	if (!sf) throw new Error('entry file was not loaded by the TypeScript program');
	const checker = program.getTypeChecker();

	// -- "is this about the ManyBot API?" helpers ------------------------------

	const declaredInTypes = decls => !!decls?.some(d => norm(d.getSourceFile().fileName) === typesNorm);

	const typeFromTypes = type => {
		if (!type) return false;
		if (type.isUnion()) return type.types.some(typeFromTypes);
		return declaredInTypes(type.aliasSymbol?.declarations) || declaredInTypes(type.getSymbol()?.declarations);
	};

	const innermost = (start, end) => {
		let best = null;
		(function walk(n) {
			if (n.getStart(sf) <= start && n.getEnd() >= end) {
				best = n;
				ts.forEachChild(n, walk);
			}
		})(sf);
		return best;
	};

	// the call this diagnostic is about: `node` is either its callee or one of its arguments
	const callFor = node => {
		for (let n = node; n?.parent; n = n.parent) {
			const p = n.parent;
			if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && (p.expression === n || p.arguments?.includes(n))) return p;
		}
		return null;
	};

	const callDeclaredInTypes = call => {
		const sig = checker.getResolvedSignature(call);
		if (sig?.declaration && declaredInTypes([sig.declaration])) return true;
		const target = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
		return declaredInTypes(checker.getSymbolAtLocation(target)?.declarations);
	};

	// Returns null to drop the diagnostic, or an object with extra info to keep it.
	const classify = (d, node) => {
		const p = node.parent;

		if (PROPERTY_CODES.has(d.code)) {
			if (p && ts.isPropertyAccessExpression(p) && p.name === node)
				return typeFromTypes(checker.getTypeAtLocation(p.expression)) ? {} : null;
			// const { unknownKey } = ctx  /  ({ unknownKey }) => ...
			if (p && ts.isBindingElement(p) && ts.isObjectBindingPattern(p.parent)) {
				const holder = p.parent.parent;
				const source = ts.isVariableDeclaration(holder) ? holder.initializer
				             : ts.isParameter(holder)           ? holder
				             : null;
				return source && typeFromTypes(checker.getTypeAtLocation(source)) ? {} : null;
			}
			return null;
		}

		if (d.code === NOT_CALLABLE) {
			let callee = node;
			if (ts.isIdentifier(callee) && ts.isPropertyAccessExpression(callee.parent) && callee.parent.name === callee)
				callee = callee.parent;
			if (!callee.parent || !ts.isCallExpression(callee.parent) || callee.parent.expression !== callee) return null;
			const type = checker.getTypeAtLocation(callee);
			if (!typeFromTypes(type)) return null;
			const calleeText = callee.getText(sf);
			// sender objects (ctx.send, msg.reply, a sent-message handle's .reply, ...)
			// get the friendlier "call a method on it" message
			if (checker.getPropertyOfType(type, 'text')) return { senderPath: calleeText };

			// Any other object used as a function. tsc would print the whole inline
			// type here (huge for API objects), so hand back just the callee — plus,
			// when the object has a callable member named like the variable
			// (`const t = ctx.i18n.createT(...)` -> `{ t, lang }`), a "did you mean".
			const last = calleeText.split('.').pop();
			const member = checker.getPropertyOfType(type, last);
			const callable = member && checker.getTypeOfSymbolAtLocation(member, callee).getCallSignatures().length > 0;
			return { notCallable: calleeText, ...(callable ? { hint: last } : {}) };
		}

		if (CALL_CODES.has(d.code)) {
			// `ctx.config.get('x')` is typed `unknown` — passing it on isn't the plugin's fault
			if (d.code === 2345 && checker.getTypeAtLocation(node).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
			const call = callFor(node);
			return call && callDeclaredInTypes(call) ? {} : null;
		}

		return null;
	};

	// -- collect ---------------------------------------------------------------

	const issues = [];
	for (const d of program.getSemanticDiagnostics(sf)) {
		if (d.start == null) continue;
		if (!PROPERTY_CODES.has(d.code) && !CALL_CODES.has(d.code) && d.code !== NOT_CALLABLE) continue;

		const node = innermost(d.start, d.start + (d.length ?? 0));
		const extra = node && classify(d, node);
		if (!extra) continue;

		const start = toOriginal(d.start);
		const end   = toOriginal(d.start + (d.length ?? 1));
		issues.push({
			start,
			length:  Math.max(1, end - start),
			code:    d.code,
			message: clip(ts.flattenDiagnosticMessageText(d.messageText, ' ').replace(/\s+/g, ' ').trim()),
			...extra,
		});
	}

	issues.sort((a, b) => a.start - b.start);
	return { covered, issues };
}

