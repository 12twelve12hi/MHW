// CI helper for the test job (DESIGN.md 12.4): did the server change since its last deploy? A push deploys only then.
//
//   node scripts/changes.mjs        -> server=true|false in $GITHUB_OUTPUT
//
// "Since its last deploy" is the commit of the newest run of this workflow on the branch whose deploy step ran, not the
// push's parent: GitHub keeps one pending run per concurrency group and cancels the older one, so comparing with the
// parent would lose the cancelled run's change. "The server" is everything under reader-experiment/server/ but
// Markdown, this workflow, and the share/js files the Worker bundles (found from src/index.ts's imports); other
// share/js changes are tested, not deployed. Not a push, or any doubt (no deploy found, an API error): true.
// Environment: GITHUB_EVENT_NAME, GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_REF_NAME, GITHUB_API_URL, GH_TOKEN (needs
// actions: read), GITHUB_OUTPUT. Prints only file names and commits, which are public.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = 'rx-server.yml';
const DEPLOY_JOB = 'Deploy to Cloudflare';
const DEPLOY_STEP = 'Deploy the Worker with its secrets';

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
  let base = null;
  try {
    const { workflow_runs: runs = [] } = await gh(`/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=30`);
    for (const run of runs) {
      const { jobs = [] } = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=50`);
      const deployed = jobs.some((j) => String(j?.name ?? '').startsWith(DEPLOY_JOB)
        && (j.steps ?? []).some((st) => st?.name === DEPLOY_STEP && st?.conclusion === 'success'));
      if (deployed) { base = run.head_sha; break; }
    }
  } catch (e) {
    return { changed: true, base: null, reason: `couldn't read the earlier runs (${e.message})` };
  }
  if (!base) return { changed: true, base: null, reason: 'no earlier deploy found' };
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
