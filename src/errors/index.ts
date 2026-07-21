/**
 * Custom error hierarchy for @xdevia/dev-tools.
 *
 * Every error thrown intentionally by this package extends `XdevError` and
 * carries a human-readable `hint` describing how to fix the problem. The
 * top-level CLI handler (see `cli/index.ts`) knows how to render these nicely
 * and exit with a clean, non-crashing message. Unexpected (non-XdevError)
 * exceptions are still caught and reported, just without a tailored hint.
 */

export interface XdevErrorOptions {
  /** A short, actionable suggestion for how the user can resolve the issue. */
  hint?: string;
  /** The original error that caused this one, if any. */
  cause?: unknown;
  /** Process exit code to use when this error bubbles up to the CLI. */
  exitCode?: number;
}

export class XdevError extends Error {
  public readonly hint?: string;
  public readonly cause?: unknown;
  public readonly exitCode: number;

  constructor(message: string, options: XdevErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.hint = options.hint;
    this.cause = options.cause;
    this.exitCode = options.exitCode ?? 1;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Configuration file is missing, unreadable, or malformed. */
export class ConfigError extends XdevError {}

/** The frontend project path is invalid (missing, not a project, etc). */
export class FrontendPathError extends XdevError {}

/** Reading or writing the frontend .env file failed. */
export class EnvFileError extends XdevError {}

/** The backend's dev command or port could not be determined or failed to run. */
export class BackendError extends XdevError {}

/** ngrok is not installed, not authenticated, or its API could not be reached. */
export class NgrokError extends XdevError {}

/** The user cancelled an interactive prompt (e.g. Ctrl+C). */
export class UserCancelledError extends XdevError {
  constructor(message = 'Cancelled by user.') {
    super(message, { exitCode: 130 });
  }
}

/** A network request (e.g. to the ngrok local API) timed out or failed. */
export class NetworkError extends XdevError {}

/**
 * Type guard for narrowing `unknown` catch values to `XdevError`.
 */
export function isXdevError(err: unknown): err is XdevError {
  return err instanceof XdevError;
}
