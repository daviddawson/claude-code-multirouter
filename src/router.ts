import { Config } from './config.js';

export type RouteResult = {
  provider: 'anthropic' | 'cerebras' | 'codex';
  model: string;
};

/**
 * Extracts plain text from system prompt, handling both string and content block array formats
 */
export function getSystemPromptText(body: any): string {
  if (!body.system) {
    return '';
  }

  if (typeof body.system === 'string') {
    return body.system;
  }

  if (Array.isArray(body.system)) {
    return body.system
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');
  }

  return '';
}

function extractCCRTag(systemText: string): { provider: string; model: string } | null {
  const tagRegex = /<CCR-SUBAGENT-MODEL>([^,]+),([^<]+)<\/CCR-SUBAGENT-MODEL>/;
  const match = systemText.match(tagRegex);

  if (match) {
    return {
      provider: match[1].trim(),
      model: match[2].trim()
    };
  }

  return null;
}

function isModelInProviderList(model: string, providerModels?: string[]): boolean {
  if (!providerModels || !Array.isArray(providerModels)) {
    return false;
  }
  return providerModels.includes(model);
}

/**
 * Routes request to appropriate provider based on CCR tag, model name, or defaults to Anthropic
 */
export function routeRequest(body: any, config: Config): RouteResult {
  const systemText = getSystemPromptText(body);
  const ccrTag = extractCCRTag(systemText);

  if (ccrTag) {
    if (ccrTag.provider === 'cerebras') {
      return { provider: 'cerebras', model: ccrTag.model };
    }
    if (ccrTag.provider === 'codex') {
      return { provider: 'codex', model: ccrTag.model };
    }
  }

  const requestedModel = body.model || 'unknown';

  if (isModelInProviderList(requestedModel, config.providers.cerebras?.models)) {
    return { provider: 'cerebras', model: requestedModel };
  }

  if (isModelInProviderList(requestedModel, config.providers.codex?.models)) {
    return { provider: 'codex', model: requestedModel };
  }

  return { provider: 'anthropic', model: requestedModel };
}
