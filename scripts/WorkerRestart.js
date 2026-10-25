import { readdirSync, readlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class WorkerRestart {
  static runRequested() {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const requestPath = resolve(root, 'tmp/reload-request.json');
    const resultPath = resolve(root, 'tmp/reload-result.json');
    let request;
    try {
      request = JSON.parse(readFileSync(requestPath, 'utf8'));
    } catch {
      return;
    }
    if (
      !/^release-[a-zA-Z0-9]+$/.test(request.id ?? '') ||
      !['inspect', 'restart'].includes(request.action) ||
      !Number.isFinite(request.expires) ||
      request.expires < Date.now() ||
      request.expires > Date.now() + 900000
    )
      return;
    try {
      if (JSON.parse(readFileSync(resultPath, 'utf8')).id === request.id) return;
    } catch {
      /* First request. */
    }
    const workers = this.inspect(root);
    const result = {
      id: request.id,
      action: request.action,
      workers,
      at: new Date().toISOString(),
    };
    // Persist consumption before signalling to avoid repeated restarts from cron retries.
    writeFileSync(resultPath, JSON.stringify(result), { mode: 0o600 });
    if (request.action === 'restart') {
      for (const worker of workers) {
        if (this.inspect(root).some((current) => current.pid === worker.pid))
          process.kill(worker.pid, 'SIGTERM');
      }
    }
  }

  static inspect(
    root = fileURLToPath(new URL('..', import.meta.url)),
    io = { readdirSync, readlinkSync, readFileSync },
  ) {
    const application = resolve(root);
    const workers = [];
    for (const entry of io.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
      try {
        const cwd = io.readlinkSync(`/proc/${entry}/cwd`);
        const args = io.readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0');
        if (cwd !== application || !args.some((arg) => /(?:^|\/)lsnode(?::|\.js|$)/.test(arg)))
          continue;
        workers.push({ pid: Number(entry), cwd });
      } catch {
        /* Other users' processes and exited workers are intentionally ignored. */
      }
    }
    return workers;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workers = WorkerRestart.inspect();
  console.log(JSON.stringify({ workers }));
  if (process.argv.includes('--restart')) {
    for (const worker of workers) {
      // Recheck identity immediately before signalling; never use account-wide pkill.
      if (WorkerRestart.inspect().some((current) => current.pid === worker.pid))
        process.kill(worker.pid, 'SIGTERM');
    }
    console.log(`Signalled ${workers.length} bot-specific workers.`);
  }
}
