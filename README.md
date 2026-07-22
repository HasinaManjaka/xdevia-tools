# @xdevia/dev-tools

A small CLI that automates the "start everything" ritual for local development:
start your backend, tunnel it with **ngrok**, and wire the public URL straight
into your frontend's `.env` — automatically, every time.

```
xdev dev
```

does all of this:

1. Detects and runs your backend's dev script.
2. Detects the port it listens on.
3. Starts `ngrok http <port>`.
4. Reads the public URL from ngrok's local API.
5. Updates `EXPO_PUBLIC_DEV_API_URL` (or whatever you configure) in your
   frontend's `.env`, without touching anything else in that file.
6. Streams colored, tagged logs from every process, and shuts everything
   down cleanly on `Ctrl+C`.

---

## Installation

### As a global / reusable tool (recommended)

```bash
npm install -g @xdevia/dev-tools
```

Then, from the root of any backend project:

```bash
xdev dev
```

### Without installing, via npx

```bash
npx @xdevia/dev-tools dev
```

### Requirements

- Node.js 18+
- [ngrok](https://ngrok.com/download) installed and authenticated
  (`ngrok config add-authtoken <your-token>`) — only needed if you use the
  ngrok integration (on by default, disable with `--no-ngrok`).

---

## Usage

### First run

The first time you run `xdev dev` inside a project, it asks:

```
Where is your frontend project?
```

Answer with a relative or absolute path, e.g.:

```
../frontend
```

or

```
/home/manjaka/Desktop/XDevia/finance/frontend
```

xdev validates that the folder exists and contains a `package.json`, creates
a `.env` there if one doesn't exist yet, and saves your answer to
`.xdevrc.json` in the current directory so you're never asked again.

### Every run after that

```bash
xdev dev
```

Example output:

```
xdev dev

ℹ Backend command: npm run dev:server (detected from package.json)
ℹ Backend port: 4000 (detected from .env)
✔ Backend started
✔ Ngrok started
✔ URL detected

  https://a1b2c3d4.ngrok-free.dev

✔ Frontend .env updated
────────────────────────────────────────────────
✔ Ready
  Press Ctrl+C to stop everything.
```

Press `Ctrl+C` at any time — xdev stops the backend and ngrok cleanly before
exiting, so nothing is left running in the background.

### Flags

| Flag             | Description                                             |
| ---------------- | -------------------------------------------------------- |
| `--no-ngrok`      | Only start the backend; skip ngrok and the `.env` update |
| `--reconfigure`   | Re-run the interactive setup, even if already configured  |

### Other commands

```bash
xdev doctor   # checks that node, npm, and ngrok are installed and working
```

New commands (`xdev stop`, `xdev docker`, `xdev prisma`, `xdev clean`, ...)
are designed to slot in the same way `doctor` did — see
[Development guide](#development-guide) below.

---

## Configuration

Stored in `.xdevrc.json` at the root of the project you run `xdev` from:

```json
{
  "frontendPath": "../frontend",
  "envVariable": "EXPO_PUBLIC_DEV_API_URL",
  "ngrok": true,
  "backendCommand": "npm run dev:server",
  "backendPort": 4000,
  "version": 1
}
```

| Field            | Required | Description                                                                 |
| ----------------- | -------- | ---------------------------------------------------------------------------- |
| `frontendPath`    | yes      | Path to the frontend project, relative to this config file or absolute.      |
| `envVariable`     | no       | Env var name to write the ngrok URL into. Defaults to `EXPO_PUBLIC_DEV_API_URL`. |
| `ngrok`           | no       | Set to `false` to disable ngrok for this project. Defaults to `true`.        |
| `backendCommand`  | no       | Skip auto-detection and always run this exact command for the backend.       |
| `backendPort`     | no       | Skip auto-detection and always use this port.                                |
| `version`         | no       | Config schema version, used internally for future migrations.               |

You can hand-edit this file at any time; it's plain JSON.

### How the backend command is detected

In priority order:

1. `backendCommand` in `.xdevrc.json`, if set.
2. The first matching script in the backend's `package.json`, checked in this
   order: `dev:server`, `dev`, `start:dev`, `server:dev`, `start`.
3. A best-effort guess based on common entry files (`src/server.ts`,
   `src/index.ts`, `server.js`, `index.js`) — clearly logged as a guess.

Nothing is ever hardcoded to a specific project's layout.

### How the backend port is detected

In priority order:

1. `backendPort` in `.xdevrc.json`, if set.
2. `PORT` (or `SERVER_PORT` / `API_PORT` / `BACKEND_PORT`) in the backend's
   `.env` file.
3. The same variables from the current shell environment.
4. An interactive prompt, if nothing else worked.

---

## Troubleshooting

**"Frontend directory not found"**
The path saved in `.xdevrc.json` (or the one you just typed) doesn't exist.
Fix the `frontendPath` field, or delete `.xdevrc.json` and run `xdev dev`
again with `--reconfigure`.

**"No package.json found in backend directory"**
Run `xdev` from the root of your backend project, or set `backendCommand`
explicitly in `.xdevrc.json`.

**"Could not determine how to start the backend"**
Add a `dev` or `dev:server` script to your backend's `package.json`, or set
`backendCommand` in `.xdevrc.json`.

**"Port already in use"**
Something else is already listening on the detected port. Stop it, or set
`backendPort` to a free port in `.xdevrc.json`.

**"ngrok is not installed or not available on your PATH"**
Install it from <https://ngrok.com/download>, or via your package manager.

**"ngrok did not expose a public URL for the backend in time" while another ngrok agent (e.g. Expo's tunnel) is running**
xdev launches its own ngrok agent on an isolated local web-interface port
specifically so it never reads another agent's tunnels (this used to be a
bug — see [Development guide](#development-guide) note below). If you still
hit this, it usually means your installed ngrok version predates the
`--web-addr` flag; update ngrok to the latest version.

**"ngrok did not expose a public URL in time"**
Usually means ngrok isn't authenticated yet — run
`ngrok config add-authtoken <token>` — or another ngrok agent is already
running on your machine.

**"\<tag\>" exited immediately before it finished starting"**
The backend (or ngrok) crashed right after launch. Scroll up — the tagged,
colored logs right above the error are the actual output from that process
and almost always explain why.

**Malformed `.xdevrc.json` / JSON parsing errors**
Fix the JSON by hand, or just delete the file and run `xdev dev` again to
regenerate it via the interactive setup.

**Nothing works and you're not sure why**
Run `xdev doctor` to check that node, npm, and ngrok are all installed and on
your `PATH`.

Every error xdev raises is designed to (1) say what went wrong and (2) say
how to fix it — it should never crash with a raw stack trace during normal
use. Set `XDEV_DEBUG=1` if you ever need the full stack trace for a bug
report.

---

## Development guide

### Project layout

```
src/
  cli/            # Commander setup, top-level error handling, graceful shutdown
  commands/       # One file per user-facing command (dev.ts, doctor.ts, ...)
  services/
    backend/      # Command detection, port detection, process spawning
    ngrok/        # Launching ngrok and polling its local API
    frontend/     # Reading/writing the frontend .env
  config/         # Loading/creating .xdevrc.json, interactive setup, validation
  utils/          # Small, pure, dependency-light helpers (fs, .env parsing, ports)
  logger/         # All console/color output goes through here
  errors/         # XdevError hierarchy with actionable hints
  types/          # Shared TypeScript interfaces
tests/            # Vitest unit tests, mocking fs / child processes / ngrok's API
```

### Adding a new command

1. Create `src/commands/<name>.ts` exporting an async `run<Name>Command()`
   function. Keep it thin — it should orchestrate calls into `services/`,
   not contain business logic itself.
2. Register it in `src/cli/index.ts`:

   ```ts
   program
     .command('<name>')
     .description('...')
     .action(async () => {
       await runSafely(() => run<Name>Command());
     });
   ```

3. If it needs to manage long-running processes (like `dev` does), use
   `withGracefulShutdown` instead of `runSafely` so `Ctrl+C` cleans up
   properly.
4. Add unit tests under `tests/`, mocking `node:fs`, `execa`, and `axios` as
   needed — see `tests/commandDetector.test.ts` or `tests/ngrokManager.test.ts`
   for the pattern.

No existing command's code needs to change — this is the whole point of the
`cli / commands / services` split.

### Error handling conventions

Throw one of the typed errors from `src/errors/index.ts`
(`ConfigError`, `FrontendPathError`, `EnvFileError`, `BackendError`,
`NgrokError`, `NetworkError`, `UserCancelledError`) with a `hint` explaining
the fix. The CLI's top-level handler renders `message` + `hint` and exits
cleanly — it never lets an unexpected exception crash the process with a
raw stack trace.

### Scripts

```bash
npm run dev        # run the CLI from source with tsx (no build step)
npm run build      # compile to dist/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest run
npm run test:watch # vitest --watch
```

### Testing philosophy

Every service is written so its side effects (filesystem, child processes,
HTTP) go through Node/library APIs that are trivial to mock with `vi.mock`.
Business logic (env-file patching, command/port detection priority, error
messages) is tested directly; nothing in `tests/` spawns a real process,
touches the real filesystem, or calls the real network.

---

## License

MIT
