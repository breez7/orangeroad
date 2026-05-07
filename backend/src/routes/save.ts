import { Hono } from 'hono';

export const saveRoutes = new Hono();

saveRoutes.get('/', (c) =>
  c.json({ status: 'not_implemented', phase: '1.2' }, 501),
);
