import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface UsageEntry {
  timestamp: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export class UsageLogger {
  private logFilePath: string;

  constructor(logFilePath: string) {
    this.logFilePath = logFilePath;
  }

  logEntry(entry: UsageEntry): void {
    const jsonLine = JSON.stringify(entry) + '\n';
    appendFile(this.logFilePath, jsonLine, 'utf-8').catch(err => {
      console.error('Failed to write usage log:', err);
    });
  }

  async getEntries(): Promise<UsageEntry[]> {
    if (!existsSync(this.logFilePath)) {
      return [];
    }

    const content = await readFile(this.logFilePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    return lines.map(line => {
      try {
        return JSON.parse(line) as UsageEntry;
      } catch {
        return null;
      }
    }).filter((entry): entry is UsageEntry => entry !== null);
  }

  extractUsageFromAnthropicSSE(sseText: string, provider: string, model: string): UsageEntry | null {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let modelName = model;

    const lines = sseText.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const dataStr = line.slice(6);
      if (dataStr === '[DONE]') continue;

      try {
        const data = JSON.parse(dataStr);

        if (data.type === 'message_start' && data.message) {
          const usage = data.message.usage;
          if (usage) {
            inputTokens = usage.input_tokens || 0;
            cacheReadTokens = usage.cache_read_input_tokens || 0;
            cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          }
          if (data.message.model) {
            modelName = data.message.model;
          }
        }

        if (data.type === 'message_delta' && data.usage) {
          outputTokens = data.usage.output_tokens || 0;
        }
      } catch {
        continue;
      }
    }

    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0) {
      return null;
    }

    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

    return {
      timestamp: new Date().toISOString(),
      provider,
      model: modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens
    };
  }
}

export function createUsageTeeStream(
  provider: string,
  model: string,
  logger: UsageLogger
): TransformStream<Uint8Array, Uint8Array> {
  const chunks: Uint8Array[] = [];

  return new TransformStream({
    transform(chunk, controller) {
      chunks.push(chunk);
      controller.enqueue(chunk);
    },

    flush() {
      const bufferedText = Buffer.concat(chunks).toString('utf-8');
      const usage = logger.extractUsageFromAnthropicSSE(bufferedText, provider, model);

      if (usage) {
        logger.logEntry(usage);
      }
    }
  });
}
