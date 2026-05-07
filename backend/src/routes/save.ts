/**
 * Save routes — Phase 3.2 (FR-008).
 *
 *   GET    /                  → list saves with summary metadata
 *   POST   /:slotId           → create/overwrite a save (body = full payload)
 *   GET    /:slotId           → fetch the full save payload
 *   DELETE /:slotId           → remove a save
 *
 * Errors:
 *   - Invalid slotId / payload → 400 { error: 'invalid_request', issues }
 *   - Missing slot             → 404 { error: 'save_not_found', slotId }
 */

import { Hono } from 'hono';
import { SaveValidationError, SaveNotFoundError, type SaveService } from '@/services/SaveService';

export interface SaveRouteDeps {
  saveService: SaveService;
}

export const createSaveRoutes = ({ saveService }: SaveRouteDeps): Hono => {
  const app = new Hono();

  app.get('/', async (c) => {
    const slots = await saveService.list();
    return c.json({ slots });
  });

  app.post('/:slotId', async (c) => {
    const slotId = c.req.param('slotId');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'invalid_request', message: 'request body must be valid JSON' },
        400,
      );
    }

    try {
      const saved = await saveService.save(slotId, body);
      return c.json({ slotId, savedAt: saved.savedAt });
    } catch (err) {
      if (err instanceof SaveValidationError) {
        return c.json(
          {
            error: 'invalid_request',
            message: err.message,
            issues: err.issues,
          },
          400,
        );
      }
      throw err;
    }
  });

  app.get('/:slotId', async (c) => {
    const slotId = c.req.param('slotId');
    try {
      const payload = await saveService.load(slotId);
      return c.json(payload);
    } catch (err) {
      if (err instanceof SaveValidationError) {
        return c.json(
          {
            error: 'invalid_request',
            message: err.message,
            issues: err.issues,
          },
          400,
        );
      }
      if (err instanceof SaveNotFoundError) {
        return c.json({ error: 'save_not_found', slotId: err.slotId }, 404);
      }
      throw err;
    }
  });

  app.delete('/:slotId', async (c) => {
    const slotId = c.req.param('slotId');
    try {
      await saveService.del(slotId);
      return c.json({ slotId, deleted: true });
    } catch (err) {
      if (err instanceof SaveValidationError) {
        return c.json(
          {
            error: 'invalid_request',
            message: err.message,
            issues: err.issues,
          },
          400,
        );
      }
      if (err instanceof SaveNotFoundError) {
        return c.json({ error: 'save_not_found', slotId: err.slotId }, 404);
      }
      throw err;
    }
  });

  return app;
};
