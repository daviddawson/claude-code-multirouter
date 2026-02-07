import { request as httpsRequest } from 'node:https';
import { IncomingMessage } from 'node:http';
import { UsageLogger } from '../usage';

export async function handleAnthropicRequest(
  request: any,
  reply: any,
  usageLogger: UsageLogger
): Promise<void> {
  const upstreamHeaders: Record<string, string | string[]> = {};

  const skipHeaders = new Set([
    'host',
    'content-length',
    'connection',
    'transfer-encoding'
  ]);

  for (const [key, value] of Object.entries(request.headers)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      upstreamHeaders[key] = value as string | string[];
    }
  }

  upstreamHeaders['host'] = 'api.anthropic.com';

  const rawBody = request.rawBody as Buffer;
  if (rawBody && rawBody.length > 0) {
    upstreamHeaders['content-length'] = String(rawBody.length);
  }

  let modelName = 'unknown';
  try {
    const bodyJson = JSON.parse(rawBody.toString('utf-8'));
    if (bodyJson.model) {
      modelName = bodyJson.model;
    }
  } catch {
    // Ignore parse errors
  }

  return new Promise<void>((resolve, reject) => {
    const upstreamReq = httpsRequest(
      {
        hostname: 'api.anthropic.com',
        port: 443,
        path: request.url,
        method: request.method,
        headers: upstreamHeaders
      },
      (upstreamRes: IncomingMessage) => {
        handleUpstreamResponse(upstreamRes, reply, usageLogger, modelName, resolve, reject);
      }
    );

    upstreamReq.on('error', err => {
      handleUpstreamError(err, reply, resolve);
    });

    if (rawBody && rawBody.length > 0) {
      upstreamReq.write(rawBody);
    }

    upstreamReq.end();
  });
}

function handleUpstreamResponse(
  upstreamRes: IncomingMessage,
  reply: any,
  usageLogger: UsageLogger,
  modelName: string,
  resolve: () => void,
  reject: (err: Error) => void
): void {
  const chunks: Buffer[] = [];

  reply.raw.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);

  upstreamRes.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    reply.raw.write(chunk);
  });

  upstreamRes.on('end', () => {
    reply.raw.end();

    extractAndLogUsage(chunks, usageLogger, modelName);

    resolve();
  });

  upstreamRes.on('error', err => {
    reply.raw.end();
    reject(err);
  });
}

function extractAndLogUsage(
  chunks: Buffer[],
  usageLogger: UsageLogger,
  modelName: string
): void {
  const bufferedText = Buffer.concat(chunks).toString('utf-8');
  const usage = usageLogger.extractUsageFromAnthropicSSE(bufferedText, 'anthropic', modelName);

  if (usage) {
    usageLogger.logEntry(usage);
  }
}

function handleUpstreamError(
  err: Error,
  reply: any,
  resolve: () => void
): void {
  reply.raw.writeHead(502, { 'Content-Type': 'application/json' });
  reply.raw.end(JSON.stringify({
    error: {
      type: 'proxy_error',
      message: `Failed to connect to upstream: ${err.message}`
    }
  }));

  resolve();
}
