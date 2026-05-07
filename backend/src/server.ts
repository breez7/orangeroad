import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { gameRoutes } from '@/routes/game';
import { createNPCRoutes } from '@/routes/npc';
import { createSaveRoutes } from '@/routes/save';
import { LLMClient } from '@/ai/LLMClient';
import { ContextManager } from '@/ai/ContextManager';
import { NPCService } from '@/services/NPCService';
import { SaveStorage } from '@/storage/SaveStorage';
import { SaveService } from '@/services/SaveService';

const app = new Hono();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger());
}

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// --- Phase 2.2 wiring: build singletons once and inject into route factory.
const llmClient = new LLMClient();
const contextManager = new ContextManager();
const npcService = new NPCService(llmClient, contextManager);

// --- Phase 3.2 wiring: SaveStorage + SaveService for FR-008 save/load.
const saveStorage = new SaveStorage();
const saveService = new SaveService({ storage: saveStorage });

app.get('/', (c) =>
  c.json({ name: 'orangeroad-backend', version: '0.1.0', phase: '3.2' }),
);

app.get('/health', (c) =>
  c.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() }),
);

app.route('/game', gameRoutes);
app.route('/npc', createNPCRoutes({ npcService }));
app.route('/save', createSaveRoutes({ saveService }));

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[server] unhandled error:', err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};
