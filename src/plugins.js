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

export function readEnabled() {
  if (existsSync(TOML_PLUGIN_FILE)) {
    try {
      const raw = readFileSync(TOML_PLUGIN_FILE, 'utf-8');
      const parsed = parseToml(raw);
      const plugins = Array.isArray(parsed.PLUGINS) ? parsed.PLUGINS : [];
      return new Set(plugins.map(p => String(p).toLowerCase()).filter(Boolean));
    } catch {
      // fallback legacy
    }
  }

  if (!existsSync(CONF_PATH)) return new Set();

  const match = readFileSync(CONF_PATH, 'utf-8')
    .match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);

  if (!match) return new Set();

  return new Set(
    match[1]
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function writeEnabled(plugins) {
  if (existsSync(TOML_PLUGIN_FILE)) {
    const items = plugins.map(p => `"${p}"`).join(', ');
    const content =
`# ManyPlug plugin list — managed by manyplug

PLUGINS = [${items}]
`;
    await fs.writeFile(TOML_PLUGIN_FILE, content, 'utf-8');
  } else {
    await fs.writeFile(
      CONF_PATH,
`PLUGINS=[
${plugins.map(p => p + ',').join('\n')}
]
`,
      'utf-8'
    );
  }
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
  const all = await discoverPlugins();

  const matches = all.filter(p =>
    p.id === name.toLowerCase()
  );

  if (matches.length > 1) {
    console.error(`ambiguous: "${name}"`);
    for (const m of matches) {
      console.error(`  ${m.id}`);
    }
    process.exit(1);
  }

  return matches[0] ?? null;
}
