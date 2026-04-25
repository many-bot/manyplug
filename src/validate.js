import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';
import { logger, createSpinner, createTable, ICONS, THEME, formatDuration, createBox } from './ui.js';
import chalk from 'chalk';

// ============================================================
// UTILS
// ============================================================
function checkCommandExists(command) {
	try {
		const isWindows = process.platform === 'win32';
		const checkCmd = isWindows ? `where ${command}` : `command -v ${command}`;
		execSync(checkCmd, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

// ============================================================
// VALIDATION SCHEMA
// ============================================================
const VALID_CATEGORIES = ['games', 'media', 'utility', 'service', 'admin', 'fun'];

const REQUIRED_FIELDS = ['name', 'version', 'category'];
const OPTIONAL_FIELDS = ['service', 'local', 'description', 'author', 'license', 'main', 'dependencies', 'externalDependencies'];
const VALID_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

// ============================================================
// VALIDATION RULES
// ============================================================
const rules = {
	name: {
		validate: (value) => {
			if (typeof value !== 'string') return 'Must be a string';
			if (!value) return 'Required';
			if (!/^[a-z0-9-]+$/.test(value)) {
				return 'Must contain only lowercase letters, numbers, and hyphens';
			}
			if (value.length < 2) return 'Must be at least 2 characters';
			if (value.length > 50) return 'Must be at most 50 characters';
			return null;
		}
	},
	version: {
		validate: (value) => {
			if (typeof value !== 'string') return 'Must be a string';
			if (!value) return 'Required';
			if (!/^\d+\.\d+\.\d+/.test(value)) {
				return 'Must follow semantic versioning (e.g., 1.0.0)';
			}
			return null;
		}
	},
	category: {
		validate: (value) => {
			if (typeof value !== 'string') return 'Must be a string';
			if (!VALID_CATEGORIES.includes(value)) {
				return `Must be one of: ${VALID_CATEGORIES.join(', ')}`;
			}
			return null;
		}
	},
	service: {
		validate: (value) => {
			if (value !== undefined && typeof value !== 'boolean') {
				return 'Must be a boolean';
			}
			return null;
		}
	},
	local: {
		validate: (value) => {
			if (value !== undefined && typeof value !== 'boolean') {
				return 'Must be a boolean';
			}
			return null;
		}
	},
	dependencies: {
		validate: (value) => {
			if (value !== undefined && typeof value !== 'object') {
				return 'Must be an object';
			}
			return null;
		}
	},
	main: {
		validate: (value) => {
			if (value !== undefined && typeof value !== 'string') {
				return 'Must be a string';
			}
			return null;
		}
	},
	externalDependencies: {
		validate: (value) => {
			if (value === undefined) return null;
			if (typeof value !== 'object') {
				return 'Must be an object';
			}
			for (const [name, config] of Object.entries(value)) {
				if (typeof config === 'string') continue;
				if (typeof config === 'object') {
					if (config.command && typeof config.command !== 'string') {
						return `externalDependencies.${name}.command must be a string`;
					}
					if (config.optional !== undefined && typeof config.optional !== 'boolean') {
						return `externalDependencies.${name}.optional must be a boolean`;
					}
				} else {
					return `externalDependencies.${name} must be a string or object`;
				}
			}
			return null;
		}
	}
};

// ============================================================
// VALIDATE COMMAND
// ============================================================
export async function validateCommand(pluginPath = '.') {
	const startTime = Date.now();
	const absPath = path.resolve(pluginPath);

	const spinner = createSpinner('Validating plugin...');
	spinner.start();

	// Check if path exists
	if (!await fs.pathExists(absPath)) {
		spinner.fail(`Path not found: ${pluginPath}`);
		process.exit(1);
	}

	// Find manyplug.json
	const manifestPath = path.join(absPath, 'manyplug.json');
	if (!await fs.pathExists(manifestPath)) {
		spinner.fail(`No manyplug.json found in ${pluginPath}`);
		logger.tip('Run "manyplug init <name>" to create a valid plugin structure');
		process.exit(1);
	}

	// Load manifest
	let manifest;
	try {
		manifest = await fs.readJson(manifestPath);
	} catch (err) {
		spinner.fail(`Failed to parse manyplug.json: ${err.message}`);
		process.exit(1);
	}

	// Run validations
	const errors = [];
	const warnings = [];

	// Check required fields
	for (const field of REQUIRED_FIELDS) {
		if (!(field in manifest)) {
			errors.push({ field, message: `Missing required field` });
		}
	}

	// Validate all fields
	for (const [field, value] of Object.entries(manifest)) {
		if (!VALID_FIELDS.includes(field)) {
			warnings.push({ field, message: `Unknown field` });
			continue;
		}

		if (rules[field]) {
			const error = rules[field].validate(value);
			if (error) {
				errors.push({ field, message: error });
			}
		}
	}

	// Validate entry point exists
	const mainFile = manifest.main || 'index.js';
	const mainPath = path.join(absPath, mainFile);
	if (!await fs.pathExists(mainPath)) {
		warnings.push({ field: 'main', message: `Entry point not found: ${mainFile}` });
	}

	// Check locale directory (optional but recommended)
	const localePath = path.join(absPath, 'locale');
	if (!await fs.pathExists(localePath)) {
		warnings.push({ field: 'locale', message: 'No locale directory (i18n recommended)' });
	}

	// Check external dependencies
	if (manifest.externalDependencies) {
		for (const [name, config] of Object.entries(manifest.externalDependencies)) {
			const command = typeof config === 'string' ? config : config.command;
			const isOptional = typeof config === 'object' && config.optional === true;

			const exists = checkCommandExists(command);
			if (!exists) {
				const msg = `"${name}" not found (command: ${command})`;
				if (isOptional) {
					warnings.push({ field: `externalDeps.${name}`, message: `${msg} [optional]` });
				} else {
					errors.push({ field: `externalDeps.${name}`, message: msg });
				}
			}
		}
	}

	spinner.stop();

	// Output results
	const duration = Date.now() - startTime;
	const pluginName = manifest.name || 'unknown';

	logger.header('Validation Report');

	// Plugin info box
	const infoLines = [
		`${ICONS.package} ${chalk.bold.white(pluginName)} ${manifest.version ? chalk.green(manifest.version) : ''}`,
		`${chalk.gray('Path:')} ${chalk.cyan(absPath)}`,
	];
	if (manifest.description) {
		infoLines.push(`${chalk.gray('Desc:')} ${manifest.description}`);
	}
	console.log(createBox(infoLines.join('\n'), { width: 60 }));

	// Results table
	if (errors.length > 0 || warnings.length > 0) {
		logger.newline();

		if (errors.length > 0) {
			console.log(chalk.red.bold('  ✗ Errors:'));
			const errorTable = createTable(
				errors.map(e => ({ field: e.field, message: e.message })),
				[
					{ key: 'field', header: 'Field', minWidth: 20, format: v => chalk.white(v) },
					{ key: 'message', header: 'Issue', minWidth: 30, format: v => chalk.red(v) }
				],
				{ compact: true }
			);
			console.log(errorTable.toString());
		}

		if (warnings.length > 0) {
			if (errors.length > 0) logger.newline();
			console.log(chalk.yellow.bold('  ⚠ Warnings:'));
			const warnTable = createTable(
				warnings.map(w => ({ field: w.field, message: w.message })),
				[
					{ key: 'field', header: 'Field', minWidth: 20, format: v => chalk.white(v) },
					{ key: 'message', header: 'Issue', minWidth: 30, format: v => chalk.yellow(v) }
				],
				{ compact: true }
			);
			console.log(warnTable.toString());
		}
	} else {
		logger.newline();
		console.log(`  ${ICONS.success} ${chalk.green.bold('All validations passed!')}`);
	}

	logger.separator();

	// Summary
	const status = errors.length === 0 ? 'valid' : 'invalid';
	const statusColor = errors.length === 0 ? chalk.green : chalk.red;
	console.log(`  ${chalk.gray('Status:')} ${statusColor.bold(status.toUpperCase())}`);
	console.log(`  ${chalk.gray('Errors:')} ${errors.length > 0 ? chalk.red(errors.length) : chalk.gray(0)}`);
	console.log(`  ${chalk.gray('Warnings:')} ${warnings.length > 0 ? chalk.yellow(warnings.length) : chalk.gray(0)}`);
	console.log(`  ${chalk.gray('Time:')} ${formatDuration(duration)}`);

	if (errors.length > 0) {
		process.exit(1);
	}
}
