import net from 'node:net';

/** Checks whether a TCP port is free on localhost. Resolves true if free, false if already in use. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

/**
 * Asks the OS for a free ephemeral TCP port on localhost (by binding to
 * port 0 and reading back what was assigned, then releasing it).
 *
 * Used to give each xdev-managed process (e.g. its own ngrok agent) an
 * isolated port that can't collide with something else already running on
 * the machine — including another, unrelated ngrok agent.
 *
 * There's a small unavoidable race between releasing the port here and the
 * caller binding to it, but it's the standard, good-enough approach for a
 * local dev tool like this.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', reject);
    tester.listen(0, '127.0.0.1', () => {
      const address = tester.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        tester.close(() => resolve(port));
      } else {
        tester.close(() => reject(new Error('Could not determine a free port.')));
      }
    });
  });
}
