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

// onMirror(mirror, 'ok'|'fail', errMsg?) — optional progress callback
export async function fetchRemoteRegistry(onMirror = () => {}) {
	for (const mirror of MIRRORS) {
		try {
			const res = await fetch(`${mirror.fetch}/registry.json`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			onMirror(mirror, 'ok');
			return { remoteRegistry: await res.json(), selectedMirror: mirror };
		} catch (e) {
			onMirror(mirror, 'fail', e.message);
		}
	}
	throw new Error('all mirrors failed');
}
