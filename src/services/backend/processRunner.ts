import { execa, type ResultPromise } from 'execa';
import chalk from 'chalk';

import type { ManagedProcess } from '../../types/index.js';
import { BackendError } from '../../errors/index.js';
import { logger, taggedLine } from '../../logger/index.js';

export interface StartProcessOptions {
  command: string;
  cwd: string;
  tag: string;
  tagColor?: (s: string) => string;
  /** Called once when the process appears to have started successfully (heuristic: first stdout line, or a grace period). */
  onStarted?: () => void;
  /** Milliseconds to wait for an early crash before considering the process "started". */
  startupGraceMs?: number;
}

/**
 * Spawns a long-running dev process (e.g. the backend server), streams its
 * output with a colored tag prefix, and resolves once it looks like the
 * process has started without immediately crashing.
 *
 * Detecting "has it started" perfectly is impossible in general (every
 * project logs differently), so we use a pragmatic heuristic: if the process
 * is still alive after `startupGraceMs`, we consider it started. If it exits
 * before that with a non-zero code, we treat that as a startup failure and
 * surface captured output in the error.
 */
export async function startManagedProcess(
  options: StartProcessOptions
): Promise<{ process: ManagedProcess; child: ResultPromise }> {
  const { command, cwd, tag, tagColor = chalk.cyan, startupGraceMs = 2500 } = options;
  const [cmd, ...args] = splitCommand(command);
  if (!cmd) {
    throw new BackendError(`Empty command for "${tag}".`);
  }

  const child = execa(cmd, args, {
    cwd,
    reject: false,
    all: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const recentOutput: string[] = [];

  child.all?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      recentOutput.push(line);
      if (recentOutput.length > 50) recentOutput.shift();
      logger.raw(taggedLine(tag, tagColor, line));
    }
  });

  const exitedEarly = await raceStartupOrExit(child, startupGraceMs);
  if (exitedEarly) {
    const code = child.exitCode ?? 'unknown';
    throw new BackendError(`"${tag}" exited immediately (code ${code}) before it finished starting.`, {
      hint:
        recentOutput.length > 0
          ? 'See the output above for details. Common causes: port already in use, missing dependencies, or a missing environment variable.'
          : 'It produced no output before exiting. Try running the command manually to see the full error.',
    });
  }

  options.onStarted?.();

  const managed: ManagedProcess = {
    pid: child.pid,
    kill: async () => {
      if (child.pid) {
        child.kill('SIGTERM');
        await Promise.race([child, delay(3000)]).catch(() => undefined);
      }
    },
  };

  return { process: managed, child };
}

/** Resolves `true` if the child process exits within `graceMs`, `false` if it's still running (i.e. "started"). */
async function raceStartupOrExit(child: ResultPromise, graceMs: number): Promise<boolean> {
  let exited = false;
  const exitPromise = child.then(() => {
    exited = true;
  });
  await Promise.race([exitPromise, delay(graceMs)]);
  return exited;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal shell-style command splitter: good enough for "npm run dev", "tsx watch src/x.ts", etc. Does not support quoting edge cases. */
function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/);
}
