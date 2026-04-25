import ora from 'ora';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

// ============================================================
// TERMINAL UTILS
// ============================================================
const TERMINAL_WIDTH = Math.min(process.stdout.columns || 80, 100);

// ============================================================
// MODERN ICONS (using ASCII + unicode for compatibility)
// ============================================================
const ICONS = {
	success: chalk.green('✓'),
	error: chalk.red('✗'),
	warning: chalk.yellow('⚠'),
	info: chalk.blue('ℹ'),
	arrow: chalk.cyan('→'),
	bullet: chalk.gray('•'),
	package: chalk.magenta('📦'),
	download: chalk.cyan('⬇'),
	install: chalk.green('⬆'),
	remove: chalk.red('🗑'),
	search: chalk.yellow('🔍'),
	config: chalk.cyan('⚙'),
	star: chalk.yellow('★'),
	dot: chalk.gray('●'),
	check: chalk.green('✓'),
	cross: chalk.red('✗'),
	clock: chalk.gray('◷'),
	disk: chalk.cyan('◉'),
	link: chalk.blue('↗'),
	folder: chalk.yellow('📁'),
	file: chalk.gray('📄'),
	sparkle: chalk.cyan('✨'),
	rocket: chalk.magenta('🚀'),
	gear: chalk.gray('⚙'),
	lock: chalk.yellow('🔒'),
	unlock: chalk.gray('🔓')
};

// ============================================================
// COLOR THEMES
// ============================================================
const THEME = {
	primary: chalk.cyan,
	secondary: chalk.blue,
	success: chalk.green,
	error: chalk.red,
	warning: chalk.yellow,
	info: chalk.blue,
	dim: chalk.gray,
	muted: chalk.hex('#6b7280'),
	accent: chalk.magenta,
	highlight: chalk.white.bold,
	border: chalk.hex('#374151'),
	header: chalk.bold.cyan,
	subheader: chalk.bold.white,
	label: chalk.gray,
	value: chalk.white
};

// ============================================================
// STYLES
// ============================================================
const STYLES = {
	header: (text) => THEME.header(`\n◆ ${text}`),
	subheader: (text) => THEME.subheader(text),
	success: (text) => `${ICONS.success} ${THEME.success(text)}`,
	error: (text) => `${ICONS.error} ${THEME.error(text)}`,
	warning: (text) => `${ICONS.warning} ${THEME.warning(text)}`,
	info: (text) => `${ICONS.info} ${THEME.info(text)}`,
	item: (label, value) => `  ${ICONS.bullet} ${THEME.label(label)}: ${THEME.primary(value)}`,
	section: (text) => THEME.subheader(`\n${text}`),
	url: (text) => chalk.underline.blue(text),
	dim: (text) => THEME.dim(text),
	version: (text) => THEME.success(text),
	name: (text) => THEME.highlight(text),
	size: (text) => THEME.accent(text),
	path: (text) => THEME.primary(text),
	muted: (text) => THEME.muted(text)
};

// ============================================================
// BOX DRAWING
// ============================================================
const BOX = {
	topLeft: '╭',
	topRight: '╮',
	bottomLeft: '╰',
	bottomRight: '╯',
	horizontal: '─',
	vertical: '│',
	leftT: '├',
	rightT: '┤',
	topT: '┬',
	bottomT: '┴',
	cross: '┼'
};

