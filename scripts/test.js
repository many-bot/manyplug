import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'path';
import os from 'node:os';

const BIN = path.resolve('./bin/manyplug.js');

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'manyplug-test-'));
}

function run(home, ...args) {
  return execSync(`HOME=${home} node ${BIN} ${args.join(' ')} 2>&1`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// runs a command and returns output regardless of exit code
function runSafe(home, ...args) {
  try {
    return run(home, ...args);
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

function isolated(name, fn) {
  test(name, async () => {
    const home = makeHome();
    try {
      await fn(
        (...args) => run(home, ...args),
        (...args) => runSafe(home, ...args),
        home,
      );
    } finally {
      fs.removeSync(home);
    }
  });
}

function pluginDir(home, ...parts) {
  return path.join(home, '.manybot', 'plugins', ...parts);
}

function fakePlugin(dir, manifest) {
  fs.ensureDirSync(dir);
  fs.writeJsonSync(path.join(dir, 'manyplug.json'), manifest);
  fs.writeFileSync(path.join(dir, 'index.js'), '');
}

// ------------------------------------------------------------
// install
// ------------------------------------------------------------

isolated('install plugin', (mp) => {
  const out = mp('install synt-xerror/figurinha');
  assert.ok(out.includes('1/1 installed'), `unexpected output:\n${out}`);
});

isolated('install unknown plugin', (mp, mpf) => {
  const out = mpf('install nao-existe');
  assert.ok(out.includes('not found'), `unexpected output:\n${out}`);
});

isolated('install --local', (mp, mpf, home) => {
  const dir = path.join(home, 'meu-plugin');
  fakePlugin(dir, { name: 'meu-plugin', key: 'eu/meu-plugin', version: '1.0.0', category: 'utility' });
  const out = mp(`install --local ${dir}`);
  assert.ok(out.includes('installed meu-plugin'), `unexpected output:\n${out}`);
});

isolated('install conflict same name different author', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  const dir = path.join(home, 'figurinha-fake');
  fakePlugin(dir, { name: 'figurinha', key: 'joaozinho/figurinha', version: '1.0.0', category: 'media' });
  const out = mpf(`install --local ${dir}`);
  assert.ok(
    out.includes('conflict') || out.includes('already installed'),
    `expected conflict, got:\n${out}`
  );
});

// ------------------------------------------------------------
// remove
// ------------------------------------------------------------

isolated('remove by key', (mp) => {
  mp('install synt-xerror/figurinha');
  const out = mp('remove -y synt-xerror/figurinha');
  assert.ok(out.includes('freed='), `unexpected output:\n${out}`);
});

isolated('remove plugin not installed', (mp, mpf) => {
  const out = mpf('remove nao-existe');
  assert.ok(out.includes('not installed'), `unexpected output:\n${out}`);
});

isolated('remove ambiguous name', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  fakePlugin(pluginDir(home, 'joaozinho', 'figurinha'), {
    name: 'figurinha', key: 'joaozinho/figurinha', version: '1.0.0', category: 'media'
  });
  const out = mpf('remove figurinha');
  assert.ok(out.includes('ambiguous'), `expected ambiguous error, got:\n${out}`);
});

isolated('remove multiple plugins', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  mp('install synt-xerror/counting');
  const out = mp('remove -y synt-xerror/figurinha synt-xerror/counting');
  assert.ok(out.includes('2/2 removed'), `unexpected output:\n${out}`);
});

isolated('remove multiple — one missing', (mp, mpf, home) => {
  mp('install synt-xerror/counting');
  const out = mpf('remove -y synt-xerror/counting nao-existe');
  assert.ok(out.includes('not installed'), `unexpected output:\n${out}`);
  assert.ok(out.includes('freed='),        `unexpected output:\n${out}`);
});

isolated('remove multiple plugins interactive', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  mp('install synt-xerror/counting');
  const out = execSync(
    `HOME=${home} node ${BIN} remove synt-xerror/figurinha synt-xerror/counting`,
    { encoding: 'utf-8', input: 'y\ny\n' }  // ← stdin injetado direto
  );
  assert.ok(out.includes('2/2 removed'), `unexpected output:\n${out}`);
});

isolated('remove multiple — skip first confirm second', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  mp('install synt-xerror/counting');
  let out;
  try {
    out = execSync(
      `HOME=${home} node ${BIN} remove synt-xerror/figurinha synt-xerror/counting`,
      { encoding: 'utf-8', input: '\ny\n' }
    );
  } catch (e) {
    out = e.stdout ?? '';
  }
  assert.ok(out.includes('skipped'), `unexpected output:\n${out}`);
  assert.ok(out.includes('freed='),  `unexpected output:\n${out}`);
});
// ------------------------------------------------------------
// enable / disable
// ------------------------------------------------------------

isolated('enable plugin saves key to conf', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  const out = mp('enable synt-xerror/figurinha');
  assert.ok(out.includes('+ synt-xerror/figurinha'), `unexpected output:\n${out}`);
  const conf = fs.readFileSync(path.join(home, '.manybot', 'manyplug.conf'), 'utf-8');
  assert.ok(conf.includes('synt-xerror/figurinha'), 'key not found in conf');
});

