import fs from 'fs-extra';
import path from 'path';
import { PLUGINS_DIR } from './paths.js';
import { readEnabledPlugins, writePlugins } from './config.js';
import { loadLocalRegistry } from './registry-ops.js';
import { log } from './logger.js';
import { t } from './i18n.js';

// ------------------------------------------------------------
// canonical plugin id
// ------------------------------------------------------------

const getId = (manifest, dir) =>
  (manifest.key || manifest.name || dir).toLowerCase();

// fields tracked only in registry.json (install-time metadata) — never
// written into the plugin's own manyplug.json on disk, so discovery has
// to merge them back in from the registry cache to make them visible
const ENRICHMENT_FIELDS = ['local', 'linked', 'profile'];

function withEnrichment(manifest, registry) {
  if (!registry?.plugins) return manifest;

  const wantKey = (manifest.key || manifest.name || '').toLowerCase();
  if (!wantKey) return manifest;

  const cached = registry.plugins[manifest.key] || registry.plugins[manifest.name] ||
    Object.entries(registry.plugins).find(([k]) => k.toLowerCase() === wantKey)?.[1];
  if (!cached) return manifest;

  const extra = {};
  for (const f of ENRICHMENT_FIELDS) if (cached[f] !== undefined) extra[f] = cached[f];
  return Object.keys(extra).length ? { ...manifest, ...extra } : manifest;
}

// ------------------------------------------------------------
// enabled plugins list — thin re-exports over config.js, kept
// here so the rest of the codebase doesn't need to know that
// PLUGINS lives in the same file as user preferences
// ------------------------------------------------------------

export function readEnabled() {
  return readEnabledPlugins();
}

export async function writeEnabled(plugins) {
  await writePlugins(plugins);
}

// ------------------------------------------------------------
// discovery
// ------------------------------------------------------------

async function isDirEntry(entry, fullPath) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return (await fs.stat(fullPath)).isDirectory();
  } catch {
    return false; // broken symlink
  }
}

async function findManifests(dir, enabled, registry, depth = 0, maxDepth = 2) {
  const results = [];
  if (!await fs.pathExists(dir)) return results;

  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const sub = path.join(dir, entry.name);
    if (!await isDirEntry(entry, sub)) continue;

    const mp = path.join(sub, 'manyplug.json');

    if (await fs.pathExists(mp)) {
      let manifest = {};
      let error = false;

      try {
        manifest = await fs.readJson(mp);
      } catch {
        error = true;
        manifest = {
          name: entry.name,
          version: '?',
          category: '?'
        };
      }

      manifest = withEnrichment(manifest, registry);

      const id = getId(manifest, entry.name);
      const hasEntry = await fs.pathExists(
        path.join(sub, manifest.main || 'index.js')
      );

      const isEnabled = enabled.has(id);

      results.push({
        id,
        dir: sub,
        manifest,
        hasEntry,
        isEnabled,
        error
      });

    } else if (depth < maxDepth) {
      results.push(
        ...await findManifests(sub, enabled, registry, depth + 1, maxDepth)
      );
    }
  }

  return results;
}

export async function discoverPlugins() {
  const enabled  = readEnabled();
  const registry = await loadLocalRegistry();
  return findManifests(PLUGINS_DIR, enabled, registry);
}

// ------------------------------------------------------------
// resolve plugin
// ------------------------------------------------------------

export async function resolveProfile(name) {
  const all = await discoverPlugins();
  const key = name.toLowerCase();

  const taggedWith = (profileKey) =>
    all.filter(p => (p.manifest.profile || '').toLowerCase() === profileKey.toLowerCase());

  // exact profile key match
  const exact = taggedWith(name);
  if (exact.length) return { key: name, members: exact };

  // short-name fallback: match the part after '/' among profile keys in use
  const profileKeys = [...new Set(all.map(p => p.manifest.profile).filter(Boolean))];
  const short = profileKeys.filter(pk => pk.split('/').pop().toLowerCase() === key);

  if (short.length === 1) return { key: short[0], members: taggedWith(short[0]) };
  if (short.length > 1) return { ambiguous: short };

  return null;
}

export async function resolvePlugin(name) {
  const all  = await discoverPlugins();
  const key  = name.toLowerCase();

  // exact match first (author/name or bare name)
  const exact = all.filter(p => p.id === key);
  if (exact.length === 1) return exact[0];

  // short-name fallback: match the part after '/'
  const short = all.filter(p => p.id.split('/').pop() === key);

  if (short.length === 1) return short[0];

  if (short.length > 1) {
    log.error(t('common.ambiguous', { name }));
    for (const m of short) console.error(`  ${m.id}`);
    process.exit(1);
  }

  return null;
}
