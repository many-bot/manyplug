// Single source of truth for plugin name/author/key rules, shared by
// init.js (scaffolding) and validate.js (checking) so they can't drift
// apart again.

export const VALID_CATEGORIES = [
	'integration', 'games', 'media', 'utility', 'admin', 'fun', 'moderation',
	'ai', 'education', 'social', 'economy', 'automation', 'tools',
];

export const NAME_MIN_LEN = 2;
export const NAME_MAX_LEN = 50;

const NAME_SRC   = '[a-z0-9-]+';
const AUTHOR_SRC = '[a-zA-Z0-9_-]+';

export const NAME_RE   = new RegExp(`^${NAME_SRC}$`);
export const AUTHOR_RE = new RegExp(`^${AUTHOR_SRC}$`);
export const KEY_RE    = new RegExp(`^${AUTHOR_SRC}/${NAME_SRC}$`);

export function nameError(v) {
	if (typeof v !== 'string' || !v) return 'required string';
	if (!NAME_RE.test(v))            return 'lowercase letters, numbers, hyphens only';
	if (v.length < NAME_MIN_LEN || v.length > NAME_MAX_LEN) return `length must be ${NAME_MIN_LEN}-${NAME_MAX_LEN}`;
	return null;
}
