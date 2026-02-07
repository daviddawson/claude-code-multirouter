import Fastify from 'fastify';
import { loadConfig, resolveHomePath } from './config';
import { routeRequest } from './router';
import { UsageLogger } from './usage';
import { handleAnthropicRequest } from './providers/anthropic';
import { handleCerebrasRequest } from './providers/cerebras';
import { handleCodexRequest } from './providers/codex';
import { CodexAuth } from './codex-auth';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const app = Fastify({ bodyLimit: 50 * 1024 * 1024 });

app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as any).rawBody = body;
  try {
    done(null, JSON.parse(body.toString()));
  } catch {
    done(null, body);
  }
});

const config = loadConfig();
const usageLogger = new UsageLogger(resolveHomePath(config.usage?.logFile || '~/.claude-multi-proxy/usage.jsonl'));
const codexAuth = new CodexAuth(resolveHomePath(config.providers.codex?.authFile || '~/.claude-multi-proxy/codex-auth.json'));

app.post('/v1/messages', async (request, reply) => {
  const body = request.body as any;
  const route = routeRequest(body, config);

  console.log(`[proxy] ${route.provider} → ${route.model}`);

  reply.hijack();

  switch (route.provider) {
    case 'anthropic':
      await handleAnthropicRequest(request, reply, usageLogger);
      break;
    case 'cerebras':
      await handleCerebrasRequest(request, reply, config, usageLogger, route.model);
      break;
    case 'codex':
      await handleCodexRequest(request, reply, config, usageLogger, route.model, codexAuth);
      break;
  }
});

app.post('/v1/messages/count_tokens', async (request, reply) => {
  reply.hijack();
  await handleAnthropicRequest(request, reply, usageLogger);
});

app.get('/dashboard', async (request, reply) => {
  const dashboardPath = join(dirname(__dirname), 'dashboard.html');

  if (!existsSync(dashboardPath)) {
    reply.code(404).send('Dashboard not found');
    return;
  }

  const html = readFileSync(dashboardPath, 'utf-8');
  reply.type('text/html').send(html);
});

app.get('/api/usage', async (request, reply) => {
  const entries = await usageLogger.getEntries();
  reply
    .header('Access-Control-Allow-Origin', '*')
    .send({
      entries,
      costs: config.usage?.costs || {}
    });
});

const port = config.port || 3456;
app.listen({ port, host: '127.0.0.1' }).then(address => {
  console.log(`claude-multi-proxy listening on ${address}`);
  console.log(`  Anthropic: passthrough (OAuth preserved)`);
  console.log(`  Cerebras: ${config.providers.cerebras?.models?.join(', ') || 'none'}`);
  console.log(`  Codex: ${config.providers.codex?.models?.join(', ') || 'none'}`);
  console.log(`  Dashboard: http://127.0.0.1:${port}/dashboard`);
});
