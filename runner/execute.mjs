const { spawn } = await import('node:child_process');
const { mkdtemp, mkdir, chown, readdir, lstat } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { createHash } = await import('node:crypto');

const runProcess = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let timedOut = false;
  const append = chunk => {
    output = (output + chunk.toString()).slice(-100_000);
    options.onOutput?.(chunk.toString());
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timeout = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs ?? 60_000);
  child.once('error', error => { clearTimeout(timeout); reject(error); });
  child.once('close', code => {
    clearTimeout(timeout);
    kill();
    resolve({ exitCode: timedOut ? 124 : code ?? 1, output });
  });
});

const ownTree = async path => {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return;
  await chown(path, 1000, 1000);
  if (stat.isDirectory()) for (const entry of await readdir(path)) await ownTree(join(path, entry));
};

const execute = async ({ recipe, commit, tree, archive, onOutput = () => {} }) => {
  const root = await mkdtemp(join(tmpdir(), 'relay-'));
  const source = join(root, 'source');
  await mkdir(source);
  const checked = async (command, args, cwd = root) => {
    const result = await runProcess(command, args, { cwd, env: { PATH: process.env.PATH, HOME: root, GIT_TERMINAL_PROMPT: '0' } });
    if (result.exitCode !== 0) throw new Error(`${command} failed: ${result.output.slice(-2000)}`);
    return result.output.trim();
  };
  if (archive) {
    await checked('tar', ['-xf', archive, '-C', source]);
  } else {
    const repo = join(root, 'repo');
    await checked('git', ['init', '-q', repo]);
    await checked('git', ['-c', 'protocol.file.allow=never', 'fetch', '--depth=1', `https://github.com/${recipe.repository}.git`, commit], repo);
    const actualCommit = await checked('git', ['rev-parse', 'FETCH_HEAD'], repo);
    const actualTree = await checked('git', ['rev-parse', 'FETCH_HEAD^{tree}'], repo);
    if (actualCommit !== commit || actualTree !== tree) throw new Error('Fetched source does not match the requested commit and tree');
    const entries = await checked('git', ['ls-tree', '-r', 'FETCH_HEAD'], repo);
    if (entries.split('\n').some(line => line.startsWith('160000 '))) throw new Error('Submodules are not supported');
    await checked('git', ['archive', '--format=tar', `--output=${join(root, 'source.tar')}`, 'FETCH_HEAD'], repo);
    await checked('tar', ['-xf', join(root, 'source.tar'), '-C', source]);
  }
  await ownTree(root);
  const startedAt = new Date().toISOString();
  const result = await runProcess(recipe.command[0], recipe.command.slice(1), {
    cwd: source,
    uid: 1000,
    gid: 1000,
    env: { PATH: process.env.PATH, HOME: source, ...recipe.environment },
    timeoutMs: recipe.timeoutSeconds * 1_000,
    onOutput,
  });
  return { ...result, tree, startedAt, finishedAt: new Date().toISOString(), logDigest: createHash('sha256').update(result.output).digest('hex') };
};
