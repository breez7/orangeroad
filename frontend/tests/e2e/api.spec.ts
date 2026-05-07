/**
 * Backend API contract tests (issue #17).
 *
 * Drives the Hono backend on http://localhost:3001 directly — no browser, no
 * frontend. Each test category exercises one route group:
 *   - GET /                  — service identity
 *   - GET /health            — health probe
 *   - /npc/*                 — list, relationship, talk
 *   - /save/*                — round-trip a versioned save payload
 *   - /event/*               — list + eligibility check
 *   - /schedule/*            — list + bulk current-schedule lookup
 *
 * Concurrency note: tests run serially (`workers: 1` in playwright.config.ts)
 * because they mutate shared backend state (relationship files, save slots).
 * Within a file we still pick distinct NPCs / slot ids per test where
 * possible to avoid intra-file ordering brittleness.
 */
import { test, expect, request, type APIRequestContext } from '@playwright/test';

const BACKEND_URL = 'http://localhost:3001';
const KNOWN_NPC_IDS = [
  'hikaru',
  'kurumi',
  'madoka',
  'manta',
  'masumi',
  'seiko',
  'yusaku',
] as const;

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BACKEND_URL });
});

test.afterAll(async () => {
  await api.dispose();
});

// ---- Identity / health ----------------------------------------------------

test.describe('Service identity', () => {
  test('GET / returns backend metadata', async () => {
    const res = await api.get('/');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: 'orangeroad-backend',
      version: '0.1.0',
    });
    // Phase string is intentionally a regex match — it bumps over time.
    expect(typeof body.phase).toBe('string');
    expect(body.phase).toMatch(/^\d+\.\d+(?:\.\d+)?$/);
  });

  test('GET /health returns ok + uptime + timestamp', async () => {
    const res = await api.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('number');
    expect(body.timestamp).toBeGreaterThan(0);
  });

  test('GET /unknown-path returns 404 not_found', async () => {
    const res = await api.get('/this-does-not-exist');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });
});

// ---- NPC routes -----------------------------------------------------------

