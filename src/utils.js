import { exec } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'node:os';
import chalk from 'chalk';
import { formatSize } from './ui.js';
import { t } from './i18n.js';

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

// Installs whatever is declared in the plugin's own package.json. Plugin
// authors manage their npm deps there — manyplug.json's `dependencies` is
// reserved for other manybot plugins, not npm packages.
export async function installNpmDeps(pluginDir) {
	process.stdout.write(t('npm.installing'));
	try {
		await run('npm install', pluginDir);
		console.log(chalk.green('ok'));
	} catch (e) {
		console.warn(chalk.yellow(t('npm.installFailed', { message: e.message })));
	}
}

// ------------------------------------------------------------
// tarball: fetch + extract + install
// ------------------------------------------------------------

// Downloads a tarball from url into a tmp dir.
// Returns { tarball, tmp } — caller owns cleanup.
export async function fetchTarball(url) {
  const tmp     = path.join(os.tmpdir(), `manyplug-${Date.now()}`);
  const tarball = path.join(tmp, 'plugin.tar.gz');
  await fs.mkdir(tmp, { recursive: true });

  process.stdout.write(t('tarball.fetching', { url }));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b)
    throw new Error(t('tarball.notGzip'));

  await fs.writeFile(tarball, buf);
  console.log(chalk.green('ok'));

  return { tarball, tmp };
}

// Extracts a tarball into <tmp>/extracted, returns the path.
export async function extractTarball(tarball, tmp) {
	const extract = path.join(tmp, 'extracted');
	await fs.mkdir(extract, { recursive: true });
	await run(`tar -xzf ${tarball} -C ${extract} --strip-components=1`);
	return extract;
}

// Resolves which tarball URL to use given a repos map and branch.
// repos format: { codeberg: { master: url, dev: url }, ... }
// Returns the url string or throws with a clear error.
export function resolveRepoUrl(repos, branch) {
	const mirrors = Object.entries(repos);
	if (!mirrors.length) throw new Error(t('tarball.noReposDefined'));

	const branchesObj = mirrors[0][1];
  const defaultBranch = Object.keys(branchesObj)[0];
	const targetBranch  = branch ?? defaultBranch;

	// validate branch exists in at least one repo
	const anyHasBranch = mirrors.some(([, r]) => r[targetBranch]);
	if (!anyHasBranch)
		throw new Error(t('tarball.branchNotFound', { branch: targetBranch }));

	return { targetBranch, mirrors };
}

export function resolveTarballUrl(url, branch) {
  if (!url)    throw new Error("could not resolve tarball url: 'url' is not defined");
  if (!branch) throw new Error("could not resolve tarball url: 'branch' is not defined");

  const { hostname, pathname } = new URL(url);
  const [, user, repo] = pathname.split('/');

  if (hostname === 'github.com')
    return `https://github.com/${user}/${repo}/archive/refs/heads/${branch}.tar.gz`;

  if (hostname === 'gitlab.com')
    return `https://gitlab.com/${user}/${repo}/-/archive/${branch}/${repo}-${branch}.tar.gz`;

  if (hostname === 'codeberg.org')
    return `https://codeberg.org/${user}/${repo}/archive/${branch}.tar.gz`;

  // sourcehut: ~user/repo
  if (hostname === 'git.sr.ht')
    return `https://git.sr.ht/${user}/${repo}/archive/${branch}.tar.gz`;

  throw new Error(t('tarball.unsupportedHost', { host: hostname }));
}

// Downloads and installs a pluginpack from a repos map — the tarball's
// root contains multiple plugin subdirectories, each with its own
// manyplug.json, instead of a single plugin at the root.
// Returns { children: [{ manifest, finalPath, size }], size }.
export async function installPackFromTarball({ name, repos, branch }, pluginsDir) {
	const { targetBranch, mirrors } = resolveRepoUrl(repos, branch);

	let lastError;

	for (const [mirrorName, mirror] of mirrors) {
		const url = mirror[targetBranch];
		if (!url) continue;

		let tmp;
		try {
			({ tmp } = await fetchTarball(resolveTarballUrl(url, targetBranch)));
			const tarball = path.join(tmp, 'plugin.tar.gz');
			const extract = await extractTarball(tarball, tmp);

			const childDirs = [];
			for (const entry of await fs.readdir(extract, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				const childManifestPath = path.join(extract, entry.name, 'manyplug.json');
				if (await fs.pathExists(childManifestPath)) childDirs.push(path.join(extract, entry.name));
			}

			if (!childDirs.length) throw new Error(t('validate.packNoChildren'));

			const children = [];
			for (const childDir of childDirs) {
				const manifest = await fs.readJson(path.join(childDir, 'manyplug.json'));
				const key  = manifest.key || manifest.name;
				const dest = path.join(pluginsDir, key);
				const size = await getDirSize(childDir);
				await fs.mkdir(pluginsDir, { recursive: true });
				await fs.cp(childDir, dest, { recursive: true });
				children.push({ manifest, finalPath: dest, size });
			}

			console.log(chalk.green('ok'));
			return { children, size: children.reduce((a, c) => a + c.size, 0) };
		} catch (e) {
			lastError = e;
			console.log(`  ${chalk.red('x')} ${mirrorName}: ${e.message}`);
		} finally {
			if (tmp) await fs.rm(tmp, { recursive: true, force: true });
		}
	}

	throw new Error(t('tarball.allMirrorsFailed', { message: lastError?.message }));
}

// Downloads and installs a plugin from a repos map into pluginsDir/<n>.
// Tries each mirror in order, falls back on download failure.
// Returns { manifest, finalPath, size }.
export async function installPluginFromTarball({ name, repos, branch }, pluginsDir) {
	const { targetBranch, mirrors } = resolveRepoUrl(repos, branch);

	let lastError;

	for (const [mirrorName, mirror] of mirrors) {
		const url = mirror[targetBranch];
		if (!url) continue; // this mirror doesn't have the branch, skip silently

		let tmp;
		try {
			({ tmp } = await fetchTarball(resolveTarballUrl(url, targetBranch)));
			const tarball = path.join(tmp, 'plugin.tar.gz');
			const extract = await extractTarball(tarball, tmp);

			const manifestPath = path.join(extract, 'manyplug.json');
			if (!await fs.pathExists(manifestPath))
				throw new Error('manyplug.json not found in tarball');

			const manifest = await fs.readJson(manifestPath);
      const key      = manifest.key || manifest.name;
	    const dest     = path.join(pluginsDir, key);
		  const size     = await getDirSize(extract);

			process.stdout.write(t('tarball.copying', { size: formatSize(size) }));
			await fs.mkdir(pluginsDir, { recursive: true });
			await fs.cp(extract, dest, { recursive: true });
			console.log(chalk.green('ok'));

			return { manifest, finalPath: dest, size };
		} catch (e) {
			lastError = e;
			console.log(`  ${chalk.red('x')} ${mirrorName}: ${e.message}`);
		} finally {
			if (tmp) await fs.rm(tmp, { recursive: true, force: true });
		}
	}

	throw new Error(t('tarball.allMirrorsFailed', { message: lastError?.message }));
}
