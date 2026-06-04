import { exec } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'node:os';
import { formatSize } from './ui.js';

// ------------------------------------------------------------

export function run(cmd, cwd) {
	return new Promise((res, rej) =>
		exec(cmd, { cwd }, (err, stdout, stderr) => {
			if (err) { err.stderr = stderr; return rej(err); }
			res(stdout);
		})
	);
}

export async function getDirSize(dir) {
	let total = 0;
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		total += entry.isDirectory() ? await getDirSize(p) : (await fs.stat(p)).size;
	}
	return total;
}

// sparse-clones a single plugin dir from a git repo into pluginsDir
export async function installPluginFromRepo({ plugin, repo }, pluginsDir) {
	const tmp     = path.join(os.tmpdir(), `manyplug-${Date.now()}`);
	const repoDir = path.join(tmp, 'repo');
	await fs.mkdir(tmp, { recursive: true });

	try {
		process.stdout.write(`  cloning ${repo}... `);
		await run(`git clone --filter=blob:none --no-checkout ${repo} ${repoDir}`);
		await run(`git sparse-checkout init --cone`, repoDir);
		await run(`git sparse-checkout set ${plugin}`, repoDir);
		await run(`git checkout`, repoDir);
		console.log('ok');

		const src  = path.join(repoDir, plugin);
		const dest = path.join(pluginsDir, plugin);

		if (!await fs.pathExists(src))
			throw new Error(`plugin "${plugin}" not found in repo`);

		const size = await getDirSize(src);
		process.stdout.write(`  copying ${formatSize(size)}... `);
		await fs.mkdir(pluginsDir, { recursive: true });
		await fs.cp(src, dest, { recursive: true });
		console.log('ok');

		return { finalPath: dest, size };
	} finally {
		await fs.rm(tmp, { recursive: true, force: true });
	}
}

export async function installNpmDeps(deps, pluginDir) {
	const list = Object.entries(deps)
		.map(([n, v]) => `${n}@${v === '*' ? 'latest' : v}`)
		.join(' ');
	if (!list) return;
	process.stdout.write(`  npm install ${list}... `);
	try {
		await run(`npm install ${list}`, pluginDir);
		console.log('ok');
	} catch (e) {
		console.warn(`warn: npm install failed: ${e.message}`);
	}
}