export function createBox(content, options = {}) {
	const { title, width = TERMINAL_WIDTH - 4, padding = 1 } = options;
	const lines = typeof content === 'string' ? [content] : content;
	const innerWidth = width - 2 - (padding * 2);

	const wrapText = (text, maxWidth) => {
		const words = text.split(' ');
		const result = [];
		let current = '';

		for (const word of words) {
			const stripped = word.replace(/\u001b\[\d+m/g, '');
			if ((current + stripped).length > maxWidth) {
				result.push(current.trim());
				current = word + ' ';
			} else {
				current += word + ' ';
			}
		}
		if (current) result.push(current.trim());
		return result;
	};

	const wrappedLines = lines.flatMap(line => wrapText(line, innerWidth));
	const paddedWidth = innerWidth + (padding * 2);

	let result = [];

	// Top border
	if (title) {
		const titleStr = ` ${title} `;
		const sideWidth = Math.floor((paddedWidth - titleStr.length) / 2);
		const left = BOX.horizontal.repeat(sideWidth);
		const right = BOX.horizontal.repeat(paddedWidth - sideWidth - titleStr.length);
		result.push(THEME.border(`${BOX.topLeft}${left}${THEME.highlight(titleStr)}${right}${BOX.topRight}`));
	} else {
		result.push(THEME.border(`${BOX.topLeft}${BOX.horizontal.repeat(paddedWidth)}${BOX.topRight}`));
	}

	// Content
	for (const line of wrappedLines) {
		const visibleLen = line.replace(/\u001b\[\d+m/g, '').length;
		const paddingStr = ' '.repeat(padding);
		const fill = ' '.repeat(Math.max(0, innerWidth - visibleLen));
		result.push(THEME.border(`${BOX.vertical}`) + paddingStr + line + fill + paddingStr + THEME.border(`${BOX.vertical}`));
	}

	// Bottom border
	result.push(THEME.border(`${BOX.bottomLeft}${BOX.horizontal.repeat(paddedWidth)}${BOX.bottomRight}`));

	return result.join('\n');
}

// ============================================================
// TABLE FORMATTER
// ============================================================
export function createTable(data, columns, options = {}) {
	const { spacing = 2, compact = false } = options;

	// Calculate column widths
	const colWidths = columns.map(col => {
		const headerLen = col.header ? col.header.length : 0;
    const maxDataLen = Math.max(...data.map(row => {
      const value = col.format ? col.format(row[col.key], row) : String(row[col.key] || '');
      return value.replace(/\u001b\[\d+m/g, '').length;
    }), 0);
    return Math.max(headerLen, maxDataLen, col.minWidth || 0);
	});

	// Build header
	const headerRow = columns.map((col, i) => {
		const header = col.header || '';
		return chalk.bold(header.padEnd(colWidths[i]));
	}).join(' '.repeat(spacing));

	const totalWidth = colWidths.reduce((a, b) => a + b, 0) + (spacing * (columns.length - 1));
	const separator = THEME.border(BOX.horizontal.repeat(totalWidth));

	// Build rows
	const rows = data.map(row => {
		return columns.map((col, i) => {
			const rawValue = row[col.key];
			let value = col.format ? col.format(rawValue, row) : String(rawValue || '');
			const visibleLen = value.replace(/\u001b\[\d+m/g, '').length;
			const padChar = col.align === 'right' ? ' ' : ' ';
			const padding = ' '.repeat(Math.max(0, colWidths[i] - visibleLen));
			if (col.align === 'right') {
				return padding + value;
			}
			return value + padding;
		}).join(' '.repeat(spacing));
	});

	return {
		header: compact ? '' : headerRow,
		separator,
		rows,
		toString: () => {
			const parts = [];
			if (!compact) {
				parts.push(headerRow, separator);
			}
			parts.push(...rows);
			return parts.join('\n');
		}
	};
}

// ============================================================
// MODERN SPINNER
// ============================================================
export function createSpinner(text, options = {}) {
	const spinner = ora({
		text: text ? THEME.value(text) : '',
		spinner: {
			frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
			interval: 80
		},
		color: 'cyan',
		...options
	});

	return {
		start: (newText) => {
			if (newText) spinner.text = THEME.value(newText);
			spinner.start();
			return this;
		},
		succeed: (text) => spinner.succeed(text ? THEME.success(text) : undefined),
		fail: (text) => spinner.fail(text ? THEME.error(text) : undefined),
		warn: (text) => spinner.warn(text ? THEME.warning(text) : undefined),
		info: (text) => spinner.info(text ? THEME.info(text) : undefined),
		stop: () => spinner.stop(),
		clear: () => spinner.clear(),
		setText: (text) => { spinner.text = THEME.value(text); },
		setPrefix: (prefix) => { spinner.prefixText = prefix; }
	};
}

// ============================================================
// PROGRESS BAR
// ============================================================
export function createProgressBar(options = {}) {
	const format = options.format ||
		`${THEME.primary('{bar}')} ${THEME.white('{percentage}%')} ${THEME.muted('|')} ${THEME.accent('{value}/{total}')} ${THEME.muted('{unit}')} ${THEME.muted('|')} ${THEME.primary('{filename}')}`;

	const bar = new cliProgress.SingleBar({
		format,
		barCompleteChar: '█',
		barIncompleteChar: '░',
		barGlue: THEME.muted('░'),
		hideCursor: true,
		clearOnComplete: false,
		...options
	});

	return {
		start: (total, filename = '') => bar.start(total, 0, { filename, unit: options.unit || 'MB' }),
		update: (current) => bar.update(current),
		increment: (amount = 1) => bar.increment(amount),
		stop: () => bar.stop(),
		setTotal: (total) => bar.setTotal(total),
		updateETA: (eta) => bar.update({ eta: `ETA: ${eta}` })
	};
}

// ============================================================
// MODERN CONFIRM PROMPT [Y/n]
// ============================================================
export function confirm(message, defaultValue = true) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultText = defaultValue
    ? THEME.success('Y') + THEME.muted('/n')
    : THEME.muted('y/') + THEME.error('N');

  const prompt = `${ICONS.arrow} ${THEME.value(message)} ${THEME.muted('[')}${defaultText}${THEME.muted(']')} `;

  const ask = () =>
    new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim().toLowerCase()));
    });

  return (async () => {
    while (true) {
      const answer = await ask();

      if (answer === '') {
        rl.close();
        return defaultValue;
      }

      if (['y', 'yes'].includes(answer)) {
        rl.close();
        return true;
      }

      if (['n', 'no'].includes(answer)) {
        rl.close();
        return false;
      }

      console.log(THEME.error('  Please answer y or n'));
    }
  })();
}
// ============================================================
// SELECT PROMPT WITH HIGHLIGHTING
// ============================================================
export async function select(message, choices, options = {}) {
	const { showIndex = true } = options;

	console.log(THEME.primary(`\n◆ ${message}`));
	console.log(THEME.border('  ' + BOX.horizontal.repeat(TERMINAL_WIDTH - 4)));

	choices.forEach((choice, index) => {
		const num = showIndex ? THEME.muted(`${index + 1}.`) : '';
		console.log(`  ${num} ${THEME.value(choice)}`);
	});

	const rl = readline.createInterface({
		input: stdin,
		output: stdout
	});

	return new Promise((resolve) => {
		process.stdout.write(THEME.muted('\n  Select: '));
		rl.question('', (answer) => {
			rl.close();
			const num = parseInt(answer, 10);
			if (num >= 1 && num <= choices.length) {
				resolve(num - 1);
			} else {
				console.log(THEME.error('  Invalid choice'));
				resolve(select(message, choices, options));
			}
		});
	});
}

