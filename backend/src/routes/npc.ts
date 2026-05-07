/**
 * NPC routes — Phase 2.2 (FR-002, FR-003).
 *
 *   GET    /                  → list known NPC ids
 *   GET    /:id/context       → recent dialog history (debug aid)
 *   DELETE /:id/context       → reset history (debug aid)
 *   POST   /:id/talk          → send a message, get an AI reply
 *
 * Errors:
 *   - LM Studio offline / errors → 503 { error: 'llm_unavailable', ... }
 *   - Unknown NPC id            → 404 { error: 'npc_not_found', ... }
 *   - Invalid body              → 400 { error: 'invalid_request', ... }
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { LLMError } from '@/ai/LLMClient';
import { NPCService, NPCNotFoundError } from '@/services/NPCService';

export interface NPCRouteDeps {
  npcService: NPCService;
}

const talkBodySchema = z.object({
  message: z.string().min(1, 'message must be a non-empty string').max(2000),
});

export const createNPCRoutes = ({ npcService }: NPCRouteDeps): Hono => {
  const app = new Hono();

  app.get('/', async (c) => {
    const ids = await npcService.listIds();
    return c.json({ count: ids.length, ids });
  });

  app.get('/:id/context', async (c) => {
    const id = c.req.param('id');
    try {
      // Touch profile so unknown ids get a clean 404.
      await npcService.loadProfile(id);
    } catch (err) {
      if (err instanceof NPCNotFoundError) {
        return c.json({ error: 'npc_not_found', npcId: id }, 404);
      }
      throw err;
    }
    const history = await npcService.getRecentHistory(id);
    return c.json({ npcId: id, history });
  });

  app.delete('/:id/context', async (c) => {
    const id = c.req.param('id');
    try {
      await npcService.loadProfile(id);
    } catch (err) {
      if (err instanceof NPCNotFoundError) {
        return c.json({ error: 'npc_not_found', npcId: id }, 404);
      }
      throw err;
    }
    await npcService.clearContext(id);
    return c.json({ npcId: id, cleared: true });
  });

  app.post(
    '/:id/talk',
    zValidator('json', talkBodySchema, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: 'invalid_request',
            message: 'request body validation failed',
            issues: result.error.issues,
          },
          400,
        );
      }
      return undefined;
    }),
    async (c) => {
      const id = c.req.param('id');
      const { message } = c.req.valid('json');

      try {
        const result = await npcService.talk({ npcId: id, message });
        return c.json(result);
      } catch (err) {
        if (err instanceof NPCNotFoundError) {
          return c.json({ error: 'npc_not_found', npcId: id }, 404);
        }
        if (err instanceof LLMError) {
          console.warn(`[npc/talk] LM Studio error (${err.kind}):`, err.message);
          return c.json(
            {
              error: 'llm_unavailable',
              message: err.message,
              kind: err.kind,
            },
            503,
          );
        }
        throw err;
      }
    },
  );

  return app;
};
