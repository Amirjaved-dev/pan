import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

type StoredMessage = {
  id: string;
  fromPeerId: string;
  toPeerId: string | null;
  message: unknown;
  receivedAt: number;
};

const port = Number.parseInt(process.env.AXL_PORT ?? process.argv[2] ?? '9002', 10);
const peerId = process.env.AXL_PEER_ID ?? `pan-local-${randomUUID()}`;
const messages: StoredMessage[] = [];

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return null;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true, peerId, mode: 'pan-local-axl' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/info') {
      writeJson(response, 200, { peerId, mode: 'pan-local-axl' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/topology') {
      writeJson(response, 200, { peerId, peers: [] });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/messages' || url.pathname === '/recv')) {
      writeJson(response, 200, messages.splice(0, messages.length));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/send') {
      messages.push({
        id: randomUUID(),
        fromPeerId: peerId,
        toPeerId: request.headers['x-destination-peer-id']?.toString() ?? null,
        message: await readBody(request),
        receivedAt: Date.now(),
      });
      writeJson(response, 200, { ok: true });
      return;
    }

    writeJson(response, 404, { error: 'not found' });
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`[axl] local node listening on 127.0.0.1:${port} (${peerId})\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
