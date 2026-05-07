import { Hono } from 'hono';

export const gameRoutes = new Hono();

gameRoutes.get('/state', (c) =>
  c.json({ status: 'not_implemented', phase: '1.2' }, 501),
);
