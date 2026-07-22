import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const axiosGetMock = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => axiosGetMock(...args) },
  AxiosError: class AxiosError extends Error {
    code?: string;
  },
}));

function makeFakeChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    all?: EventEmitter;
    pid: number;
    kill: (signal?: string) => void;
    then: (fn: () => void) => Promise<void>;
  };
  emitter.all = new EventEmitter();
  emitter.pid = 4242;
  emitter.kill = vi.fn();
  // Make it thenable so `await child` / `child.then(...)` works like a real execa result promise.
  emitter.then = (fn: () => void) => new Promise((resolve) => resolve(undefined)).then(fn);
  return emitter;
}

const execaMock = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

import { startNgrokTunnel } from '../src/services/ngrok/ngrokManager.js';
import { NgrokError } from '../src/errors/index.js';
import { AxiosError } from 'axios';

describe('startNgrokTunnel', () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
    execaMock.mockReset();
  });

  it('throws NgrokError when ngrok is not installed', async () => {
    execaMock.mockRejectedValueOnce(new Error('command not found: ngrok'));
    await expect(startNgrokTunnel({ port: 4000, timeoutMs: 500 })).rejects.toThrow(NgrokError);
  });

  it('resolves with the https public URL once the local API reports a tunnel', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'ngrok 3.0.0' }); // `ngrok version` check
    const fakeChild = makeFakeChild();
    execaMock.mockReturnValueOnce(fakeChild); // the actual `ngrok http <port>` process

    axiosGetMock.mockResolvedValueOnce({
      data: {
        tunnels: [
          { public_url: 'http://abc.ngrok-free.dev', proto: 'http', config: { addr: 'http://localhost:4000' } },
          { public_url: 'https://abc.ngrok-free.dev', proto: 'https', config: { addr: 'http://localhost:4000' } },
        ],
      },
    });

    const handle = await startNgrokTunnel({ port: 4000, timeoutMs: 2000, pollIntervalMs: 10 });
    expect(handle.info.publicUrl).toBe('https://abc.ngrok-free.dev');
    expect(handle.info.proto).toBe('https');
    expect(handle.process.pid).toBe(4242);

    // The agent must be launched on its own isolated web-interface port,
    // never assuming the default 4040 (which another ngrok agent, e.g.
    // Expo's tunnel, might already own).
    const [, args] = execaMock.mock.calls[1] as [string, string[]];
    expect(args).toContain('http');
    expect(args).toContain('4000');
    expect(args.some((a) => /^--web-addr=127\.0\.0\.1:\d+$/.test(a))).toBe(true);
  });

  it('ignores an unrelated tunnel already running on the same agent-lookalike response and picks our backend port', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'ngrok 3.0.0' });
    const fakeChild = makeFakeChild();
    execaMock.mockReturnValueOnce(fakeChild);

    axiosGetMock.mockResolvedValueOnce({
      data: {
        tunnels: [
          // e.g. a stray tunnel forwarding to Expo's dev server on a different port
          { public_url: 'https://expo-tunnel.ngrok-free.dev', proto: 'https', config: { addr: 'http://localhost:8081' } },
          { public_url: 'https://backend-tunnel.ngrok-free.dev', proto: 'https', config: { addr: 'http://localhost:4000' } },
        ],
      },
    });

    const handle = await startNgrokTunnel({ port: 4000, timeoutMs: 2000, pollIntervalMs: 10 });
    expect(handle.info.publicUrl).toBe('https://backend-tunnel.ngrok-free.dev');
  });

  it('throws NgrokError if the local API never reports a tunnel before the timeout', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'ngrok 3.0.0' });
    const fakeChild = makeFakeChild();
    execaMock.mockReturnValueOnce(fakeChild);

    const err = new AxiosError('ECONNREFUSED');
    (err as AxiosError).code = 'ECONNREFUSED';
    axiosGetMock.mockRejectedValue(err);

    await expect(
      startNgrokTunnel({ port: 4000, timeoutMs: 100, pollIntervalMs: 10 })
    ).rejects.toThrow(NgrokError);
  });
});