// ============================================================
// MULTI-SELECT PROMPT
// ============================================================
export async function multiSelect(message, choices, options = {}) {
	const { min = 0, max = choices.length } = options;

	console.log(THEME.primary(`\n◆ ${message}`));
	console.log(THEME.muted(`  (Space to toggle, Enter to confirm)`));
	console.log(THEME.border('  ' + BOX.horizontal.repeat(TERMINAL_WIDTH - 4)));

	const selected = new Set();
	choices.forEach((choice, index) => {
		const marker = selected.has(index) ? THEME.success('[✓]') : THEME.muted('[ ]');
		console.log(`  ${marker} ${THEME.value(choice)}`);
	});

	return [...selected];
}

// ============================================================
// MODERN LOGGER
// ============================================================
export const logger = {
	// Basic levels
	success: (text) => console.log(`\n${ICONS.success} ${THEME.success(text)}`),
	error: (text) => console.log(`\n${ICONS.error} ${THEME.error(text)}`),
	warn: (text) => console.log(`\n${ICONS.warning} ${THEME.warning(text)}`),
	info: (text) => console.log(`\n${ICONS.info} ${THEME.info(text)}`),
	debug: (text) => console.log(THEME.dim(`[debug] ${text}`)),

	// Section headers (modern style)
	header: (text) => console.log(THEME.header(`\n◆ ${text}`)),
	section: (text) => console.log(THEME.subheader(`\n${text}`)),
	subheader: (text) => console.log(`  ${THEME.muted('▸')} ${THEME.value(text)}`),

	// Plugin-related
	installing: (name, version) => {
		console.log(`\n${ICONS.install} ${THEME.value('Installing')} ${THEME.highlight(name)} ${THEME.success(version)}`);
	},
	removing: (name) => {
		console.log(`\n${ICONS.remove} ${THEME.value('Removing')} ${THEME.highlight(name)}`);
	},
	installed: (name) => {
		console.log(`${ICONS.success} ${THEME.value('Successfully installed')} ${THEME.success.bold(name)}`);
	},
	removed: (name) => {
		console.log(`${ICONS.success} ${THEME.value('Successfully removed')} ${THEME.error.bold(name)}`);
	},

	// Package info with box
	plugin: (manifest) => {
		const lines = [`${ICONS.package} ${THEME.highlight(manifest.name)} ${THEME.success(manifest.version)}`];
		if (manifest.description) {
			lines.push(`  ${THEME.muted(manifest.description)}`);
		}
		if (manifest.category) {
			lines.push(`  ${THEME.label('Category:')} ${THEME.primary(manifest.category)}`);
		}
		if (manifest.author) {
			lines.push(`  ${THEME.label('Author:')} ${THEME.value(manifest.author)}`);
		}
		console.log('\n' + lines.join('\n'));
	},

	// Modern list with table
	listPlugins: (plugins, options = {}) => {
		const { showVersion = true, showCategory = true, showStatus = false } = options;

		if (plugins.length === 0) {
			console.log(THEME.muted('  (no plugins found)'));
			return;
		}

		const columns = [{ key: 'name', header: 'Name', minWidth: 20 }];
		if (showVersion) columns.push({ key: 'version', header: 'Version', minWidth: 10 });
		if (showCategory) columns.push({ key: 'category', header: 'Category', minWidth: 10 });
		if (showStatus) columns.push({ key: 'status', header: 'Status', minWidth: 10 });

		const tableData = plugins.map(p => ({
			name: THEME.highlight(p.name),
			version: THEME.success(p.version || '-'),
			category: THEME.primary(p.category || '-'),
			status: p.enabled !== false ? THEME.success('enabled') : THEME.muted('disabled')
		}));

		const table = createTable(tableData, columns, { compact: true });
		console.log('\n' + table.toString());
	},

	// Stats with box
	stats: (installed, total, size) => {
		console.log(THEME.border(`\n  ${BOX.horizontal.repeat(25)}`));
		console.log(`  ${THEME.label('Installed:')} ${THEME.success(installed)} / ${THEME.value(total)}`);
		if (size) {
			console.log(`  ${THEME.label('Disk usage:')} ${THEME.accent(size)}`);
		}
		console.log(THEME.border(`  ${BOX.horizontal.repeat(25)}`));
	},

	// Mirror status
	mirror: (name, status) => {
		const icon = status === 'ok' ? THEME.success('●') : THEME.error('●');
		const label = status === 'ok' ? THEME.success(name) : THEME.error(name);
		console.log(`  ${icon} ${label}`);
	},

	// Separator
	separator: () => console.log(THEME.border(`  ${BOX.horizontal.repeat(25)}`)),
	separatorFull: () => console.log(THEME.border(BOX.horizontal.repeat(TERMINAL_WIDTH))),

	// Newline
	newline: () => console.log(),

	// Tip/hint
	tip: (text) => console.log(`${ICONS.info} ${THEME.muted(text)}`),

	// Command example
	command: (cmd, desc) => {
		console.log(`  ${ICONS.arrow} ${THEME.primary(cmd)} ${THEME.muted(desc ? `(${desc})` : '')}`);
	}
};

