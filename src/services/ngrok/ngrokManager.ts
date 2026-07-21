import axios, { AxiosError } from 'axios';
import { execa, type ResultPromise } from 'execa';

import type { ManagedProcess, NgrokTunnelInfo } from '../../types/index.js';
import { NetworkError, NgrokError } from '../../errors/index.js';

const NGROK_LOCAL_API = 'http://127.0.0.1:4040/api/tunnels';

export interface NgrokTunnelHandle {
  process: ManagedProcess;
  info: NgrokTunnelInfo;
}

interface NgrokApiTunnel {
  public_url: string;
  proto: string;
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
 * Launches `ngrok http <port>` and polls the local ngrok API until a public
 * URL is available (or the timeout elapses).
 */
export async function startNgrokTunnel(options: StartNgrokOptions): Promise<NgrokTunnelHandle> {
  const { port, timeoutMs = 15000, pollIntervalMs = 500 } = options;

  await assertNgrokInstalled();

  const child = execa('ngrok', ['http', String(port), '--log=stdout'], {
    reject: false,
    all: true,
  });

  const startupErrors: string[] = [];
  child.all?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8');
    if (/err|error|panic/i.test(text)) startupErrors.push(text.trim());
  });

  let exited = false;
  void child.then(() => {
    exited = true;
  });

  const info = await pollForTunnel({ timeoutMs, pollIntervalMs, isProcessDead: () => exited });

  if (!info) {
    child.kill('SIGTERM');
    throw new NgrokError('ngrok did not expose a public URL in time.', {
      hint:
        startupErrors.length > 0
          ? `ngrok reported: ${startupErrors[startupErrors.length - 1]}`
          : 'Make sure ngrok is authenticated (`ngrok config add-authtoken <token>`) and that no other ngrok agent is already running.',
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
  timeoutMs: number;
  pollIntervalMs: number;
  isProcessDead: () => boolean;
}

async function pollForTunnel(options: PollOptions): Promise<NgrokTunnelInfo | undefined> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (options.isProcessDead()) return undefined;

    const tunnel = await tryFetchTunnel();
    if (tunnel) return tunnel;

    await delay(options.pollIntervalMs);
  }
  return undefined;
}

async function tryFetchTunnel(): Promise<NgrokTunnelInfo | undefined> {
  try {
    const { data } = await axios.get<NgrokApiResponse>(NGROK_LOCAL_API, { timeout: 2000 });
    const httpsTunnel = data.tunnels.find((t) => t.proto === 'https');
    const anyTunnel = httpsTunnel ?? data.tunnels[0];
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
