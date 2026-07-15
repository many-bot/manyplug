import chalk from 'chalk';

// ------------------------------------------------------------
// leveled output — one consistent style everywhere, color is
// automatically disabled by chalk when stdout isn't a TTY
// ------------------------------------------------------------

export const log = {
  info:    (msg) => console.log(`${chalk.cyan.bold('info')}  ${msg}`),
  warn:    (msg) => console.warn(`${chalk.yellow.bold('warn')}  ${msg}`),
  error:   (msg) => console.error(`${chalk.red.bold('error')} ${msg}`),
  success: (msg) => console.log(`${chalk.green.bold('ok')}    ${msg}`),

  // plain line, no label — for tabular/structured output
  plain: (msg = '') => console.log(msg),

  // dim, indented sub-step of the operation above it (e.g. "installing npm deps...")
  step: (msg) => console.log(chalk.dim(`  ${msg}`)),

  // per-item status markers, used when looping over a batch (install/remove/enable/disable)
  added:   (msg) => console.log(`${chalk.green('+')} ${msg}`),
  removed: (msg) => console.log(`${chalk.red('-')} ${msg}`),
  changed: (msg) => console.log(`${chalk.yellow('~')} ${msg}`),
  skipped: (msg) => console.log(`${chalk.dim('·')} ${msg}`),
  itemFail: (msg) => console.error(`${chalk.red('x')} ${msg}`),

  title: (msg) => console.log(chalk.bold(msg)),
};
