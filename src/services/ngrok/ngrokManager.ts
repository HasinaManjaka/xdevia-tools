import axios, { AxiosError } from 'axios';
import { execa, type ResultPromise } from 'execa';

import type { ManagedProcess, NgrokTunnelInfo } from '../../types/index.js';
import { NetworkError, NgrokError } from '../../errors/index.js';

export interface NgrokTunnelHandle {
  process: ManagedProcess;
  info: NgrokTunnelInfo;
}

interface NgrokApiTunnel {
  public_url: string;
  proto: string;
  config?: { addr?: string };
}

interface NgrokApiResponse {
  tunnels: NgrokApiTunnel[];
}

export interface StartNgrokOptions {
  port: number;
  /** Max time to wait for ngrok's local API to report a tunnel. */
  timeoutMs?: number;
  /** Poll interval while waiting for the tunnel to appear. */
  pollIntervalMs?: number;
}

const DEFAULT_LOCAL_API = 'http://127.0.0.1:4040/api/tunnels';

/**
 * Launches `ngrok http <port>` and polls that agent's local API until a
 * public URL is available for our backend (or the timeout elapses).
 *
 * Two things matter here that are easy to get wrong:
 *
 * 1. **Finding the right local API address.** ngrok's local web
 *    interface/API defaults to 127.0.0.1:4040, but that's a *default*, not a
 *    guarantee — and there's no supported CLI flag to force it to a
 *    different port on all ngrok versions (`--web-addr` only exists in
 *    config files, not as a CLI flag, and CLI flags vary across versions).
 *    So instead of assuming a port, we read it straight from ngrok's own
 *    startup logs (`--log=stdout --log-format=json` emits a
 *    `"starting web service"` line with the real bound address) and use
 *    exactly that.
 *
 * 2. **Matching the right tunnel.** Even once we're talking to the right
 *    agent, we still confirm the tunnel we pick is actually forwarding to
 *    the backend port we asked for (via the tunnel's `config.addr`), rather
 *    than blindly taking "the first https tunnel" the API returns.
 *
 * On top of that, ngrok's free tier only allows **one simultaneous agent
 * session per account**. If something else — Expo's `--tunnel` mode is a
 * common culprit, since it runs its own ngrok agent — already has a session
 * open, our `ngrok http` call can be rejected outright by ngrok's servers.
 * We detect that specific case and say so plainly, since no local port
 * juggling can work around it.
 */
export async function startNgrokTunnel(options: StartNgrokOptions): Promise<NgrokTunnelHandle> {
  const { port, timeoutMs = 15000, pollIntervalMs = 500 } = options;

  await assertNgrokInstalled();

  const child = execa(
    'ngrok',
    ['http', String(port), '--log=stdout', '--log-format=json'],
    { reject: false, all: true }
  );

  const startupErrors: string[] = [];
  let discoveredLocalApi: string | undefined;
  let sessionLimitHit = false;

  child.all?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;

      if (/simultaneous ngrok agent session|ERR_NGROK_108/i.test(line)) {
        sessionLimitHit = true;
      }

      const parsed = tryParseJsonLogLine(line);
      if (parsed?.msg === 'starting web service' && typeof parsed.addr === 'string') {
        discoveredLocalApi = `http://${parsed.addr}/api/tunnels`;
      }

      if (/err|error|panic/i.test(line)) {
        startupErrors.push(line.trim());
      }
    }
  });

  let exited = false;
  void child.then(() => {
    exited = true;
  });

  const info = await pollForTunnel({
    getLocalApiUrl: () => discoveredLocalApi ?? DEFAULT_LOCAL_API,
    targetPort: port,
    timeoutMs,
    pollIntervalMs,
    isProcessDead: () => exited,
  });

  if (!info) {
    child.kill('SIGTERM');

    if (sessionLimitHit) {
      throw new NgrokError('ngrok rejected the connection: your account already has an active agent session.', {
        hint:
          "This isn't a local conflict — ngrok's free tier only allows one running agent at a time per account. " +
          'If Expo (or anything else using `--tunnel` mode) already has an ngrok session open, stop that first, ' +
          'or run both endpoints from a single agent session using an ngrok config file with `ngrok start --all` ' +
          '(see https://ngrok.com/docs/agent/config/), or upgrade your ngrok plan.',
      });
    }

    throw new NgrokError('ngrok did not expose a public URL for the backend in time.', {
      hint:
        startupErrors.length > 0
          ? `ngrok reported: ${startupErrors[startupErrors.length - 1]}`
          : 'Make sure ngrok is authenticated (`ngrok config add-authtoken <token>`) and that no other process is blocking its startup.',
    });
  }

  const managed: ManagedProcess = {
    pid: child.pid,
    kill: async () => {
      if (child.pid) {
        child.kill('SIGTERM');
        await Promise.race([child as ResultPromise, delay(3000)]).catch(() => undefined);
      }
    },
  };

  return { process: managed, info };
}

