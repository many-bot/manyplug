import path from 'path';
import os from 'os';

export let CONFIG_DIR       = path.join(os.homedir(), '.manybot');
export let PLUGINS_DIR      = path.join(CONFIG_DIR, 'plugins');
export let DATA_DIR         = path.join(CONFIG_DIR, 'data');
export let REGISTRY_PATH    = path.join(CONFIG_DIR, 'registry.json');

/** @deprecated Frozen. Use TOML_PLUGIN_FILE for new installs. */
export let CONF_PATH        = path.join(CONFIG_DIR, 'manyplug.conf');
export let TOML_PLUGIN_FILE = path.join(CONFIG_DIR, 'manyplug.toml');

export function setConfigDir(dir) {
	CONFIG_DIR       = path.resolve(dir);
	PLUGINS_DIR      = path.join(CONFIG_DIR, 'plugins');
	DATA_DIR         = path.join(CONFIG_DIR, 'data');
	REGISTRY_PATH    = path.join(CONFIG_DIR, 'registry.json');
	CONF_PATH        = path.join(CONFIG_DIR, 'manyplug.conf');
	TOML_PLUGIN_FILE = path.join(CONFIG_DIR, 'manyplug.toml');
}
