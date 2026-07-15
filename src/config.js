import fs from 'fs-extra';
import { existsSync, readFileSync } from 'fs';
import { parse as parseToml } from 'smol-toml';
import { CONF_PATH, TOML_PLUGIN_FILE } from './paths.js';

// ------------------------------------------------------------
// defaults
// ------------------------------------------------------------

export const DEFAULT_REGISTRY = 'https://manybot.stxerr.dev/manyplug/mpindex.json';

const DEFAULTS = {
  LANGUAGE: 'auto',
  REGISTRY: DEFAULT_REGISTRY,
  CONFIRM:  true,
  PLUGINS:  [],
};

/**
 * Detects the OS locale to pick the bootstrap file's comment language.
 * Mirrors the detection in i18n.js — duplicated here to avoid a circular
 * import, since i18n.js reads config via getPreference().
 */
function detectSystemLang() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale.split('-')[0].toLowerCase();
  } catch {
    // Intl unavailable — fall through to env vars
  }

  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
  if (envLocale) return envLocale.split(/[_.]/)[0].toLowerCase();

  return 'en';
}

const DEFAULT_TOML_EN = `\
# ManyPlug configuration — https://manybot.stxerr.dev/manyplug/docs/config

# Interface language. "auto" detects it from your system locale.
# LANGUAGE = "auto"

# Registry used by "manyplug install <name>".
# REGISTRY = "${DEFAULT_REGISTRY}"

# Ask for confirmation before destructive actions (remove, update).
# CONFIRM = true

# ManyBot plugins enabled on startup — managed by "manyplug enable/disable".
PLUGINS = []
`;

const DEFAULT_TOML_PT = `\
# Configuração do ManyPlug — https://manybot.stxerr.dev/manyplug/docs/config

# Idioma da interface. "auto" detecta pelo idioma do seu sistema.
# LANGUAGE = "auto"

# Registro usado por "manyplug install <nome>".
# REGISTRY = "${DEFAULT_REGISTRY}"

# Pedir confirmação antes de ações destrutivas (remove, update).
# CONFIRM = true

# Plugins do ManyBot ativados na inicialização — gerenciado por "manyplug enable/disable".
PLUGINS = []
`;

const DEFAULT_TOML = detectSystemLang() === 'pt' ? DEFAULT_TOML_PT : DEFAULT_TOML_EN;

// ------------------------------------------------------------
// legacy .conf migration (manyplug.conf → manyplug.toml)
// ------------------------------------------------------------

function parseLegacyConf() {
  if (!existsSync(CONF_PATH)) return null;
  const match = readFileSync(CONF_PATH, 'utf-8')
    .match(/PLUGINS=\[\s*([\s\S]*?)\s*\]/);
  if (!match) return null;
  return match[1]
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function migrateLegacyConf() {
  const legacy = parseLegacyConf();
  if (!legacy) return null;

  writePlugins(legacy);
  try {
    fs.removeSync(CONF_PATH);
  } catch {
    // non-fatal — the .toml migration already succeeded
  }
  return legacy;
}

// ------------------------------------------------------------
// read
// ------------------------------------------------------------

let cache = null;

function readRawToml() {
  if (!existsSync(TOML_PLUGIN_FILE)) return null;
  try {
    return readFileSync(TOML_PLUGIN_FILE, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Loads and merges the config file with defaults. Creates the file with
 * commented-out defaults on first run. Cached — pass `force` to re-read
 * after an external write.
 */
export function loadConfig(force = false) {
  if (cache && !force) return cache;

  const raw = readRawToml();

  if (raw !== null) {
    try {
      const parsed = parseToml(raw);
      cache = {
        ...DEFAULTS,
        ...parsed,
        PLUGINS: Array.isArray(parsed.PLUGINS)
          ? parsed.PLUGINS.map(p => String(p).toLowerCase()).filter(Boolean)
          : DEFAULTS.PLUGINS,
      };
      return cache;
    } catch {
      // malformed toml — fall through to legacy migration / fresh defaults
    }
  }

  const legacy = migrateLegacyConf();
  if (legacy) {
    cache = { ...DEFAULTS, PLUGINS: legacy };
    return cache;
  }

  // first run — nothing to migrate, seed a fresh file
  fs.ensureFileSync(TOML_PLUGIN_FILE);
  fs.writeFileSync(TOML_PLUGIN_FILE, DEFAULT_TOML, 'utf-8');
  cache = { ...DEFAULTS };
  return cache;
}

export function getPreference(key, fallback) {
  const value = loadConfig()[key];
  return value === undefined ? fallback : value;
}

export function readEnabledPlugins() {
  return new Set(loadConfig().PLUGINS);
}

// ------------------------------------------------------------
// write — patches a single key, preserving comments/other keys
// ------------------------------------------------------------

function patchKey(key, tomlValueLiteral) {
  const raw  = readRawToml() ?? DEFAULT_TOML;
  const line = `${key} = ${tomlValueLiteral}`;
  const re   = new RegExp(`^${key}\\s*=.*$`, 'm');
  const next = re.test(raw) ? raw.replace(re, line) : `${raw.trimEnd()}\n${line}\n`;

  fs.ensureFileSync(TOML_PLUGIN_FILE);
  fs.writeFileSync(TOML_PLUGIN_FILE, next, 'utf-8');
  cache = null;
}

export async function writePlugins(list) {
  const items = list.map(p => `"${p}"`).join(', ');
  patchKey('PLUGINS', `[${items}]`);
}

export function setPreference(key, value) {
  const literal = typeof value === 'string' ? JSON.stringify(value) : String(value);
  patchKey(key, literal);
}
