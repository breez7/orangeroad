import { Hono } from 'hono';

export const npcRoutes = new Hono();

npcRoutes.get('/', (c) =>
  c.json({ status: 'not_implemented', phase: '1.2' }, 501),
);
