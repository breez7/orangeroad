/**
 * Schedule routes — Phase 4.2 (FR-009 일과 시스템).
 *
 *   GET  /                    → list NPC ids with loaded schedules
 *   GET  /:id                 → full weekly schedule for one NPC
 *   POST /current             → bulk lookup of current schedule per NPC.
 *                               Body: { time: { hour, minute }, dayOfWeek }
 *                               → { schedules: { [npcId]: { locationId, activity } } }
 *
 * Errors:
 *   - Unknown NPC id → 404 { error: 'schedule_not_found', npcId }
 *   - Invalid request body → 400 { error: 'invalid_request', issues }
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  currentScheduleRequestSchema,
  type ScheduleService,
} from '@/services/ScheduleService';

export interface ScheduleRouteDeps {
  scheduleService: ScheduleService;
}

export const createScheduleRoutes = ({
  scheduleService,
}: ScheduleRouteDeps): Hono => {
  const app = new Hono();

  app.get('/', async (c) => {
    const ids = await scheduleService.listNPCIds();
    return c.json({ count: ids.length, npcs: ids });
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const schedule = await scheduleService.getSchedule(id);
    if (!schedule) {
      return c.json({ error: 'schedule_not_found', npcId: id }, 404);
    }
    return c.json(schedule);
  });

  app.post(
    '/current',
    zValidator('json', currentScheduleRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: 'invalid_request',
            message: 'schedule current request validation failed',
            issues: result.error.issues,
          },
          400,
        );
      }
      return undefined;
    }),
    async (c) => {
      const { time, dayOfWeek } = c.req.valid('json');
      const schedules = await scheduleService.getAllCurrentSchedules(
        time,
        dayOfWeek,
      );
      return c.json({ schedules });
    },
  );

  return app;
};
