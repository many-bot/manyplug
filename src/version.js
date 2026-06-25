import fs from 'fs-extra';
import path from 'path';

// ------------------------------------------------------------

async function loadManifest(cwd) {
	const mp = path.join(cwd, 'manyplug.json');
	if (!await fs.pathExists(mp))
		throw new Error('manyplug.json not found, make sure to run from a plugin directory');
	return { mp, manifest: await fs.readJson(mp) };
}

// ------------------------------------------------------------
// version command
// ------------------------------------------------------------

export async function versionCommand(input) {
	let mp, manifest;
	try { ({ mp, manifest } = await loadManifest(process.cwd())); }
	catch (e) { console.error(`error: ${e.message}`); process.exit(1); }

  const name = manifest.key || manifest.name || "unnamed"; 

	if (!input) {
		console.log(`${name} - ${manifest.version}` || '(no version set)');
		return;
	}

	const prev = manifest.version || '(none)';
	manifest.version = input;
	await fs.writeJson(mp, manifest, { spaces: 2 });
	console.log(`${name} - ${prev} >> ${input}`);
}
