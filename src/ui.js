import ora from 'ora';
import chalk from 'chalk';
import readline from 'node:readline';

// ------------------------------------------------------------
// format utils  (used by install, remove, init, sync-update)
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
// spinner  (used by sync-update, install)
// ------------------------------------------------------------

export function createSpinner(text) {
	const sp = ora({
		text,
		spinner: { frames: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'], interval: 80 },
		color: 'cyan'
	});
	return {
		start:   (t)  => { if (t) sp.text = t; sp.start(); },
		succeed: (t)  => sp.succeed(t),
		fail:    (t)  => sp.fail(t),
		warn:    (t)  => sp.warn(t),
		stop:    ()   => sp.stop(),
		setText: (t)  => { sp.text = t; }
	};
}

// ------------------------------------------------------------
// confirm prompt  (used by sync-update, remove)
// ------------------------------------------------------------

export function confirm(message, defaultValue = true) {
	const hint = defaultValue ? '[Y/n]' : '[y/N]';
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = () => new Promise(res => rl.question(`${message} ${hint} `, res));

	return (async () => {
		while (true) {
			const a = (await ask()).trim().toLowerCase();
			if (a === '')               { rl.close(); return defaultValue; }
			if (['y','yes'].includes(a)) { rl.close(); return true; }
			if (['n','no'].includes(a))  { rl.close(); return false; }
			console.log('  please answer y or n');
		}
	})();
}

// ------------------------------------------------------------
// mirror status line  (used by registry-ops callback)
// ------------------------------------------------------------

export function mirrorLine(mirror, status, err) {
	const icon = status === 'ok' ? chalk.green('+') : chalk.red('x');
	console.log(`  ${icon} ${mirror.name}${err ? ': ' + err : ''}`);
}
