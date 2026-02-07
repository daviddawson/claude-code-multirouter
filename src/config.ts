import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface ProviderConfig {
  passthrough?: boolean;
  baseUrl?: string;
  apiKey?: string;
  authFile?: string;
  models?: string[];
}

export interface UsageConfig {
  logFile: string;
  costs: Record<string, { input: number; output: number }>;
}

export interface Config {
  port: number;
  providers: {
    anthropic?: ProviderConfig;
    cerebras?: ProviderConfig;
    codex?: ProviderConfig;
  };
  usage?: UsageConfig;
}

/**
 * Resolves tilde prefix to user home directory
 */
export function resolveHomePath(p: string): string {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Loads configuration from ~/.claude-code-router/config.json with sensible defaults
 */
export function loadConfig(): Config {
  const configPath = resolveHomePath('~/.claude-code-router/config.json');

  const defaults: Config = {
    port: 3456,
    providers: {
      anthropic: { passthrough: true },
      cerebras: {
        baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
        apiKey: '',
        models: ['qwen-3-235b-a22b-instruct-2507', 'zai-glm-4.7', 'gpt-oss-120b']
      },
      codex: {
        baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
        authFile: '~/.codex/auth.json',
        models: ['gpt-5.1-codex-mini', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.2-codex']
      }
    },
    usage: {
      logFile: '~/.claude-code-router/usage.jsonl',
      costs: {
        'qwen-3-235b-a22b-instruct-2507': { input: 0.60, output: 1.20 },
        'zai-glm-4.7': { input: 2.25, output: 2.75 },
        'gpt-oss-120b': { input: 0.35, output: 0.75 },
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
        'claude-haiku-4-5-20251001': { input: 0.80, output: 4 }
      }
    }
  };

  try {
    const rawConfig = readFileSync(configPath, 'utf-8');
    const parsedConfig = JSON.parse(rawConfig);

    return {
      ...defaults,
      ...parsedConfig,
      providers: {
        ...defaults.providers,
        ...parsedConfig.providers
      },
      usage: {
        ...defaults.usage,
        ...parsedConfig.usage
      }
    };
  } catch (error) {
    return defaults;
  }
}
