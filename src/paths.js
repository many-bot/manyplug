import path from 'path';
import os from 'os';

export const PLUGINS_DIR      = path.join(os.homedir(), '.manybot', 'plugins');
export const DATA_DIR         = path.join(os.homedir(), '.manybot', 'data');
export const REGISTRY_PATH    = path.join(os.homedir(), '.manybot', 'registry.json');

/** @deprecated Frozen. Use TOML_PLUGIN_FILE for new installs. */
export const CONF_PATH        = path.join(os.homedir(), '.manybot', 'manyplug.conf');
export const TOML_PLUGIN_FILE = path.join(os.homedir(), '.manybot', 'manyplug.toml');
