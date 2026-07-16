import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function isClaudeAvailable(command = 'claude') {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const FORBIDDEN_COMMANDS = [
  {
    name: 'dependency installation',
    pattern: /\b(?:pnpm|npm|yarn)\s+(?:--[^\s]+\s+)*(?:install|add)\b/i
  },
  {
    name: 'hard git reset',
    pattern: /\bgit\s+reset\s+--hard\b/i
  },
  {
    name: 'git clean',
    pattern: /\bgit\s+clean\s+-[^\n;&|]*[fd][^\n;&|]*/i
  },
  {
    name: 'recursive force remove',
    pattern: /\brm\s+-[^\n;&|]*r[^\n;&|]*f|\brm\s+-[^\n;&|]*f[^\n;&|]*r/i
  },
  {
    name: 'lockfile mutation',
    pattern: /\b(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)\b.*\b(?:write|edit|modify|update|remove|delete)\b/i
  }
];

export function detectForbiddenCommand(commandText = '') {
  const normalized = String(commandText).replace(/\s+/g, ' ').trim();
  const match = FORBIDDEN_COMMANDS.find((rule) => rule.pattern.test(normalized));
  return match
    ? { rule: match.name, command: normalized }
    : null;
}

export async function runClaude({ cwd, prompt, logPath, command = 'claude', additionalDirs = [], model, guardrails = true }) {
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, '');
  const addDirArgs = additionalDirs.length ? ['--add-dir', ...additionalDirs] : [];
  const allowedTools = [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'Task',
    'Skill',
    'TodoWrite',
    'mcp__figma__get_design_context',
    'mcp__figma__get_screenshot',
    'mcp__figma__get_metadata'
  ];

  const child = spawn(
    command,
    [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'auto',
      '--allowedTools',
      allowedTools.join(','),
      ...(model ? ['--model', model] : []),
      ...addDirArgs
    ],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Create a new process group so we can kill the entire tree (claude + its subprocesses).
      detached: true
    }
  );

  let guardViolation = null;
  let streamBuffer = '';

  const stopForGuardrail = async (violation) => {
    if (guardViolation) return;
    guardViolation = violation;
    const message = `\n{"type":"guardrail","error":"Blocked forbidden command","rule":${JSON.stringify(violation.rule)},"command":${JSON.stringify(violation.command)}}\n`;
    await writeFile(logPath, message, { flag: 'a' });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  };

  const inspectStream = (chunk) => {
    if (!guardrails) return;
    streamBuffer += chunk.toString('utf8');
    const lines = streamBuffer.split('\n');
    streamBuffer = lines.pop() || '';
    for (const line of lines) {
      const violation = detectForbiddenCommandInStreamLine(line);
      if (violation) {
        void stopForGuardrail(violation);
        return;
      }
    }
  };

  const append = async (chunk) => {
    await writeFile(logPath, chunk, { flag: 'a' });
    inspectStream(chunk);
  };

  child.stdout.on('data', (chunk) => void append(chunk));
  child.stderr.on('data', (chunk) => void append(chunk));

  return {
    pid: child.pid,
    done: new Promise((resolve) => {
      child.on('error', (error) => resolve({ code: 1, error: error.message }));
      child.on('close', (code) => {
        if (guardViolation) {
          resolve({
            code: 1,
            blocked: true,
            blockType: 'guardrail',
            rule: guardViolation.rule,
            command: guardViolation.command,
            error: `Blocked forbidden command (${guardViolation.rule}): ${guardViolation.command}`
          });
        } else {
          resolve({ code });
        }
      });
    })
  };
}

function detectForbiddenCommandInStreamLine(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  const parts = entry.message?.content || [];
  for (const part of parts) {
    if (part.type === 'tool_use' && part.name === 'Bash' && part.input?.command) {
      const violation = detectForbiddenCommand(part.input.command);
      if (violation) {
        return violation;
      }
    }
  }
  return null;
}
