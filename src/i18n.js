import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPreference } from './config.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, 'locales');
const DEFAULT_LANG = 'en';

const cache = new Map();

function loadLocale(lang) {
  if (cache.has(lang)) return cache.get(lang);

  const file = path.join(LOCALES_DIR, `${lang}.json`);
  let data = null;
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch {
    data = null;
  }
  cache.set(lang, data);
  return data;
}

/**
 * Detects the user's system locale without depending on any single env
 * var, since LANG isn't reliably set on macOS GUI sessions or Windows.
 */
function detectSystemLang() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale; // e.g. "pt-BR"
    if (locale) return locale.split('-')[0].toLowerCase();
  } catch {
    // Intl unavailable — fall through to env vars
  }

  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
  if (envLocale) return envLocale.split(/[_.]/)[0].toLowerCase();

  return DEFAULT_LANG;
}

function resolveLang() {
  const envOverride = process.env.MANYPLUG_LANG?.trim().toLowerCase();
  const configured   = envOverride || String(getPreference('LANGUAGE', 'auto')).trim().toLowerCase();
  const isAuto = !envOverride && (!configured || configured === 'auto');
  const lang = isAuto ? detectSystemLang() : configured;

  if (loadLocale(lang)) return lang;

  // Only warn when the user explicitly configured an unsupported language —
  // silently falling back for an auto-detected system locale (e.g. "de")
  // is expected and shouldn't print a warning on every single command.
  if (!isAuto) {
    console.warn(`[i18n] Language "${lang}" not found, falling back to "${DEFAULT_LANG}"`);
  }
  return DEFAULT_LANG;
}

function getNestedValue(obj, key) {
  let current = obj;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function interpolate(str, context = {}) {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    context[key] !== undefined ? String(context[key]) : match
  );
}

const currentLang          = resolveLang();
const currentTranslations  = loadLocale(currentLang) || {};
const fallbackTranslations = loadLocale(DEFAULT_LANG) || {};

/**
 * Main translation function.
 * @param {string} key - dot path, e.g. "install.done"
 * @param {object} [context] - values to interpolate {{key}}
 */
export function t(key, context = {}) {
  let value = getNestedValue(currentTranslations, key);
  if (value === undefined) value = getNestedValue(fallbackTranslations, key);
  if (value === undefined) return key;
  if (typeof value !== 'string') return String(value);
  return interpolate(value, context);
}

export function getCurrentLang() {
  return currentLang;
}

export function listAvailableLangs() {
  try {
    return fs.readdirSync(LOCALES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5))
      .sort();
  } catch {
    return [DEFAULT_LANG];
  }
}
