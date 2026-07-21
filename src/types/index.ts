/**
 * Shared type definitions for @xdevia/dev-tools.
 */

/** Persisted project configuration, stored as `.xdevrc.json` at the project root. */
export interface XdevConfig {
  /** Absolute or relative (to config file) path to the frontend project. */
  frontendPath: string;
  /** Name of the env variable in the frontend .env that should receive the public URL. */
  envVariable: string;
  /** Whether ngrok tunneling is enabled for this project. */
  ngrok: boolean;
  /** Optional explicit backend dev command override (skips auto-detection). */
  backendCommand?: string;
  /** Optional explicit backend port override (skips auto-detection). */
  backendPort?: number;
  /** Schema version, used for future migrations. */
  version: number;
}

/** Partial config as loaded from disk, before defaults are applied / before first run. */
export type PartialXdevConfig = Partial<XdevConfig>;

export const DEFAULT_ENV_VARIABLE = 'EXPO_PUBLIC_DEV_API_URL';
export const CONFIG_FILE_NAME = '.xdevrc.json';
export const CONFIG_SCHEMA_VERSION = 1;

/** Result of detecting the backend's dev command from its package.json. */
export interface BackendCommandInfo {
  /** The full shell command to run, e.g. "npm run dev:server". */
  command: string;
  /** The package.json script name that was chosen, if any. */
  scriptName?: string;
  /** Where the command came from, for logging / transparency. */
  source: 'config-override' | 'package-json-script' | 'fallback-guess';
}

/** Result of detecting the backend's listening port. */
export interface BackendPortInfo {
  port: number;
  source: 'config-override' | 'dotenv' | 'process-env' | 'user-prompt' | 'default';
}

/** Info returned once ngrok has started and exposed a tunnel. */
export interface NgrokTunnelInfo {
  publicUrl: string;
  proto: 'https' | 'http';
}

/** A running child process handle abstraction used by services (for easier testing/mocking). */
export interface ManagedProcess {
  pid: number | undefined;
  kill: () => Promise<void>;
}

/** Options accepted by the `xdev dev` command. */
export interface DevCommandOptions {
  /** Skip ngrok entirely for this run. */
  noNgrok?: boolean;
  /** Force re-asking for the frontend path even if already configured. */
  reconfigure?: boolean;
  /** Path to run the command from (defaults to process.cwd()). */
  cwd?: string;
}
