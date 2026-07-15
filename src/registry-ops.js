import fs from 'fs-extra';
import { REGISTRY_PATH } from './paths.js';
import { getPreference, DEFAULT_REGISTRY } from './config.js';
import { t } from './i18n.js';

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

async function fetchManifestMeta(manifestUrl) {
	try {
		const res = await fetch(manifestUrl);
		if (!res.ok) return null;
		const m = await res.json();
		return { version: m?.version ?? null, description: m?.description ?? null, category: m?.category ?? null };
	} catch {
		return null;
	}
}

export async function fetchRemoteRegistry() {
	const url = getPreference('REGISTRY', DEFAULT_REGISTRY);

	let res;
	try {
		res = await fetch(url);
	} catch (e) {
		throw new Error(t('registry.networkError', { message: e.message }));
	}
	if (!res.ok) throw new Error(t('registry.httpError', { status: res.status }));
	const index = await res.json();
	if (!index?.plugins) throw new Error(t('registry.invalidIndex'));

	// fetch each plugin's manifest in parallel to fill in version/description/category
	const entries = Object.entries(index.plugins);
	const metas = await Promise.all(
		entries.map(([, entry]) => entry.manifest ? fetchManifestMeta(entry.manifest) : null)
	);
	for (let i = 0; i < entries.length; i++) {
		const meta = metas[i];
		if (!meta) continue;
		if (meta.version != null) entries[i][1].version = meta.version;
		if (meta.description != null && !entries[i][1].description) entries[i][1].description = meta.description;
		if (meta.category    != null && !entries[i][1].category)    entries[i][1].category    = meta.category;
	}

	return index;
}
