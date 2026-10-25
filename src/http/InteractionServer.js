import { createServer } from 'node:http';
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

export class InteractionServer {
  constructor(publicKey, applicationId, commands) {
    if (!/^[a-f0-9]{64}$/i.test(publicKey || '')) throw new Error('Invalid DISCORD_PUBLIC_KEY.');
    this.key = createPublicKey({
      key: Buffer.from(`302a300506032b6570032100${publicKey}`, 'hex'),
      format: 'der',
      type: 'spki',
    });
    const basePath = (process.env.HTTP_BASE_PATH || '').replace(/\/$/, '');
    this.healthPaths = new Set(['/health', `${basePath}/health`]);
    this.interactionPaths = new Set(['/', '/interactions', `${basePath}/interactions`]);
    this.apiBaseUrl = process.env.DISCORD_API_BASE_URL?.replace(/\/$/, '');
    this.applicationId = applicationId;
    this.commands = commands;
    this.pending = new Map();
    try {
      this.release = JSON.parse(
        readFileSync(new URL('../../config/release.json', import.meta.url), 'utf8'),
      ).release;
    } catch {
      this.release = process.env.RELEASE_ID || 'development';
    }
    this.server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
      void this.receive(req, res);
    });
    this.server.requestTimeout = 10000;
    this.server.headersTimeout = 10000;
  }
  send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  async receive(req, res) {
    try {
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && this.healthPaths.has(path))
        return this.send(res, 200, {
          status: 'ok',
          application: 'forum-discord-bot',
          release: this.release,
        });
      if (req.method !== 'POST' || !this.interactionPaths.has(path)) return this.send(res, 404, {});
      const signature = req.headers['x-signature-ed25519'];
      const timestamp = req.headers['x-signature-timestamp'];
      if (
        !/^[a-f\d]{128}$/i.test(signature || '') ||
        !/^\d+$/.test(timestamp || '') ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      )
        return this.send(res, 401, {});
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) return this.send(res, 413, {});
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (
        !verify(
          null,
          Buffer.concat([Buffer.from(timestamp), raw]),
          this.key,
          Buffer.from(signature, 'hex'),
        )
      )
        return this.send(res, 401, {});
      let i;
      try {
        i = JSON.parse(raw);
      } catch {
        return this.send(res, 400, {});
      }
      if (i?.type === 1) return this.send(res, 200, { type: 1 });
      if (i?.application_id !== this.applicationId || !/^\d+$/.test(i.id || '') || !i.token)
        return this.send(res, 400, {});
      for (const [id, item] of this.pending) if (item.expires < Date.now()) this.pending.delete(id);
      if (this.pending.has(i.id)) return this.send(res, 200, await this.pending.get(i.id).promise);
      if (this.pending.size >= 10000) return this.send(res, 503, {});
      const result = Promise.resolve().then(() => this.commands.handle(i));
      const promise = result.then((r) => r.response || r);
      this.pending.set(i.id, { expires: Date.now() + 900000, promise });
      this.send(res, 200, await promise);
      const command = await result;
      if (command.complete) {
        let data;
        try {
          data = await command.complete();
        } catch {
          data = {
            content:
              'Operacja nie powiodła się. Sprawdź konfigurację forum, uprawnienia do kanału lub spróbuj ponownie.',
            allowed_mentions: { parse: [] },
          };
        }
        const response = await fetch(
          `${this.apiBaseUrl}/webhooks/${this.applicationId}/${i.token}/messages/@original`,
          {
            method: data === null ? 'DELETE' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            ...(data === null ? {} : { body: JSON.stringify(data) }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok) console.error('Deferred response delivery failed:', response.status);
      }
    } catch {
      console.error('Interaction failed.');
      if (!res.headersSent) this.send(res, 500, {});
    }
  }
  listen(port, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, resolve);
    });
  }
  close() {
    return new Promise((resolve) => this.server.close(resolve));
  }
}
