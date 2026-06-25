import fs from 'fs-extra';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse as parseToml } from 'smol-toml';
import { PLUGINS_DIR, CONF_PATH, TOML_PLUGIN_FILE } from './paths.js';

// ------------------------------------------------------------
// canonical plugin id
// ------------------------------------------------------------

const getId = (manifest, dir) =>
  (manifest.key || manifest.name || dir).toLowerCase();

// ------------------------------------------------------------
// conf helpers
// ------------------------------------------------------------

function parseConf() {
  if (!existsSync(CONF_PATH)) return null;
  const match = readFileSync(CONF_PATH, 'utf-8')
    .match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
  if (!match) return null;
  return match[1]
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function readEnabled() {
  if (existsSync(TOML_PLUGIN_FILE)) {
    try {
      const raw    = readFileSync(TOML_PLUGIN_FILE, 'utf-8');
      const parsed = parseToml(raw);
      const plugins = Array.isArray(parsed.PLUGINS) ? parsed.PLUGINS : [];
      return new Set(plugins.map(p => String(p).toLowerCase()).filter(Boolean));
    } catch {
      // fall through to conf migration
    }
  }

  // migrate .conf → .toml
  const legacy = parseConf();
  if (legacy) {
    console.warn('warn: migrating manyplug.conf → manyplug.toml');
    const items   = legacy.map(p => `"${p}"`).join(', ');
    const content = `# ManyPlug plugin list — managed by manyplug\n\nPLUGINS = [${items}]\n`;
    try {
      fs.writeFileSync(TOML_PLUGIN_FILE, content, 'utf-8');
      fs.removeSync(CONF_PATH);
      console.warn('warn: manyplug.conf removed');
    } catch (e) {
      console.warn(`warn: migration failed: ${e.message}`);
    }
    return new Set(legacy);
  }

  return new Set();
}

export async function writeEnabled(plugins) {
  const items   = plugins.map(p => `"${p}"`).join(', ');
  const content = `# ManyPlug plugin list — managed by manyplug\n\nPLUGINS = [${items}]\n`;
  await fs.writeFile(TOML_PLUGIN_FILE, content, 'utf-8');
}

// ------------------------------------------------------------
// discovery
// ------------------------------------------------------------

async function findManifests(dir, enabled, depth = 0, maxDepth = 2) {
  const results = [];
  if (!await fs.pathExists(dir)) return results;

  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const sub = path.join(dir, entry.name);
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
        ...await findManifests(sub, enabled, depth + 1, maxDepth)
      );
    }
  }

  return results;
}

export async function discoverPlugins() {
  const enabled = readEnabled();
  return findManifests(PLUGINS_DIR, enabled);
}

// ------------------------------------------------------------
// resolve plugin
// ------------------------------------------------------------

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
    console.error(`ambiguous: "${name}" matches multiple plugins — use full key:`);
    for (const m of short) console.error(`  ${m.id}`);
    process.exit(1);
  }

  return null;
}