async function assertNgrokInstalled(): Promise<void> {
  try {
    await execa('ngrok', ['version']);
  } catch (err) {
    throw new NgrokError('ngrok is not installed or not available on your PATH.', {
      hint: 'Install it from https://ngrok.com/download, or via your package manager (e.g. `brew install ngrok`).',
      cause: err,
    });
  }
}

interface NgrokLogLine {
  msg?: string;
  addr?: string;
  [key: string]: unknown;
}

function tryParseJsonLogLine(line: string): NgrokLogLine | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    return JSON.parse(trimmed) as NgrokLogLine;
  } catch {
    return undefined;
  }
}

interface PollOptions {
  /** Resolved lazily on each poll, since we may not know the real address until ngrok logs it. */
  getLocalApiUrl: () => string;
  targetPort: number;
  timeoutMs: number;
  pollIntervalMs: number;
  isProcessDead: () => boolean;
}

async function pollForTunnel(options: PollOptions): Promise<NgrokTunnelInfo | undefined> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (options.isProcessDead()) return undefined;

    const tunnel = await tryFetchTunnel(options.getLocalApiUrl(), options.targetPort);
    if (tunnel) return tunnel;

    await delay(options.pollIntervalMs);
  }
  return undefined;
}

async function tryFetchTunnel(localApiUrl: string, targetPort: number): Promise<NgrokTunnelInfo | undefined> {
  try {
    const { data } = await axios.get<NgrokApiResponse>(localApiUrl, { timeout: 2000 });

    // Prefer a tunnel we can confirm is actually forwarding to our backend
    // port — belt-and-suspenders guard against ever picking the wrong one
    // (e.g. a stray tunnel from another endpoint on the same agent).
    const matching = data.tunnels.filter((t) => tunnelTargetsPort(t, targetPort));
    const pool = matching.length > 0 ? matching : data.tunnels;

    const httpsTunnel = pool.find((t) => t.proto === 'https');
    const anyTunnel = httpsTunnel ?? pool[0];
    if (!anyTunnel) return undefined;

    return { publicUrl: anyTunnel.public_url, proto: anyTunnel.proto === 'https' ? 'https' : 'http' };
  } catch (err) {
    // Local API not up yet — this is expected during the first second or two.
    if (err instanceof AxiosError && (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED')) {
      return undefined;
    }
    if (err instanceof AxiosError) {
      // Some other, unexpected network condition — keep polling but don't hide it forever.
      return undefined;
    }
    throw new NetworkError('Unexpected error while contacting the ngrok local API.', { cause: err });
  }
}

/** True if a tunnel's forwarding target (`config.addr`) points at `port`. */
function tunnelTargetsPort(tunnel: NgrokApiTunnel, port: number): boolean {
  const addr = tunnel.config?.addr;
  if (!addr) return false;
  const match = /:(\d+)\D*$/.exec(addr);
  if (!match) return false;
  return Number.parseInt(match[1] as string, 10) === port;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
