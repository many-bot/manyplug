import { t } from './i18n.js';

// ------------------------------------------------------------
// format utils  (used by install, remove, init, list, info)
// ------------------------------------------------------------

export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${units[i]}`;
}

export function formatDuration(ms) {
  if (ms < 1000)  return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ------------------------------------------------------------
// prompts — a minimal hand-rolled line reader instead of node:readline.
//
// readline's .question()/async-iterator over piped (non-TTY) stdin can
// silently drop or hang on a line that arrives while nothing is actively
// waiting for it (e.g. during an `await` for a real I/O op between two
// prompts) — reproduced reliably in testing. Buffering raw 'data' chunks
// ourselves and queuing both lines and waiters avoids that class of bug
// entirely, for both piped and interactive (TTY) input.
// ------------------------------------------------------------

class LineReader {
  constructor(stream) {
    this.buf     = '';
    this.lines   = [];
    this.waiters = [];
    this.ended   = false;
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, idx).replace(/\r$/, '');
        this.buf = this.buf.slice(idx + 1);
        this._push(line);
      }
    });
    stream.on('end', () => {
      this.ended = true;
      if (this.buf) { this._push(this.buf); this.buf = ''; }
      while (this.waiters.length) this.waiters.shift()(null);
    });
  }

  _push(line) {
    if (this.waiters.length) this.waiters.shift()(line);
    else this.lines.push(line);
  }

  next() {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    if (this.ended)        return Promise.resolve(null);
    return new Promise(resolve => this.waiters.push(resolve));
  }
}

let reader = null;
function getReader() {
  if (!reader) reader = new LineReader(process.stdin);
  return reader;
}

/** Asks a free-text question, returns the trimmed answer ('' at EOF). */
export async function ask(question) {
  process.stdout.write(question);
  const line = await getReader().next();
  return line === null ? '' : line.trim();
}

/** Asks a y/n question, returns a boolean. */
export async function confirm(message, defaultValue = true) {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  while (true) {
    const answer = (await ask(`${message} ${hint} `)).toLowerCase();
    if (answer === '')                 return defaultValue;
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer))  return false;
    console.log(t('common.yesNoHint'));
  }
}
