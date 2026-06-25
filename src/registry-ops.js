import fs from 'fs-extra';
import { REGISTRY_PATH } from './paths.js';

const MPINDEX_URL = 'https://manybot.stxerr.dev/manyplug/mpindex.json';

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

async function fetchVersion(manifestUrl) {
	try {
		const res = await fetch(manifestUrl);
		if (!res.ok) return null;
		const m = await res.json();
		return m?.version ?? null;
	} catch {
		return null;
	}
}

export async function fetchRemoteRegistry() {
	let res;
	try {
		res = await fetch(MPINDEX_URL);
	} catch (e) {
		throw new Error(`network error: ${e.message}`);
	}
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching mpindex`);
	const index = await res.json();
	if (!index?.plugins) throw new Error('invalid mpindex: missing plugins field');

	// fetch all manifest versions in parallel
	const entries = Object.entries(index.plugins);
	const versions = await Promise.all(
		entries.map(([, entry]) => entry.manifest ? fetchVersion(entry.manifest) : null)
	);
	for (let i = 0; i < entries.length; i++) {
		if (versions[i] != null) entries[i][1].version = versions[i];
	}

	return index;
}
