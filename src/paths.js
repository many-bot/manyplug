import path from 'path';
import os from 'os';

export const PLUGINS_DIR = path.join(os.homedir(), '.manybot', 'plugins');
export const CONF_PATH   = path.join(os.homedir(), '.manybot', 'manyplug.conf');
export const REGISTRY_PATH = path.join(os.homedir(), '.manybot', 'registry.json');
