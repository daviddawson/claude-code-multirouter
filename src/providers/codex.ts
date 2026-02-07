import * as https from 'https';
import { URL } from 'url';
import { anthropicToCodex } from '../format/anthropic-to-codex';
import { CodexToAnthropicStream } from '../format/codex-to-anthropic';

export async function handleCodexRequest(
  request: any,
  reply: any,
  config: any,
  usageLogger: any,
  targetModel: string,
  codexAuth: any
): Promise<void> {
  try {
    const anthropicBody = JSON.parse(request.rawBody.toString('utf-8'));

    const codexBody = anthropicToCodex(anthropicBody);
    codexBody.model = targetModel;

    const { accessToken, accountId } = await codexAuth.getToken();

    const url = new URL(config.providers.codex.baseUrl);

    const requestData = JSON.stringify(codexBody);

    const upstreamOptions: https.RequestOptions = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'chatgpt-account-id': accountId,
        'Content-Length': Buffer.byteLength(requestData)
      }
    };

    const stream = new CodexToAnthropicStream(targetModel);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const anthropicSSEBuffer: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const upstreamReq = https.request(upstreamOptions, (upstreamRes) => {
        let buffer = '';

        if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
          let errorBody = '';
          upstreamRes.on('data', (chunk: Buffer) => { errorBody += chunk.toString('utf-8'); });
          upstreamRes.on('end', () => {
            console.error(`[codex] ${upstreamRes.statusCode}: ${errorBody.slice(0, 300)}`);
            reply.raw.end(JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: `Codex API returned ${upstreamRes.statusCode}` }
            }));
            resolve();
          });
          return;
        }

        upstreamRes.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf-8');

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim();

              const anthropicEvents = stream.processChunk(payload);
              for (const event of anthropicEvents) {
                reply.raw.write(event);
                anthropicSSEBuffer.push(event);
              }
            }
          }
        });

        upstreamRes.on('end', () => {
          if (buffer.startsWith('data: ')) {
            const payload = buffer.slice(6).trim();
            const anthropicEvents = stream.processChunk(payload);
            for (const event of anthropicEvents) {
              reply.raw.write(event);
              anthropicSSEBuffer.push(event);
            }
          }

          const fullSSE = anthropicSSEBuffer.join('');
          const usage = usageLogger.extractUsageFromAnthropicSSE(fullSSE, 'codex', targetModel);
          if (usage) {
            usageLogger.logEntry(usage);
          }

          reply.raw.end();
          resolve();
        });

        upstreamRes.on('error', reject);
      });

      upstreamReq.on('error', reject);
      upstreamReq.write(requestData);
      upstreamReq.end();
    });

  } catch (error: any) {
    reply.code(502).send({
      error: {
        type: 'proxy_error',
        message: `Codex request failed: ${error.message}`
      }
    });
  }
}
