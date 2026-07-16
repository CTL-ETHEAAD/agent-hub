import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const TEMPLATE_ROOT = path.resolve(import.meta.dirname, '..', 'templates');
const MAX_FILE_BYTES = 80 * 1024;

export async function runReview({ issue, reviewResultPath, model, command = 'claude' }) {
  const baseBranch = issue.baseBranch || 'master';
  const cwd = issue.worktreePath;

    const { stdout: nameList } = await execFileAsync(
      'git', ['diff', '--name-only', baseBranch],
      { cwd }
    ).catch(() => ({ stdout: '' }));

    const { stdout: untrackedList } = await execFileAsync(
      'git', ['ls-files', '--others', '--exclude-standard'],
      { cwd }
    ).catch(() => ({ stdout: '' }));

    const untrackedFiles = untrackedList.trim().split('\n').filter(Boolean);
    const changedFiles = [...new Set([
      ...nameList.trim().split('\n').filter(Boolean),
      ...untrackedFiles
    ])];
    const reviewFiles = getReviewFiles(issue, changedFiles);
    const scopedChildReview = Boolean(issue.parentTicketId);
    const { stdout: diff } = reviewFiles.length
      ? await execFileAsync(
        'git', ['diff', baseBranch, '--', ...reviewFiles],
        { cwd, maxBuffer: 10 * 1024 * 1024 }
      ).catch(() => ({ stdout: '(diff unavailable)' }))
      : { stdout: scopedChildReview ? '(no files in this child review scope)' : '(empty)' };
    const untrackedDiffs = await Promise.all(
      reviewFiles.filter((file) => untrackedFiles.includes(file)).map((file) => renderUntrackedDiff(cwd, file))
    );
    const reviewDiff = [diff?.trimEnd(), ...untrackedDiffs].filter(Boolean).join('\n');

    let fileBlock = '';
    let budget = MAX_FILE_BYTES;
    for (const f of reviewFiles) {
      if (budget <= 0) break;
      const content = await readFile(path.join(cwd, f), 'utf8').catch(() => '');
      const chunk = `\n\n### ${f}\n\`\`\`\n${content.slice(0, budget)}\n\`\`\``;
      fileBlock += chunk;
      budget -= content.length;
    }

    const rawSkill = await readFile(
      path.join(TEMPLATE_ROOT, 'skills/review-packet/SKILL.md'), 'utf8'
    ).catch(() => '');
    // Strip YAML frontmatter so the prompt doesn't start with '---'
    const skillContent = rawSkill.replace(/^---[\s\S]*?---\s*\n?/, '');

    const repoContext = [
      issue.repoProfile ? await readFile(issue.repoProfile, 'utf8').catch(() => '') : '',
      issue.projectGuide ? await readFile(issue.projectGuide, 'utf8').catch(() => '') : ''
    ].filter(Boolean).join('\n\n');

    const prompt = [
      skillContent,
      `Review changes for ${issue.ticketId}. Base branch: ${baseBranch}.`,
      issue.parentTicketId ? `Split child context:
- Parent: ${issue.parentTicketId}
- Review mode: ${issue.reviewMode || 'dependency-aware'}
- Owns: ${(issue.owns || []).join(', ') || 'none declared'}
- Depends on: ${(issue.dependsOn || []).join(', ') || 'none'}
- Blocks: ${(issue.blocks || []).join(', ') || 'none'}
- Expected cross-child findings: ${(issue.expectedCrossChildFindings || []).join('; ') || 'none'}
- Review file scope: ${reviewFiles.join(', ') || 'full branch diff'}

When a missing behavior is owned by a sibling child, write it as DEPENDENCY: instead of CRITICAL/HIGH.` : '',
      repoContext,
      `## Diff\n\`\`\`diff\n${reviewDiff || '(empty)'}\n\`\`\``,
      fileBlock ? `## Changed Files${fileBlock}` : ''
    ].filter(Boolean).join('\n\n');

    let stdout = '';
    let stderr = '';

    const child = spawn(
      command,
      [
        '-p', prompt,
        '--output-format', 'json',
        '--permission-mode', 'auto',
        ...(model ? ['--model', model] : [])
      ],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true }
    );

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

  const done = (async () => {
    const exitCode = await new Promise((resolve) => {
      child.on('error', (err) => { stderr += err.message; resolve(1); });
      child.on('close', resolve);
    });

    if (exitCode !== 0) {
      return { code: exitCode, error: stderr.trim() || `claude exited with code ${exitCode}` };
    }

    let reviewText = '';
    try {
      const parsed = JSON.parse(stdout.trim());
      if (parsed.is_error) {
        return { code: 1, error: parsed.result || 'claude reported an error' };
      }
      reviewText = parsed.result || '';
    } catch {
      return { code: 1, error: `Failed to parse claude output: ${stdout.slice(0, 200)}` };
    }

    await mkdir(path.dirname(reviewResultPath), { recursive: true });
    await writeFile(reviewResultPath, reviewText);
    return { code: 0 };
  })();

  return { pid: child.pid, done };
}

async function renderUntrackedDiff(cwd, file) {
  const content = await readFile(path.join(cwd, file), 'utf8').catch(() => '');
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [
    `diff --git a/${file} b/${file}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join('\n');
}

export function getReviewFiles(issue, changedFiles) {
  if (!issue?.parentTicketId) {
    return changedFiles;
  }

  const ownedFiles = issue.owns?.length
    ? changedFiles.filter((file) => isOwnedPath(file, issue.owns))
    : changedFiles;

  const baseline = new Set(issue.implementationBaselineChangedFiles || []);
  const changedSinceRun = ownedFiles.filter((file) => !baseline.has(file));

  return changedSinceRun.length ? changedSinceRun : ownedFiles;
}

function isOwnedPath(file, ownedPaths = []) {
  return ownedPaths.some((ownedPath) => {
    const normalizedOwned = String(ownedPath).replace(/\/+$/, '');
    return file === normalizedOwned || file.startsWith(`${normalizedOwned}/`);
  });
}
