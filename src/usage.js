import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 30 * 1000;
let cachedUsage = null;
let cachedAt = 0;

export async function getClaudeUsage(options = {}) {
  const now = Date.now();
  if (!options.force && cachedUsage && now - cachedAt < CACHE_TTL_MS) {
    return cachedUsage;
  }

  const command = options.command || process.env.CCUSAGE_COMMAND || 'ccusage';
  try {
    const [daily, monthly, blocks] = await Promise.all([
      runCcusage(command, ['daily', '--json', '--offline', '--order', 'desc']),
      runCcusage(command, ['monthly', '--json', '--offline', '--order', 'desc']),
      runCcusage(command, ['blocks', '--json', '--offline', '--order', 'desc'])
    ]);
    cachedUsage = summarizeClaudeUsage({ daily, monthly, blocks });
  } catch (error) {
    cachedUsage = {
      available: false,
      updatedAt: new Date().toISOString(),
      error: error.message || String(error)
    };
  }

  cachedAt = now;
  return cachedUsage;
}

export function summarizeClaudeUsage({ daily, monthly, blocks }) {
  const today = daily?.daily?.[0] || null;
  const month = monthly?.monthly?.[0] || null;
  const activeBlock = (blocks?.blocks || []).find((block) => block.isActive && !block.isGap) || null;

  return {
    available: true,
    updatedAt: new Date().toISOString(),
    today: today ? summarizePeriod(today, 'date') : null,
    month: month ? summarizePeriod(month, 'month') : null,
    activeBlock: activeBlock ? {
      id: activeBlock.id,
      startTime: activeBlock.startTime,
      endTime: activeBlock.endTime,
      totalTokens: activeBlock.totalTokens || 0,
      totalCost: activeBlock.costUSD || 0,
      entries: activeBlock.entries || 0,
      modelsUsed: activeBlock.models || [],
      costPerHour: activeBlock.burnRate?.costPerHour || 0,
      tokensPerMinute: activeBlock.burnRate?.tokensPerMinute || 0,
      projectedCost: activeBlock.projection?.totalCost || 0,
      remainingMinutes: activeBlock.projection?.remainingMinutes || 0
    } : null
  };
}

async function runCcusage(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 10 * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

function summarizePeriod(period, key) {
  return {
    label: period[key],
    inputTokens: period.inputTokens || 0,
    outputTokens: period.outputTokens || 0,
    cacheCreationTokens: period.cacheCreationTokens || 0,
    cacheReadTokens: period.cacheReadTokens || 0,
    totalTokens: period.totalTokens || 0,
    totalCost: period.totalCost || 0,
    modelsUsed: period.modelsUsed || []
  };
}
