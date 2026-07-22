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
  let resolveExit: (() => void) | undefined;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const emitter = new EventEmitter() as EventEmitter & {
    all?: EventEmitter;
    pid: number;
    kill: (signal?: string) => void;
    then: (fn: () => void) => Promise<void>;
    simulateExit: () => void;
  };
  emitter.all = new EventEmitter();
  emitter.pid = 4242;
  emitter.kill = vi.fn(() => resolveExit?.());
  // Only resolves when the test (or a `kill()` call) explicitly triggers it —
  // mirrors a real execa child, which stays pending until the process exits.
  emitter.then = (fn: () => void) => exitPromise.then(fn);
  emitter.simulateExit = () => resolveExit?.();
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

  it('never passes an unsupported --web-addr flag (not a real ngrok v3 CLI flag)', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'ngrok 3.0.0' });
    const fakeChild = makeFakeChild();
    execaMock.mockReturnValueOnce(fakeChild);
    axiosGetMock.mockResolvedValueOnce({
      data: { tunnels: [{ public_url: 'https://abc.ngrok-free.dev', proto: 'https', config: { addr: 'http://localhost:4000' } }] },
    });

    await startNgrokTunnel({ port: 4000, timeoutMs: 2000, pollIntervalMs: 10 });

    const [, args] = execaMock.mock.calls[1] as [string, string[]];
    expect(args.some((a) => a.startsWith('--web-addr'))).toBe(false);
  });

  it('discovers the real local API address from ngrok\'s own JSON logs instead of assuming 4040', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'ngrok 3.0.0' });
    const fakeChild = makeFakeChild();
    execaMock.mockReturnValueOnce(fakeChild);

    // ngrok logs it bound its web service to a non-default port.
    setTimeout(() => {
      fakeChild.all?.emit(
        'data',
        Buffer.from(JSON.stringify({ lvl: 'info', msg: 'starting web service', obj: 'web', addr: '127.0.0.1:4041' }) + '\n')
      );
    }, 5);

    axiosGetMock.mockImplementation((url: string) => {
      if (url === 'http://127.0.0.1:4041/api/tunnels') {
        return Promise.resolve({
          data: { tunnels: [{ public_url: 'https://abc.ngrok-free.dev', proto: 'https', config: { addr: 'http://localhost:4000' } }] },
        });
      }
      const err = new AxiosError('ECONNREFUSED');
      (err as AxiosError).code = 'ECONNREFUSED';
      return Promise.reject(err);
    });

    const handle = await startNgrokTunnel({ port: 4000, timeoutMs: 2000, pollIntervalMs: 10 });
    expect(handle.info.publicUrl).toBe('https://abc.ngrok-free.dev');
  });

  it('ignores an unrelated tunnel and picks the one matching our backend port', async () => {
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

  it('throws a specific, actionable NgrokError when the account session limit is hit', async () => {
    execaMock.mockResolvedValueOnce({ stdout: 'ngrok 3.0.0' });
    const fakeChild = makeFakeChild();
    execaMock.mockReturnValueOnce(fakeChild);

    setTimeout(() => {
      fakeChild.all?.emit(
        'data',
        Buffer.from('ERROR:  Your account is limited to 1 simultaneous ngrok agent session. (ERR_NGROK_108)\n')
      );
    }, 5);

    const err = new AxiosError('ECONNREFUSED');
    (err as AxiosError).code = 'ECONNREFUSED';
    axiosGetMock.mockRejectedValue(err);

    await expect(
      startNgrokTunnel({ port: 4000, timeoutMs: 300, pollIntervalMs: 10 })
    ).rejects.toThrow(/active agent session/i);
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
