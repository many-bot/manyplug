import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

import { REGISTRY_PATH } from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH   = path.join(__dirname, '..', 'config.json');

// ------------------------------------------------------------

function loadConfig() {
	try { return fs.readJsonSync(CONFIG_PATH); }
	catch (e) { console.error(`error: config.json: ${e.message}`); process.exit(1); }
}

export const MIRRORS = loadConfig().mirrors;

// ------------------------------------------------------------

export async function loadLocalRegistry() {
	try { return await fs.readJson(REGISTRY_PATH); }
	catch { return { lastUpdated: null, plugins: {} }; }
}

export async function saveRegistry(registry) {
	registry.lastUpdated = new Date().toISOString();
	await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });
}

// ------------------------------------------------------------

export async function fetchRemoteRegistry() {
	for (const mirror of MIRRORS) {
		try {
			const [regRes, idxRes] = await Promise.all([
				fetch(`${mirror.fetch}/registry.json`),
				fetch(`https://manybot.stxerr.dev/manyplug/mpindex.json`),
			]);
			if (!regRes.ok && !idxRes.ok)
				throw new Error(`HTTP ${regRes.status} / ${idxRes.status}`);
			const legacy = regRes.ok ? await regRes.json() : { plugins: {} };
			const fresh  = idxRes.ok ? await idxRes.json() : { plugins: {} };
			return {
				remoteRegistry: { plugins: { ...legacy.plugins, ...fresh.plugins } },
				selectedMirror: mirror,
			};
		} catch (e) {
			// mirror falhou, tenta o próximo
		}
	}
	throw new Error('all mirrors failed');
}
