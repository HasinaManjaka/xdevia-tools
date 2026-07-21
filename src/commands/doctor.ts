import { execa } from 'execa';
import chalk from 'chalk';

import { logger } from '../logger/index.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * `xdev doctor` — sanity-checks the local environment. Kept intentionally
 * simple; it exists mainly to demonstrate how trivially new commands slot
 * into the CLI (see cli/index.ts) without touching `dev`'s code at all.
 */
export async function runDoctorCommand(): Promise<void> {
  logger.title('xdev doctor');

  const checks: CheckResult[] = [];
  checks.push(await checkBinary('node', ['--version']));
  checks.push(await checkBinary('npm', ['--version']));
  checks.push(await checkBinary('ngrok', ['version']));

  for (const check of checks) {
    if (check.ok) {
      logger.success(`${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    } else {
      logger.error(`${check.name} — not found`);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  logger.divider();
  if (failed.length === 0) {
    logger.success('Everything looks good.');
  } else {
    logger.warn(`${failed.length} check(s) failed: ${failed.map((c) => c.name).join(', ')}`);
    logger.hint('Install the missing tool(s) and re-run "xdev doctor".');
  }
  logger.raw(chalk.dim('\n(More checks — Docker, Prisma, Cloudinary credentials, etc. — can be added here as new commands need them.)'));
}

async function checkBinary(binary: string, args: string[]): Promise<CheckResult> {
  try {
    const { stdout } = await execa(binary, args);
    return { name: binary, ok: true, detail: stdout.trim().split('\n')[0] };
  } catch {
    return { name: binary, ok: false };
  }
}