isolated('disable plugin removes key from conf', (mp, mpf, home) => {
  mp('install synt-xerror/figurinha');
  mp('enable synt-xerror/figurinha');
  const out = mp('disable synt-xerror/figurinha');
  assert.ok(out.includes('- synt-xerror/figurinha'), `unexpected output:\n${out}`);
  const conf = fs.readFileSync(path.join(home, '.manybot', 'manyplug.conf'), 'utf-8');
  assert.ok(!conf.includes('synt-xerror/figurinha'), 'key still in conf after disable');
});

// ------------------------------------------------------------
// list
// ------------------------------------------------------------

isolated('list shows key', (mp) => {
  mp('install synt-xerror/figurinha');
  const out = mp('list -a');
  assert.ok(out.includes('synt-xerror/figurinha'), `unexpected output:\n${out}`);
});

isolated('list shows enabled status', (mp) => {
  mp('install synt-xerror/figurinha');
  mp('enable synt-xerror/figurinha');
  const out = mp('list');
  assert.ok(out.includes('synt-xerror/figurinha'), `unexpected output:\n${out}`);
  assert.ok(out.includes('enabled'), `unexpected output:\n${out}`);
});

isolated('list --all shows disabled', (mp) => {
  mp('install synt-xerror/figurinha');
  const out = mp('list -a');
  assert.ok(out.includes('disabled'), `unexpected output:\n${out}`);
});

// ------------------------------------------------------------
// update
// ------------------------------------------------------------

isolated('update skips plugin without key', (mp, mpf, home) => {
  fakePlugin(pluginDir(home, 'semkey'), {
    name: 'semkey', version: '1.0.0', category: 'utility'
  });
  const out = mpf('update --yes');
  assert.ok(out.includes('semkey'), `expected semkey in output, got:\n${out}`);
  assert.ok(out.includes('skipping') || out.includes('nothing to update'), `unexpected output:\n${out}`);
});

// ------------------------------------------------------------
// validate
// ------------------------------------------------------------

isolated('validate missing required fields', (mp, mpf, home) => {
  const dir = path.join(home, 'bad-plugin');
  fs.ensureDirSync(dir);
  fs.writeJsonSync(path.join(dir, 'manyplug.json'), { name: 'bad-plugin' });
  const out = mpf(`validate ${dir}`);
  assert.ok(out.includes('errors=2'), `unexpected output:\n${out}`);
});

isolated('validate unknown field shows warning', (mp, mpf, home) => {
  const dir = path.join(home, 'warn-plugin');
  fs.ensureDirSync(dir);
  fs.writeJsonSync(path.join(dir, 'manyplug.json'), {
    name: 'warn-plugin', version: '1.0.0', category: 'utility',
    unknownField: 'oops'
  });
  const out = mpf(`validate ${dir}`);
  assert.ok(out.includes('unknown field'), `unexpected output:\n${out}`);
  assert.ok(out.includes('errors=0'), `unexpected output:\n${out}`);
});

isolated('validate missing external dep is error', (mp, mpf, home) => {
  const dir = path.join(home, 'ext-plugin');
  fs.ensureDirSync(dir);
  fs.writeJsonSync(path.join(dir, 'manyplug.json'), {
    name: 'ext-plugin', version: '1.0.0', category: 'utility',
    externalDependencies: { fake: { command: 'programa-que-nao-existe', optional: false } }
  });
  const out = mpf(`validate ${dir}`);
  assert.ok(out.includes('errors=1'), `unexpected output:\n${out}`);
});

// ------------------------------------------------------------
// init
// ------------------------------------------------------------

isolated('init creates valid structure', (mp, mpf, home) => {
  execSync(`printf "meuhandle\n" | HOME=${home} node ${BIN} init meu-plugin --category utility`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: home,
  });
  const dir = path.join(home, 'meu-plugin');
  assert.ok(fs.existsSync(path.join(dir, 'manyplug.json')),      'missing manyplug.json');
  assert.ok(fs.existsSync(path.join(dir, 'index.js')),           'missing index.js');
  assert.ok(fs.existsSync(path.join(dir, 'locale', 'pt.json')), 'missing locale/pt.json');
  assert.ok(fs.existsSync(path.join(dir, 'locale', 'en.json')), 'missing locale/en.json');
  assert.ok(fs.existsSync(path.join(dir, 'README.md')),          'missing README.md');
});

isolated('init + validate passes', (mp, mpf, home) => {
  execSync(`printf "meuhandle\n" | HOME=${home} node ${BIN} init meu-plugin --category utility`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: home,
  });
  const dir = path.join(home, 'meu-plugin');
  const out = mpf(`validate ${dir}`);
  assert.ok(out.includes('errors=0'), `unexpected output:\n${out}`);
});

isolated('init + install --local', (mp, mpf, home) => {
  execSync(`printf "meuhandle\n" | HOME=${home} node ${BIN} init meu-plugin --category utility`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: home,
  });
  const dir = path.join(home, 'meu-plugin');
  const out = mp(`install --local ${dir}`);
  assert.ok(out.includes('installed meu-plugin'), `unexpected output:\n${out}`);
});