// ============================================================
// FORMAT UTILS
// ============================================================
export function formatSize(bytes) {
	if (bytes === 0 || bytes === undefined) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = bytes;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDuration(ms) {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

export function formatNumber(num) {
	return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ============================================================
// ANIMATION UTILS
// ============================================================
export async function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Typewriter effect
export async function typewrite(text, delayMs = 20) {
	for (const char of text) {
		process.stdout.write(char);
		await delay(delayMs);
	}
}

// Slide-in animation
export async function slideIn(text, delayMs = 15) {
	const lines = text.split('\n');
	for (const line of lines) {
		for (let i = 1; i <= line.length; i++) {
			process.stdout.write('\r' + line.slice(0, i));
			await delay(delayMs);
		}
		console.log();
	}
}

// Fade in effect (using brightness)
export async function fadeIn(text) {
	const steps = [
		chalk.hex('#374151'),
		chalk.hex('#6b7280'),
		chalk.hex('#9ca3af'),
		chalk.hex('#d1d5db'),
		chalk.white
	];

	for (const color of steps) {
		process.stdout.write('\r' + color(text));
		await delay(50);
	}
	console.log();
}

// ============================================================
// STATUS INDICATORS
// ============================================================
export function statusBadge(status, text) {
	const badges = {
		success: { bg: chalk.bgGreen, fg: chalk.black, icon: '✓' },
		error: { bg: chalk.bgRed, fg: chalk.white, icon: '✗' },
		warning: { bg: chalk.bgYellow, fg: chalk.black, icon: '⚠' },
		info: { bg: chalk.bgBlue, fg: chalk.white, icon: 'ℹ' },
		pending: { bg: chalk.bgGray, fg: chalk.white, icon: '◷' }
	};

	const badge = badges[status] || badges.info;
	return badge.bg(badge.fg(` ${badge.icon} ${text} `));
}

// ============================================================
// TREE DISPLAY
// ============================================================
export function renderTree(items, options = {}) {
	const { indent = 0, prefix = '' } = options;
	const lines = [];

	items.forEach((item, index) => {
		const isLast = index === items.length - 1;
		const connector = isLast ? '└─ ' : '├─ ';
		const childPrefix = isLast ? '   ' : '│  ';

		if (typeof item === 'string') {
			lines.push(' '.repeat(indent) + prefix + connector + item);
		} else {
			lines.push(' '.repeat(indent) + prefix + connector + item.label);
			if (item.children) {
				lines.push(...renderTree(item.children, {
					indent: indent + 4,
					prefix: prefix + childPrefix
				}));
			}
		}
	});

	return lines;
}

// ============================================================
// EXPORT ALL UTILITIES
// ============================================================
export { ICONS, STYLES, THEME, BOX, TERMINAL_WIDTH };
