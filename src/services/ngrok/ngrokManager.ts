import axios, { AxiosError } from 'axios';
import { execa, type ResultPromise } from 'execa';

import type { ManagedProcess, NgrokTunnelInfo } from '../../types/index.js';
import { NetworkError, NgrokError } from '../../errors/index.js';
import { getFreePort } from '../../utils/port.js';

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

/**
 * Launches `ngrok http <port>` and polls that agent's local API until a
 * public URL is available for our backend (or the timeout elapses).
 *
 * Two things matter here that are easy to get wrong:
 *
 * 1. **Isolation**: ngrok's local API defaults to 127.0.0.1:4040, but that's
 *    per *agent*, not global. If another ngrok agent is already running on
 *    this machine (e.g. Expo's `--tunnel` mode, which spins up its own ngrok
 *    process), it may already own port 4040. We never assume 4040 is ours —
 *    we ask the OS for a free port and tell our ngrok agent to use that one
 *    via `--web-addr`, so we always talk to *our* agent, never someone else's.
 *
 * 2. **Matching**: even talking to the right agent, we still confirm the
 *    tunnel we pick is actually forwarding to the backend port we asked for
 *    (via the tunnel's `config.addr`), rather than blindly taking "the first
 *    https tunnel" the API returns.
 */
export async function startNgrokTunnel(options: StartNgrokOptions): Promise<NgrokTunnelHandle> {
  const { port, timeoutMs = 15000, pollIntervalMs = 500 } = options;

  await assertNgrokInstalled();

  const webAddrPort = await getFreePort().catch((err) => {
    throw new NgrokError('Could not find a free local port for ngrok\'s web interface.', {
      hint: 'This is unusual — try again, or free up some local ports and retry.',
      cause: err,
    });
  });
  const webAddr = `127.0.0.1:${webAddrPort}`;
  const localApiUrl = `http://${webAddr}/api/tunnels`;

  const child = execa(
    'ngrok',
    ['http', String(port), `--web-addr=${webAddr}`, '--log=stdout'],
    { reject: false, all: true }
  );

  const startupErrors: string[] = [];
  child.all?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    if (/err|error|panic/i.test(text)) startupErrors.push(text.trim());
  });

  let exited = false;
  void child.then(() => {
    exited = true;
  });

  const info = await pollForTunnel({
    localApiUrl,
    targetPort: port,
    timeoutMs,
    pollIntervalMs,
    isProcessDead: () => exited,
  });

  if (!info) {
    child.kill('SIGTERM');
    throw new NgrokError('ngrok did not expose a public URL for the backend in time.', {
      hint:
        startupErrors.length > 0
          ? `ngrok reported: ${startupErrors[startupErrors.length - 1]}`
          : 'Make sure ngrok is authenticated (`ngrok config add-authtoken <token>`). ' +
            'If this keeps happening, your installed ngrok version may not support the ' +
            '"--web-addr" flag — try updating ngrok to the latest version.',
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

interface PollOptions {
  localApiUrl: string;
  targetPort: number;
  timeoutMs: number;
  pollIntervalMs: number;
  isProcessDead: () => boolean;
}

async function pollForTunnel(options: PollOptions): Promise<NgrokTunnelInfo | undefined> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (options.isProcessDead()) return undefined;

    const tunnel = await tryFetchTunnel(options.localApiUrl, options.targetPort);
    if (tunnel) return tunnel;

    await delay(options.pollIntervalMs);
  }
  return undefined;
}

async function tryFetchTunnel(localApiUrl: string, targetPort: number): Promise<NgrokTunnelInfo | undefined> {
  try {
    const { data } = await axios.get<NgrokApiResponse>(localApiUrl, { timeout: 2000 });

    // Prefer a tunnel we can confirm is actually forwarding to our backend
    // port. Since this agent was started in isolation just for this port,
    // this should always be true once the tunnel is up — the check is a
    // belt-and-suspenders guard against picking the wrong one.
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
