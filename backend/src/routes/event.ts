/**
 * Event routes — Phase 4.1 (FR-006).
 *
 *   GET  /                    → list event metadata (id, title, trigger, once)
 *   GET  /:id                 → full validated event JSON (including steps)
 *   POST /:id/eligible        → ask "would this event fire right now?" given
 *                               { flags, fireHistory, time, location, affinities }.
 *                               Returns { eligible: boolean, reasons: string[] }.
 *
 * Errors:
 *   - Unknown event id   → 404 { error: 'event_not_found', eventId }
 *   - Invalid eligibility body → 400 { error: 'invalid_request', issues }
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  eligibilityStateSchema,
  type EventService,
} from '@/services/EventService';

export interface EventRouteDeps {
  eventService: EventService;
}

export const createEventRoutes = ({ eventService }: EventRouteDeps): Hono => {
  const app = new Hono();

  app.get('/', async (c) => {
    const events = await eventService.listEvents();
    return c.json({ count: events.length, events });
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const event = await eventService.getEvent(id);
    if (!event) {
      return c.json({ error: 'event_not_found', eventId: id }, 404);
    }
    return c.json(event);
  });

  app.post(
    '/:id/eligible',
    zValidator('json', eligibilityStateSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: 'invalid_request',
            message: 'eligibility state validation failed',
            issues: result.error.issues,
          },
          400,
        );
      }
      return undefined;
    }),
    async (c) => {
      const id = c.req.param('id');
      const state = c.req.valid('json');
      const result = await eventService.evaluateOne(id, state);
      // 404 only when the id is unknown — otherwise return 200 + eligible:false.
      if (!result.eligible && result.reasons[0]?.startsWith('event_not_found:')) {
        return c.json({ error: 'event_not_found', eventId: id }, 404);
      }
      return c.json(result);
    },
  );

  return app;
};
