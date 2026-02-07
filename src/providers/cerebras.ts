import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { anthropicToOpenAI } from '../format/anthropic-to-openai';
import { OpenAIToAnthropicStream } from '../format/openai-to-anthropic';

export async function handleCerebrasRequest(
  request: any,
  reply: any,
  config: any,
  usageLogger: any,
  targetModel: string
): Promise<void> {
  try {
    const anthropicBody = JSON.parse(request.rawBody.toString('utf-8'));

    const openAIBody = anthropicToOpenAI(anthropicBody);
    openAIBody.model = targetModel;
    openAIBody.stream = true;

    const url = new URL(config.providers.cerebras.baseUrl);
    const protocol = url.protocol === 'https:' ? https : http;

    const requestData = JSON.stringify(openAIBody);

    const upstreamOptions: https.RequestOptions = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: {
        'Authorization': `Bearer ${config.providers.cerebras.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      }
    };

    const stream = new OpenAIToAnthropicStream(targetModel);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const anthropicSSEBuffer: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const upstreamReq = protocol.request(upstreamOptions, (upstreamRes) => {
        let buffer = '';

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
          const usage = usageLogger.extractUsageFromAnthropicSSE(fullSSE, 'cerebras', targetModel);
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
        message: `Cerebras request failed: ${error.message}`
      }
    });
  }
}
