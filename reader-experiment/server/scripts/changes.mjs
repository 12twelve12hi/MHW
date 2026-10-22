// CI helper for the test job (DESIGN.md 12.4): did the server change since its last deploy? A push deploys only then.
//
//   node scripts/changes.mjs        -> server=true|false in $GITHUB_OUTPUT
//
// "Its last deploy" is the commit of the run of this workflow on the branch whose deploy step finished last, not the
// push's parent: GitHub keeps one pending run per concurrency group and cancels the older one, so comparing with the
// parent would lose the cancelled run's change. Nor the newest run that deployed: "Re-run all jobs" on an older run
// deploys that run's older commit, which is then what is live. A run is re-run within 30 days of its start, and its
// deploy step ends before the run's last update, so the search stops at runs that can't have deployed later. "The
// server" is everything under reader-experiment/server/ but Markdown, this workflow, and the share/js files the Worker
// bundles (found from src/index.ts's imports); other share/js changes are tested, not deployed. Not a push, or any
// doubt (no deploy found, a last deploy step that failed or was cancelled, an API error): true.
// Environment: GITHUB_EVENT_NAME, GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_REF_NAME, GITHUB_API_URL, GH_TOKEN (needs
// actions: read), GITHUB_OUTPUT. Prints only file names and commits, which are public.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = 'rx-server.yml';
const DEPLOY_JOB = 'Deploy to Cloudflare';
const DEPLOY_STEP = 'Deploy the Worker with its secrets';
const DAY = 86_400_000;
const RERUN_WINDOW = 31 * DAY;    // GitHub re-runs a run up to 30 days after it started; a day for the queue and the run
const PER_PAGE = 100;
const MAX_PAGES = 5;
const MAX_JOB_READS = 40;

/** The files under reader-experiment/share/ the Worker bundles: relative imports followed from src/index.ts. */
export function bundledShareFiles(root) {
  const repoRoot = path.resolve(root, '..', '..');
  const seen = new Set();
  const out = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      const rel = path.relative(repoRoot, target).split(path.sep).join('/');
      if (rel.startsWith('reader-experiment/share/')) out.add(rel);
      visit(target);
    }
  };
  visit(path.join(root, 'src', 'index.ts'));
  return [...out].sort();
}

/** -> {changed, base (the last deployed commit, when found), reason} */
export async function serverChanged({ event, sha, repo, branch, token, api = 'https://api.github.com', root, fetchFn = fetch }) {
  if (event !== 'push') return { changed: true, base: null, reason: `a ${event} run` };
  const gh = async (p) => {
    const r = await fetchFn(`${api}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (r.status !== 200) throw new Error(`GitHub API HTTP ${r.status}`);
    return r.json();
  };
  // The deploy step that finished last: {sha, at, ok, run}. Steps that ran (success, failure, cancelled) count: one that
  // failed or was cancelled may or may not have deployed its commit.
  let last = null;
  let reads = 0;
  try {
    let done = false;
    for (let page = 1; page <= MAX_PAGES && !done; page++) {
      const { workflow_runs: runs = [] } = await gh(`/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=${PER_PAGE}&page=${page}`);
      for (const run of runs) {
        // Newest created first: a run started over 31 days before that deploy can't have deployed after it, nor any below.
        if (last && Date.parse(run.created_at) + RERUN_WINDOW < last.at) { done = true; break; }
        // A run last updated before that deploy finished all its deploy steps earlier.
        if (last && Date.parse(run.updated_at) < last.at) continue;
        if (++reads > MAX_JOB_READS) return { changed: true, base: null, reason: `no answer within ${MAX_JOB_READS} runs` };
        const { jobs = [] } = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`);  // every attempt
        for (const j of jobs) {
          if (!String(j?.name ?? '').startsWith(DEPLOY_JOB)) continue;
          for (const st of j.steps ?? []) {
            if (st?.name !== DEPLOY_STEP || !['success', 'failure', 'cancelled'].includes(st?.conclusion)) continue;
            const at = Date.parse(st.completed_at);
            if (!Number.isFinite(at)) throw new Error(`run ${run.id}'s deploy step has no end time`);
            if (!last || at > last.at) last = { sha: run.head_sha, at, ok: st.conclusion === 'success', run: run.run_number ?? run.id };
          }
        }
      }
      if (runs.length < PER_PAGE) done = true;
    }
    if (!done) return { changed: true, base: null, reason: `no answer within ${MAX_PAGES * PER_PAGE} runs` };
  } catch (e) {
    return { changed: true, base: null, reason: `couldn't read the earlier runs (${e.message})` };
  }
  if (!last) return { changed: true, base: null, reason: 'no earlier deploy found' };
  if (!last.ok) return { changed: true, base: null, reason: `the last deploy (run ${last.run}) didn't finish, so what is live isn't known` };
  const base = last.sha;
  let files;
  try {
    const c = await gh(`/repos/${repo}/compare/${base}...${sha}`);
    const list = c.files ?? [];
    if (list.length >= 300) return { changed: true, base, reason: 'too many changed files to list' };
    files = list.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  } catch (e) {
    return { changed: true, base, reason: `couldn't compare with ${String(base).slice(0, 7)} (${e.message})` };
  }
  const share = new Set(bundledShareFiles(root));
  const hit = files.find((f) => (f.startsWith('reader-experiment/server/') && !f.endsWith('.md'))
    || f === `.github/workflows/${WORKFLOW}` || share.has(f));
  return hit
    ? { changed: true, base, reason: `${hit} changed since the last deploy (${String(base).slice(0, 7)})` }
    : { changed: false, base, reason: `nothing the Worker uses changed since the last deploy (${String(base).slice(0, 7)})` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const r = await serverChanged({
    event: env.GITHUB_EVENT_NAME, sha: env.GITHUB_SHA, repo: env.GITHUB_REPOSITORY, branch: env.GITHUB_REF_NAME,
    token: env.GH_TOKEN, api: env.GITHUB_API_URL || 'https://api.github.com', root,
  });
  console.log(`Server changed since its last deploy: ${r.changed ? 'yes' : 'no'} (${r.reason}).`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `server=${r.changed}\n`);
}
