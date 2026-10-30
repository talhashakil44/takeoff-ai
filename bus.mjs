#!/usr/bin/env node
/**
 * The agents' bus: how Claude and GPT (Codex) talk, share the task graph and report the harness,
 * through the repo's `agents/bus` branch. It never touches your working tree or branch: it reads
 * the bus with `git show` and writes new commits to it with git's plumbing, so it is safe to run
 * in the middle of any work.
 *
 * <me> is claude, gpt or user, or one workstream of an agent (gpt-build, gpt-explore): each has its
 * own read cursor; a message to "gpt" reaches every gpt workstream.
 *
 *   node bus.mjs read  <me>                         unread messages to <me> (or to all), marked read
 *   node bus.mjs wait  <me> [--every 60] [--timeout 3600]
 *                                                    block until a message comes (exit 0) or time out (exit 2)
 *   node bus.mjs say   <me> <to> "<subject>" [--task T4] [--ref branch@sha] [--body file]   (body from stdin otherwise)
 *   node bus.mjs graph [<me>]                        the task graph; what is ready for <me>
 *   node bus.mjs set   <me> <task> key=value ...     update a task (status=doing|review|done|blocked, branch=, stream=, note=)
 *                                                    status=done needs a clean harness PASS of its accept gates posted for the task (or --force)
 *   node bus.mjs add   <me> < task.json              add a task: {id, owner, title, prompt, depends[], accept[]}
 *   node bus.mjs harness <me> [--gates tsc,test,build,audit] [--post <to>] [--task T4] [--timeout 1200]
 *                                                    run the gates on this checkout; post the result. PASS, FAIL,
 *                                                    or INCOMPLETE when a gate asked for was skipped (exit 0/1/3)
 *
 * Bootstrap (any checkout of the repo):
 *   git fetch -q origin agents/bus && git show origin/agents/bus:bus.mjs > /tmp/bus.mjs && node /tmp/bus.mjs read gpt
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const BRANCH = 'agents/bus';
const REMOTE_REF = `refs/remotes/origin/${BRANCH}`;
const AGENTS = ['claude', 'gpt', 'user'];
/** A consumer is an agent, or one workstream of it ("gpt-build", "gpt-explore"): each keeps its own read cursor. */
const agentOf = (me) => (me ?? '').split('-')[0];
const isConsumer = (me) => AGENTS.includes(agentOf(me)) && /^[a-z]+(-[a-z0-9]+)?$/.test(me ?? '');

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 << 20, ...opts }).trim();
const tryGit = (args, opts) => {
  try {
    return git(args, opts);
  } catch {
    return null;
  }
};
const die = (msg, code = 1) => {
  process.stderr.write(`bus: ${msg}\n`);
  process.exit(code);
};

const fetch = () => tryGit(['fetch', '-q', 'origin', `+refs/heads/${BRANCH}:${REMOTE_REF}`]);
const head = () => tryGit(['rev-parse', '-q', '--verify', REMOTE_REF]);
const show = (path) => tryGit(['show', `${REMOTE_REF}:${path}`]);
const list = (dir) => (tryGit(['ls-tree', '--name-only', `${REMOTE_REF}:${dir}`]) ?? '').split('\n').filter(Boolean);

/** Commits `change(files)` on top of the bus and pushes it, again on top of the latest if someone pushed first. */
function commit(me, message, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    fetch();
    const base = head();
    const files = change();
    const index = join(tmpdir(), `bus-index-${process.pid}-${attempt}`);
    const env = { ...process.env, GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: me, GIT_AUTHOR_EMAIL: `${me}@agents.local`, GIT_COMMITTER_NAME: me, GIT_COMMITTER_EMAIL: `${me}@agents.local` };
    try {
      if (base) git(['read-tree', base], { env });
      else git(['read-tree', '--empty'], { env });
      for (const [path, text] of Object.entries(files)) {
        const blob = git(['hash-object', '-w', '--stdin'], { input: text, env });
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
      }
      const tree = git(['write-tree'], { env });
      const c = git(['commit-tree', tree, ...(base ? ['-p', base] : []), '-m', message], { env });
      const pushed = spawnSync('git', ['push', '-q', 'origin', `${c}:refs/heads/${BRANCH}`], { encoding: 'utf8' });
      if (pushed.status === 0) {
        tryGit(['update-ref', REMOTE_REF, c]);
        return c;
      }
    } finally {
      rmSync(index, { force: true });
    }
  }
  die('could not push to the bus (someone else kept pushing, or no access)');
}