test.describe('NPC routes', () => {
  test('GET /npc lists 7 known ids (kyousuke excluded)', async () => {
    const res = await api.get('/npc');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(KNOWN_NPC_IDS.length);
    expect([...body.ids].sort()).toEqual([...KNOWN_NPC_IDS].sort());
    // The player must NOT appear in the public roster.
    expect(body.ids).not.toContain('kyousuke');
  });

  test('GET /npc/madoka/relationship — fresh state is 60/neutral', async () => {
    // Reset first so prior tests can't leave us at a non-default value.
    const reset = await api.delete('/npc/madoka/relationship');
    expect(reset.status()).toBe(200);

    const res = await api.get('/npc/madoka/relationship');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      npcId: 'madoka',
      affinity: 60,
      emotion: 'neutral',
    });
    expect(typeof body.lastUpdated).toBe('number');
  });

  test('GET /npc/nobody/relationship → 404 npc_not_found', async () => {
    const res = await api.get('/npc/nobody/relationship');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('npc_not_found');
    expect(body.npcId).toBe('nobody');
  });

  test('POST /npc/seiko/talk — happy path round-trips through mock LM', async () => {
    // Use seiko (not madoka) to avoid racing with the relationship test above.
    await api.delete('/npc/seiko/relationship');
    await api.delete('/npc/seiko/context');

    const res = await api.post('/npc/seiko/talk', {
      data: { message: '안녕' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.npcId).toBe('seiko');
    expect(typeof body.response).toBe('string');
    expect(body.response.length).toBeGreaterThan(0);
    expect(Array.isArray(body.history)).toBe(true);
    // Last user turn must be the message we sent.
    const lastUser = [...body.history].reverse().find((h: { role: string }) => h.role === 'user');
    expect(lastUser?.content).toBe('안녕');
    expect(typeof body.affinityChange).toBe('number');
    expect(['neutral', 'happy', 'sad', 'angry', 'shy', 'flirty', 'annoyed']).toContain(
      body.emotionUpdate,
    );
    expect(body.relationship).toBeTruthy();
    expect(body.relationship.npcId).toBe('seiko');
    expect(typeof body.relationship.affinity).toBe('number');
  });

  test('POST /npc/madoka/talk with empty body → 400 invalid_request', async () => {
    const res = await api.post('/npc/madoka/talk', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  test('POST /npc/madoka/talk with empty string → 400 invalid_request', async () => {
    const res = await api.post('/npc/madoka/talk', { data: { message: '' } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  test('POST /npc/nobody/talk → 404 npc_not_found', async () => {
    const res = await api.post('/npc/nobody/talk', { data: { message: '안녕' } });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('npc_not_found');
    expect(body.npcId).toBe('nobody');
  });

  test('POST /npc/kyousuke/talk → 404 (player rejected)', async () => {
    const res = await api.post('/npc/kyousuke/talk', {
      data: { message: '안녕' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('npc_not_found');
  });

  test('DELETE /npc/nobody/relationship → 404 npc_not_found', async () => {
    const res = await api.delete('/npc/nobody/relationship');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('npc_not_found');
    expect(body.npcId).toBe('nobody');
  });

  test('POST /npc/seiko/talk with LM offline → 503 llm_unavailable', async () => {
    // The mock LM returns 503 when the message is __LM_OFFLINE__, which
    // triggers the backend's LLMError → 503 path.
    await api.delete('/npc/seiko/relationship').catch(() => {});
    await api.delete('/npc/seiko/context').catch(() => {});
    const res = await api.post('/npc/seiko/talk', {
      data: { message: '__LM_OFFLINE__' },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('llm_unavailable');
    expect(typeof body.message).toBe('string');
  });
});

// ---- Save routes ----------------------------------------------------------

const VALID_SAVE_PAYLOAD = {
  version: 1 as const,
  savedAt: Date.now(),
  label: 'api-test',
  phase: '5.3',
  time: {
    day: 1,
    hour: 9,
    minute: 30,
    dayOfWeek: 'MON' as const,
    phaseLabel: '오전 수업',
  },
  playerPosition: { x: 640, y: 360 },
  npcs: {
    madoka: {
      id: 'madoka',
      name: '마도카',
      locationId: 'school',
      position: { x: 970, y: 180 },
    },
  },
  currentLocationId: null,
};

test.describe('Save routes', () => {
  // Use a slot id distinct from the playthrough test's slot1 so the two
  // suites don't fight over the same file.
  const SLOT = 'apitest';

  test.beforeAll(async () => {
    // Best-effort cleanup so we start each run from a known baseline. 404 is
    // expected when the slot doesn't exist yet.
    await api.delete(`/save/${SLOT}`);
  });

  test('POST /save/:slot with valid payload — round-trip', async () => {
    const post = await api.post(`/save/${SLOT}`, { data: VALID_SAVE_PAYLOAD });
    expect(post.status()).toBe(200);
    const created = await post.json();
    expect(created.slotId).toBe(SLOT);
    expect(typeof created.savedAt).toBe('number');

    const get = await api.get(`/save/${SLOT}`);
    expect(get.status()).toBe(200);
    const fetched = await get.json();
    expect(fetched.version).toBe(1);
    expect(fetched.label).toBe('api-test');
    expect(fetched.playerPosition).toEqual({ x: 640, y: 360 });
    expect(fetched.time.dayOfWeek).toBe('MON');
  });

  test('GET /save lists the freshly written slot', async () => {
    const res = await api.get('/save');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.slots)).toBe(true);
    const ours = body.slots.find((s: { slotId: string }) => s.slotId === SLOT);
    expect(ours).toBeTruthy();
    expect(ours.label).toBe('api-test');
    expect(ours.phase).toBe('5.3');
  });

  test('DELETE /save/:slot then GET → 404', async () => {
    const del = await api.delete(`/save/${SLOT}`);
    expect(del.status()).toBe(200);
    const body = await del.json();
    expect(body.deleted).toBe(true);

    const after = await api.get(`/save/${SLOT}`);
    expect(after.status()).toBe(404);
    const errBody = await after.json();
    expect(errBody.error).toBe('save_not_found');
  });

  test('POST /save/:slot with malformed payload → 400 invalid_request', async () => {
    const res = await api.post('/save/badpayload', {
      data: { version: 99, savedAt: 'not-a-number' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  // Phase QA-2: confirm the v2 schema landed in #23 actually round-trips
  // through the backend. Without this, the FE's `currentScene` slice could
  // silently regress and we'd only notice on a player loading an indoor save.
  test('POST /save/:slot with v2 indoor payload — currentScene round-trips', async () => {
    const SLOT_V2 = 'apitest-v2';
    await api.delete(`/save/${SLOT_V2}`);
    const v2Payload = {
      ...VALID_SAVE_PAYLOAD,
      version: 2 as const,
      savedAt: Date.now(),
      label: 'api-test-v2',
      currentScene: { kind: 'indoor' as const, sceneId: 'cafe' },
    };
    const post = await api.post(`/save/${SLOT_V2}`, { data: v2Payload });
    expect(post.status()).toBe(200);

    const get = await api.get(`/save/${SLOT_V2}`);
    expect(get.status()).toBe(200);
    const fetched = await get.json();
    expect(fetched.version).toBe(2);
    expect(fetched.currentScene).toEqual({ kind: 'indoor', sceneId: 'cafe' });
    expect(fetched.label).toBe('api-test-v2');

    await api.delete(`/save/${SLOT_V2}`);
  });

  test('POST /save/:slot with v2 outdoor payload — outdoor kind preserved', async () => {
    const SLOT_V2_OUT = 'apitest-v2-out';
    await api.delete(`/save/${SLOT_V2_OUT}`);
    const v2Payload = {
      ...VALID_SAVE_PAYLOAD,
      version: 2 as const,
      savedAt: Date.now(),
      label: 'api-test-v2-out',
      currentScene: { kind: 'outdoor' as const },
    };
    const post = await api.post(`/save/${SLOT_V2_OUT}`, { data: v2Payload });
    expect(post.status()).toBe(200);

    const get = await api.get(`/save/${SLOT_V2_OUT}`);
    expect(get.status()).toBe(200);
    const fetched = await get.json();
    expect(fetched.version).toBe(2);
    expect(fetched.currentScene).toEqual({ kind: 'outdoor' });

    await api.delete(`/save/${SLOT_V2_OUT}`);
  });

  test('POST /save/:slot with non-JSON body → 400 invalid_request', async () => {
    const res = await api.post('/save/badjson', {
      headers: { 'Content-Type': 'application/json' },
      data: '{not-json',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  test('DELETE /save/:slot for missing slot → 404', async () => {
    const res = await api.delete('/save/this-slot-does-not-exist-zzz');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('save_not_found');
  });
});

// ---- Event routes ---------------------------------------------------------

test.describe('Event routes', () => {
  test('GET /event lists the 2 known events', async () => {
    const res = await api.get('/event');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    const ids = body.events.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual(['intro_move_in', 'madoka_first_chat']);
  });

  test('POST /event/intro_move_in/eligible — clean state is eligible', async () => {
    const res = await api.post('/event/intro_move_in/eligible', {
      data: {
        flags: {},
        fireHistory: [],
        time: {
          day: 1,
          hour: 8,
          minute: 0,
          dayOfWeek: 'MON',
          phaseLabel: '오전 수업',
        },
        location: null,
        affinities: { madoka: 60 },
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(true);
  });

  test('POST /event/intro_move_in/eligible — already-fired returns ineligible', async () => {
    const res = await api.post('/event/intro_move_in/eligible', {
      data: {
        flags: { intro_complete: true },
        fireHistory: ['intro_move_in'],
        time: null,
        location: null,
        affinities: {},
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(false);
  });

  test('POST /event/no_such_event/eligible → 404 event_not_found', async () => {
    const res = await api.post('/event/no_such_event/eligible', {
      data: {
        flags: {},
        fireHistory: [],
        affinities: {},
      },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('event_not_found');
  });

  test('GET /event/intro_move_in returns the full script', async () => {
    const res = await api.get('/event/intro_move_in');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('intro_move_in');
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps.length).toBeGreaterThan(0);
  });
});

// ---- Schedule routes ------------------------------------------------------

test.describe('Schedule routes', () => {
  test('GET /schedule lists 8 ids (player included)', async () => {
    const res = await api.get('/schedule');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(8);
    expect(Array.isArray(body.npcs)).toBe(true);
    expect(body.npcs).toContain('madoka');
    // The schedule routes include the player too — useful for HUD.
    expect(body.npcs).toContain('kyousuke');
  });

  test('POST /schedule/current MON 09:00 → all NPCs at school', async () => {
    const res = await api.post('/schedule/current', {
      data: {
        time: { hour: 9, minute: 0 },
        dayOfWeek: 'MON',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.schedules).toBeTruthy();
    expect(body.schedules.madoka.locationId).toBe('school');
    // Hikaru / yusaku also at school during morning class. The exact set
    // depends on data/schedules/*.json — we only assert madoka here to keep
    // the fixture coupling minimal.
  });

  test('POST /schedule/current with invalid body → 400 invalid_request', async () => {
    const res = await api.post('/schedule/current', {
      data: { time: 'not-an-object' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  test('GET /schedule/madoka returns weekly schedule', async () => {
    const res = await api.get('/schedule/madoka');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('madoka');
    expect(Array.isArray(body.weekly)).toBe(true);
    expect(body.weekly.length).toBeGreaterThan(0);
  });

  test('GET /schedule/nobody → 404 schedule_not_found', async () => {
    const res = await api.get('/schedule/nobody');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('schedule_not_found');
  });
});