const seenFile = (me) => {
  const dir = join(git(['rev-parse', '--git-common-dir']), 'agents-bus');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${me}.seen`);
};
const seen = (me) => new Set(existsSync(seenFile(me)) ? readFileSync(seenFile(me), 'utf8').split('\n').filter(Boolean) : []);

/** A message's header fields (front matter) and body. */
function parse(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text ?? '');
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const k = line.indexOf(':');
    if (k > 0) meta[line.slice(0, k).trim()] = line.slice(k + 1).trim();
  }
  return { meta, body: m ? m[2] : text ?? '' };
}

function unread(me) {
  fetch();
  const done = seen(me);
  return list('channel')
    .filter((f) => !done.has(f))
    .map((f) => ({ f, ...parse(show(`channel/${f}`)) }))
    .filter((x) => x.meta.from !== me && (x.meta.to === me || x.meta.to === agentOf(me) || x.meta.to === 'all'));
}

function printMessages(msgs) {
  for (const x of msgs) {
    process.stdout.write(`\n=== ${x.meta.date} · ${x.meta.from} → ${x.meta.to} · ${x.meta.subject}${x.meta.task ? ` · task ${x.meta.task}` : ''}${x.meta.ref ? ` · ${x.meta.ref}` : ''}\n${x.body.trim()}\n`);
  }
}

function markRead(me, msgs) {
  if (!msgs.length) return;
  const all = seen(me);
  for (const x of msgs) all.add(x.f);
  writeFileSync(seenFile(me), [...all].join('\n') + '\n');
}

const flag = (args, name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note';

function say(me, to, subject, body, extra = {}) {
  if (!isConsumer(to) && to !== 'all') die(`to must be one of ${AGENTS.join(', ')} (or a workstream like gpt-build), all`);
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const name = `${date.replace(/:/g, '-')}-${me}-to-${to}-${slug(subject)}.md`;
  const head = [`from: ${me}`, `to: ${to}`, `date: ${date}`, `subject: ${subject.replace(/\n/g, ' ')}`, ...Object.entries(extra).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)];
  const text = `---\n${head.join('\n')}\n---\n${body.trim()}\n`;
  commit(me, `${me} → ${to}: ${subject}`, () => ({ [`channel/${name}`]: text }));
  // One's own message is read.
  const s = seen(me);
  s.add(name);
  writeFileSync(seenFile(me), [...s].join('\n') + '\n');
  process.stdout.write(`posted channel/${name}\n`);
}

const loadGraph = () => JSON.parse(show('graph.json') ?? '{"tasks":[]}');

function printGraph(me) {
  fetch();
  const g = loadGraph();
  const status = new Map(g.tasks.map((t) => [t.id, t.status]));
  const ready = (t) => (t.depends ?? []).every((d) => status.get(d) === 'done');
  const mark = { done: '✓', doing: '▶', review: '?', blocked: '✗', todo: '·' };
  for (const t of g.tasks) {
    const deps = (t.depends ?? []).length ? ` ← ${t.depends.join(', ')}` : '';
    const r = t.status === 'todo' && ready(t) ? '  [READY]' : '';
    process.stdout.write(`${mark[t.status] ?? '·'} ${t.id.padEnd(4)} ${(t.stream ?? t.owner).padEnd(11)} ${t.status.padEnd(7)} ${t.title}${deps}${t.branch ? `  (${t.branch})` : ''}${r}\n`);
  }
  if (me) {
    const mine = g.tasks.filter((t) => t.owner === agentOf(me) && (!t.stream || t.stream === me || me === agentOf(me)) && (t.status === 'doing' || (t.status === 'todo' && ready(t))));
    process.stdout.write(`\nFor ${me}: ${mine.length ? mine.map((t) => `${t.id} ${t.title}`).join('; ') : 'nothing ready'}\n`);
    for (const t of mine) if (t.prompt) process.stdout.write(`\n--- ${t.id} prompt ---\n${t.prompt}\n${(t.accept ?? []).length ? `Accept when: ${t.accept.join('; ')}\n` : ''}`);
  }
}

const GATES = {
  tsc: ['npx', ['tsc', '--noEmit', '-p', '.']],
  test: ['npx', ['vitest', 'run']],
  build: ['npx', ['vite', 'build']],
  audit: ['npx', ['vitest', 'run', '-c', 'bench/vitest.config.ts', 'bench/buildModel.test.ts']],
};

function harness(me, args) {
  const gates = flag(args, 'gates', 'tsc,test,build').split(',');
  const limit = Number(flag(args, 'timeout', '1200')) * 1000;
  const to = flag(args, 'post', null);
  const task = flag(args, 'task', null);
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = tryGit(['rev-parse', '--short', 'HEAD']);
  const dirty = (tryGit(['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;
  // The tree tested: HEAD plus a hash of every uncommitted change, at the start and the end.
  const tree = () => {
    const diff = spawnSync('git', ['diff', 'HEAD'], { encoding: 'utf8', maxBuffer: 256 << 20 }).stdout ?? '';
    const untracked = tryGit(['ls-files', '--others', '--exclude-standard']) ?? '';
    return `${tryGit(['rev-parse', 'HEAD'])}:${createHash('sha1').update(diff).update(untracked).digest('hex').slice(0, 12)}`;
  };
  const startTree = tree();
  const rows = [];
  for (const g of gates) {
    const spec = GATES[g];
    if (!spec) die(`no gate ${g} (${Object.keys(GATES).join(', ')})`);
    if (g === 'audit' && !process.env.BUILD_PROJECTS_ROOT) {
      rows.push({ g, ok: null, s: 0, tail: 'skipped: BUILD_PROJECTS_ROOT not set' });
      continue;
    }
    const t0 = Date.now();
    const r = spawnSync(spec[0], spec[1], { encoding: 'utf8', maxBuffer: 256 << 20, env: process.env, timeout: limit, killSignal: 'SIGKILL' });
    if (r.error || r.signal) r.stderr = `${r.stderr ?? ''}
${r.signal ? `killed after ${limit / 1000} s` : r.error.message}`;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const summary = out.split('\n').filter((l) => /Tests\s+\d|Test Files|error TS|FAIL|✓ built|passed|failed/.test(l)).slice(-6).join('\n');
    rows.push({ g, ok: r.status === 0, s: Math.round((Date.now() - t0) / 1000), tail: summary || out.trim().split('\n').slice(-4).join('\n') });
    process.stdout.write(`${r.status === 0 ? 'PASS' : 'FAIL'} ${g} (${rows.at(-1).s} s)\n`);
  }
  // A gate asked for and skipped is not a pass.
  const endTree = tree();
  if (endTree !== startTree) rows.push({ g: 'tree', ok: null, s: 0, tail: `the tree changed during the run (${startTree} → ${endTree}): rerun` });
  const failed = rows.some((r) => r.ok === false);
  const verdict = failed ? 'FAIL' : rows.some((r) => r.ok === null) ? 'INCOMPLETE' : 'PASS';
  const ok = verdict === 'PASS';
  const report = [`Harness on ${branch}@${sha}${dirty ? ` (+${dirty} uncommitted)` : ''}: ${verdict}`, '', ...rows.map((r) => `- ${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} ${r.g} (${r.s} s)\n${r.tail ? r.tail.split('\n').map((l) => `    ${l}`).join('\n') : ''}`)].join('\n');
  process.stdout.write(`\n${report}\n`);
  if (to) say(me, to, `harness ${verdict} ${branch}@${sha}`, report, { task, ref: `${branch}@${sha}`, kind: 'harness', verdict, gates: gates.join(','), dirty: String(dirty), tree: endTree });
  process.exit(ok ? 0 : verdict === 'INCOMPLETE' ? 3 : 1);
}

const [cmd, me, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') {
  process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]);
  process.exit(0);
}
if (cmd !== 'graph' && !isConsumer(me)) die(`who are you? (${AGENTS.join(', ')}, or a workstream like gpt-build)`);

switch (cmd) {
  case 'read': {
    const msgs = unread(me);
    if (!msgs.length) process.stdout.write('no new messages\n');
    printMessages(msgs);
    markRead(me, msgs);
    break;
  }
  case 'wait': {
    const every = Number(flag(rest, 'every', '60')) * 1000;
    const timeout = Number(flag(rest, 'timeout', '3600')) * 1000;
    const until = Date.now() + timeout;
    for (;;) {
      const msgs = unread(me);
      if (msgs.length) {
        printMessages(msgs);
        markRead(me, msgs);
        process.exit(0);
      }
      if (Date.now() + every > until) {
        process.stdout.write('timed out with no new messages\n');
        process.exit(2);
      }
      await new Promise((r) => setTimeout(r, every));
    }
  }
  case 'say': {
    const task = flag(rest, 'task', null);
    const ref = flag(rest, 'ref', null);
    const file = flag(rest, 'body', null);
    const [to, subject] = rest;
    if (!to || !subject) die('say <me> <to> "<subject>" [--task T] [--ref branch@sha] [--body file]');
    const body = file ? readFileSync(file, 'utf8') : readStdin();
    if (!body.trim()) die('the message has no body: pipe it in on stdin or pass --body <file>');
    say(me, to, subject, body, { task, ref });
    break;
  }
  case 'graph':
    printGraph(isConsumer(me) ? me : null);
    break;
  case 'set': {
    const force = rest.includes('--force');
    const [id, ...pairs] = rest.filter((a) => a !== '--force');
    if (!id || !pairs.length) die('set <me> <task> status=done branch=... note=... [--force]');
    if (pairs.includes('status=done') && !force) {
      // Done needs a clean PASS of the task's accept gates posted for it (bus harness --task <id> --post …).
      fetch();
      const t = loadGraph().tasks.find((x) => x.id === id);
      const need = (t?.accept ?? []).filter((g) => GATES[g]);
      const passes = list('channel')
        .map((f) => parse(show(`channel/${f}`)).meta)
        .filter((m) => m.kind === 'harness' && m.task === id && m.verdict === 'PASS' && m.dirty === '0' && need.every((g) => (m.gates ?? '').split(',').includes(g)));
      if (need.length && !passes.length) die(`${id}: no clean harness PASS posted for ${need.join(',')} (run harness ${me} --gates ${need.join(',')} --task ${id} --post <to>, or --force with a note why)`);
      if (passes.length) pairs.push(`evidence=${passes.at(-1).ref}`);
    }
    commit(me, `${me}: ${id} ${pairs.join(' ')}`, () => {
      const g = loadGraph();
      const t = g.tasks.find((x) => x.id === id);
      if (!t) die(`no task ${id}`);
      for (const p of pairs) {
        const k = p.indexOf('=');
        const key = p.slice(0, k);
        const value = p.slice(k + 1);
        if (key === 'note') t.notes = [...(t.notes ?? []), `${new Date().toISOString().slice(0, 16)} ${me}: ${value}`];
        else t[key] = value;
      }
      t.updated = new Date().toISOString();
      return { 'graph.json': JSON.stringify(g, null, 2) + '\n' };
    });
    process.stdout.write(`${id} updated\n`);
    break;
  }
  case 'add': {
    const task = JSON.parse(readStdin());
    if (!task.id || !task.owner || !task.title) die('a task needs id, owner and title');
    commit(me, `${me}: add ${task.id}`, () => {
      const g = loadGraph();
      if (g.tasks.some((x) => x.id === task.id)) die(`task ${task.id} exists`);
      g.tasks.push({ status: 'todo', depends: [], accept: [], ...task, added: new Date().toISOString(), by: me });
      return { 'graph.json': JSON.stringify(g, null, 2) + '\n' };
    });
    process.stdout.write(`${task.id} added\n`);
    break;
  }
  case 'harness':
    harness(me, rest);
    break;
  default:
    die(`unknown command ${cmd}`);
}
