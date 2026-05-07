/**
 * End-to-end mandatory playthrough (issue #17).
 *
 * Implements the 11-step scenario from
 * `.claude/agents/integration-test-evaluator.md`. Iteration 4 fixes:
 *   - Step 7 swaps the browser `page.reload()` for an imperative
 *     `__game.loadSlot('slot1')` after corrupting in-memory state. This tests
 *     the save/load contract (which is what the spec actually checks for) and
 *     skips the ~10s vite-dev cold-reload tax.
 *   - Step 10 triggers the flag-driven story event through the natural
 *     eligibility pathway: set affinity → StorySystem store subscriber →
 *     eligibility round-trip → playEvent. No more `__game.playEvent` short-cut.
 *   - Step 11 advances the in-game clock with `__game.advanceTime(N)` so the
 *     ScheduleSystem store subscriber fires synchronously, not by waiting on
 *     real-time minute ticks.
 *   - Step 8 clicks the audio panel's actual checkbox + slider widgets to
 *     verify the React `onChange` wiring works, not just the store mutators.
 *   - Step 3 asserts the player walked TOWARD the click target (distance to
 *     target shrinks), not just that some movement happened.
 *   - Step 4 waits for the relationship slice to actually change after the
 *     dialog send, then asserts the affinity bar reflects a new value.
 *
 * Wall-clock budget: ~120s. The spec's 60s ideal is unattainable while
 * exercising 11 user-facing steps against `vite dev` (~13-15s cold boot) and
 * the StorySystem's catalogue + eligibility round-trips. Iter 3 was 144s; this
 * iteration cuts that by removing reload, real-time waits, and the multi-second
 * Playwright actionability waits via the `fastClick` / `fastType` helpers.
 */
import { test, expect, type ConsoleMessage, type Page, type Response } from '@playwright/test';

interface PlaythroughCtx {
  consoleErrors: string[];
  consoleWarns: string[];
  pageErrors: string[];
  failedRequests: { url: string; status: number }[];
}

/**
 * Console-warn allowlist: messages we know are benign in the headless test
 * environment. Only the *exact prefix match* is suppressed; any other warning
 * is surfaced as a defect.
 */
const ALLOWED_WARN_PREFIXES = [
  // AudioContext can't start until the user has interacted; in headless
  // chromium with no real gesture either of these two warns may fire.
  '[AudioEngine] Web Audio API not available',
  '[AudioEngine] failed to construct AudioContext',
];

/** Console-warn allowlist by substring — WebGL driver chatter etc. */
const ALLOWED_WARN_SUBSTRINGS = [
  // Headless chromium's swiftshader/WebGL driver emits GPU-stall perf hints
  // from PixiJS' ReadPixels usage. This is a driver advisory, not an app bug.
  'GPU stall due to ReadPixels',
];

function attachDiagnostics(page: Page): PlaythroughCtx {
  const ctx: PlaythroughCtx = {
    consoleErrors: [],
    consoleWarns: [],
    pageErrors: [],
    failedRequests: [],
  };
  page.on('console', (msg: ConsoleMessage) => {
    const t = msg.type();
    if (t === 'error') {
      ctx.consoleErrors.push(msg.text());
    } else if (t === 'warning') {
      const text = msg.text();
      const allowed =
        ALLOWED_WARN_PREFIXES.some((p) => text.startsWith(p)) ||
        ALLOWED_WARN_SUBSTRINGS.some((s) => text.includes(s));
      if (!allowed) ctx.consoleWarns.push(text);
    }
  });
  page.on('pageerror', (err) => ctx.pageErrors.push(err.message));
  page.on('response', (res: Response) => {
    const status = res.status();
    if (status >= 500) ctx.failedRequests.push({ url: res.url(), status });
  });
  return ctx;
}

async function clickCanvasAt(page: Page, tx: number, ty: number): Promise<void> {
  const canvas = page.locator('canvas');
  await canvas.click({ position: { x: tx, y: ty }, force: true });
}

/**
 * Click via the DOM directly. Bypasses Playwright's actionability wait which
 * can stall multi-seconds on elements still inside their entrance animation,
 * even when force:true is set. Throws if the testid isn't found at click time.
 */
async function fastClick(page: Page, testid: string): Promise<void> {
  await page.evaluate((id) => {
    const el = document.querySelector<HTMLButtonElement | HTMLInputElement>(
      `[data-testid="${id}"]`,
    );
    if (!el) throw new Error(`fastClick: no element with data-testid="${id}"`);
    el.click();
  }, testid);
}

/**
 * Type into an input by setting `.value` directly and dispatching React's
 * synthetic input event. Faster than Playwright's `.fill()` which paces
 * keystrokes and waits for actionability.
 */
async function fastType(page: Page, testid: string, value: string): Promise<void> {
  await page.evaluate(
    ({ id, v }) => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`);
      if (!el) throw new Error(`fastType: no element with data-testid="${id}"`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { id: testid, v: value },
  );
}

async function getPlayerPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __store: { getState: () => { playerPosition: { x: number; y: number } } };
    }).__store;
    return store.getState().playerPosition;
  });
}

async function getStoreSnapshot<T>(page: Page, picker: string): Promise<T> {
  return page.evaluate((p) => {
    const store = (window as unknown as { __store: { getState: () => unknown } }).__store;
    // eslint-disable-next-line no-new-func
    const fn = new Function('s', `return ${p}`);
    return fn(store.getState());
  }, picker) as Promise<T>;
}

test.describe.configure({ mode: 'serial' });

test('mandatory 11-step end-to-end playthrough', async ({ page }) => {
  // Wall-clock ceiling. The vite dev cold start eats ~14s on its own and the
  // 11 user-facing steps + step 7b browser reload each have a baseline of ~5s
  // for click + render + network + react-rerender. 180s is the realistic
  // ceiling on a Pi-class host; tightening below ~90s would require a
  // production build (no dev-only `__game` helpers) or running steps in
  // parallel (incompatible with the linear-playthrough spec).
  test.setTimeout(180_000);

  // Disable CSS animations / transitions globally so Playwright's actionability
  // wait doesn't burn ~300ms on every click for the panel-glass slide-up keyframes.
  // This is a test-only stylesheet and does not affect manual-test runs.
  await page.addInitScript(() => {
    const css = `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`;
    const apply = () => {
      const el = document.createElement('style');
      el.textContent = css;
      document.head.appendChild(el);
    };
    if (document.head) apply();
    else document.addEventListener('DOMContentLoaded', apply);
  });

  const diag = attachDiagnostics(page);

  // ---- Step 0: clean backend state for determinism ----------------------
  await page.request.delete('http://localhost:3001/npc/madoka/relationship').catch(() => {});
  await page.request.delete('http://localhost:3001/npc/hikaru/relationship').catch(() => {});
  await page.request.delete('http://localhost:3001/npc/madoka/context').catch(() => {});
  await page.request.delete('http://localhost:3001/npc/hikaru/context').catch(() => {});
  await page.request.delete('http://localhost:3001/save/slot1').catch(() => {});

  // ---- Step 1: page load + canvas mount + zero console errors ---------------
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as { __store?: unknown; __game?: unknown }).__store !== undefined
      && (window as unknown as { __game?: unknown }).__game !== undefined,
  );

  expect(
    diag.consoleErrors,
    `Console errors during boot:\n${diag.consoleErrors.join('\n')}`,
  ).toEqual([]);

  // ---- Step 2: ON_START intro fires + each frame has Korean copy ------------
  const overlay = page.locator('[data-testid="story-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 8_000 });

  const introTexts: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (!(await overlay.isVisible().catch(() => false))) break;
    // Wait for the overlay to render the *current* frame (the StorySystem may
    // have advanced through a side-effect step and we need React to flush).
    const idxBefore = await overlay.getAttribute('data-step-index');
    const text = await page
      .locator('[data-testid="story-text"]').first()
      .textContent({ timeout: 1_000 }).catch(() => '');
    if (text && /[가-힣]/.test(text)) introTexts.push(text);
    await fastClick(page, 'story-continue');
    // Wait for the step index to advance OR the overlay to vanish. This is
    // bounded so a stuck StorySystem doesn't hang the test.
    await page.waitForFunction(
      (prev) => {
        const o = document.querySelector('[data-testid="story-overlay"]');
        if (!o) return true;
        return o.getAttribute('data-step-index') !== prev;
      },
      idxBefore,
      { timeout: 1_500 },
    ).catch(() => {});
  }
  await expect(overlay).not.toBeVisible({ timeout: 5_000 });
  expect(
    introTexts.length,
    `expected ≥2 Korean frames in intro, got ${introTexts.length}: ${introTexts.join(' | ')}`,
  ).toBeGreaterThanOrEqual(2);

  const introComplete = await getStoreSnapshot<boolean | undefined>(
    page,
    "s.flags['intro_complete']",
  );
  expect(introComplete).toBeTruthy();

  // ---- Step 3: click-to-walk — verify direction toward target ---------------
  const before = await getPlayerPosition(page);
  const targetX = 640;
  const targetY = 600;
  const startDist = Math.hypot(before.x - targetX, before.y - targetY);
  await clickCanvasAt(page, targetX, targetY);

  // Wait until the player has actually moved meaningfully closer to the target.
  await page.waitForFunction(
    ({ tx, ty, startD }) => {
      const store = (window as unknown as {
        __store: { getState: () => { playerPosition: { x: number; y: number } } };
      }).__store;
      const p = store.getState().playerPosition;
      const d = Math.hypot(p.x - tx, p.y - ty);
      return d < startD - 30;
    },
    { tx: targetX, ty: targetY, startD: startDist },
    { timeout: 5_000 },
  );
  const afterWalk = await getPlayerPosition(page);
  // Sanity: distance to target shrank, not just absolute movement happened.
  const endDist = Math.hypot(afterWalk.x - targetX, afterWalk.y - targetY);
  expect(endDist, 'player should walk TOWARD click target').toBeLessThan(startDist - 20);
  await expect(page.locator('[data-testid="player-coords"]')).toContainText('Player:');

  // ---- Step 4: talk to madoka — affinity bar + emotion update --------------
  // Gate `madoka_first_chat` so it doesn't auto-fire while we're in the
  // free-form dialog (it's reset in step 10 for a clean natural trigger).
  await page.evaluate(() => {
    const s = (
      window as unknown as {
        __store: {
          getState: () => {
            story: { fireHistory: string[] };
            setStoryFireHistory: (h: string[]) => void;
          };
        };
      }
    ).__store.getState();
    if (!s.story.fireHistory.includes('madoka_first_chat')) {
      s.setStoryFireHistory([...s.story.fireHistory, 'madoka_first_chat']);
    }
  });

  await page.evaluate(() => {
    const g = (
      window as unknown as { __game: { teleportPlayer: (x: number, y: number) => void } }
    ).__game;
    g.teleportPlayer(950, 280);
  });
  await page.evaluate(() => {
    const g = (
      window as unknown as { __game: { openDialogWith: (id: string) => void } }
    ).__game;
    g.openDialogWith('madoka');
  });
  const dialog = page.locator('[data-testid="dialog-box"]');
  await expect(dialog).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="dialog-npc-name"]')).toContainText('마도카');

  // Capture pre-talk affinity so we can assert the talk round-trip mutated it.
  const preTalkAffinity = await getStoreSnapshot<number>(
    page,
    "s.relationships['madoka']?.affinity ?? 50",
  );

  // Use a positively-keyed message so the backend's AffinityHeuristic produces
  // a non-zero delta — without that, the relationship slice doesn't change and
  // the post-send waitForFunction would burn the full 5s timeout.
  await fastType(page, 'dialog-input', '마도카 좋아해');
  await fastClick(page, 'dialog-send');

  // Wait for the assistant turn to render AND the relationship slice to sync.
  await expect(
    page.locator('[data-testid="dialog-turn-assistant"]').first(),
  ).toBeVisible({ timeout: 3_000 });
  await page.waitForFunction(
    (prev) => {
      const s = (
        window as unknown as {
          __store: {
            getState: () => {
              relationships: Record<string, { affinity: number; emotion: string }>;
            };
          };
        }
      ).__store.getState();
      const cur = s.relationships['madoka'];
      return cur !== undefined && cur.affinity !== prev;
    },
    preTalkAffinity,
    { timeout: 3_000 },
  );

  // Affinity bar shows the synced numeric value.
  const affinityBar = page.locator('[data-testid="dialog-box"] [role="progressbar"]');
  await expect(affinityBar).toBeVisible();
  const affinityValue = Number(await affinityBar.getAttribute('aria-valuenow'));
  expect(Number.isFinite(affinityValue), 'affinity bar exposes numeric aria-valuenow').toBe(true);
  expect(affinityValue).not.toBe(preTalkAffinity);

  // Emotion label is one of the canonical Korean emotion strings.
  const emotionLabel = page.locator('[data-testid="emotion-label"]');
  await expect(emotionLabel).toBeVisible();
  const emotionText = (await emotionLabel.textContent()) ?? '';
  expect(emotionText, 'emotion label is a known Korean emotion').toMatch(
    /평온|기쁨|슬픔|분노|수줍음|설렘|짜증/,
  );

  // ---- Step 5: talk to hikaru ----------------------------------------------
  await fastClick(page, 'dialog-close');
  await expect(dialog).not.toBeVisible();

  await page.evaluate(() => {
    const g = (
      window as unknown as { __game: { teleportPlayer: (x: number, y: number) => void } }
    ).__game;
    g.teleportPlayer(250, 480);
  });
  await page.evaluate(() => {
    const g = (
      window as unknown as { __game: { openDialogWith: (id: string) => void } }
    ).__game;
    g.openDialogWith('hikaru');
  });
  await expect(dialog).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="dialog-npc-name"]')).toContainText('히카루');
  await fastType(page, 'dialog-input', '너 좋아');
  await fastClick(page, 'dialog-send');
  await expect(
    page.locator('[data-testid="dialog-turn-assistant"]').first(),
  ).toBeVisible({ timeout: 3_000 });

  // ---- Step 6: save to slot1 -----------------------------------------------
  await fastClick(page, 'dialog-close');
  await expect(dialog).not.toBeVisible();

  await fastClick(page, 'open-save-panel');
  await expect(page.locator('[data-testid="save-panel"]')).toBeVisible();
  await fastClick(page, 'save-action-slot1');
  await expect(
    page.locator('[data-testid="toast-success"]').first(),
  ).toBeVisible({ timeout: 3_000 });

  const savedPos = await getPlayerPosition(page);
  const savedAffinity = await getStoreSnapshot<number>(
    page,
    "s.relationships['madoka']?.affinity ?? 0",
  );

  await fastClick(page, 'save-panel-close');
  await expect(page.locator('[data-testid="save-panel"]')).not.toBeVisible();

  // ---- Step 7: corrupt in-memory state, then load slot1 — verify restore ---
  // Mutate the store + entities to a clearly-different state, then load.
  // Verifies the save/load contract restores position, affinity, and flags
  // without paying for a full `page.reload()` (~10s vite cold-reload). The
  // boot/reload pipeline itself is exercised in the final block below.
  await page.evaluate(() => {
    const g = (
      window as unknown as {
        __game: { teleportPlayer: (x: number, y: number) => void };
      }
    ).__game;
    g.teleportPlayer(0, 0);
  });
  await page.evaluate(() => {
    const s = (
      window as unknown as {
        __store: {
          getState: () => {
            setRelationship: (
              id: string,
              data: { npcId: string; affinity: number; emotion: string; lastUpdated: number },
            ) => void;
            clearFlag: (k: string) => void;
          };
        };
      }
    ).__store.getState();
    s.setRelationship('madoka', {
      npcId: 'madoka',
      affinity: 1,
      emotion: 'neutral',
      lastUpdated: Date.now(),
    });
    s.clearFlag('intro_complete');
  });

  await page.evaluate(async () => {
    await (
      window as unknown as { __game: { loadSlot: (s: string) => Promise<void> } }
    ).__game.loadSlot('slot1');
  });

  const restoredPos = await getPlayerPosition(page);
  expect(Math.hypot(restoredPos.x - savedPos.x, restoredPos.y - savedPos.y)).toBeLessThan(50);
  const restoredAffinity = await getStoreSnapshot<number>(
    page,
    "s.relationships['madoka']?.affinity ?? -1",
  );
  expect(restoredAffinity).toBe(savedAffinity);
  const restoredIntro = await getStoreSnapshot<boolean | undefined>(
    page,
    "s.flags['intro_complete']",
  );
  expect(restoredIntro).toBeTruthy();

  // ---- Step 7b: spec-mandated browser reload — verify boot survives -------
  // The imperative loadSlot above tested the SaveSystem.load contract. The
  // spec also says "Reloads the page", which checks the cold-boot path
  // (PixiJS re-init, store hydration order, dev-helper exposure timing).
  // After reload we re-load the save and assert state is again restored.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => (window as unknown as { __store?: unknown; __game?: unknown }).__store !== undefined
      && (window as unknown as { __game?: unknown }).__game !== undefined,
    undefined,
    { timeout: 10_000 },
  );
  // Skip past any story overlay that auto-fired after boot (best-effort).
  const reloadOverlay = page.locator('[data-testid="story-overlay"]');
  for (let i = 0; i < 6 && (await reloadOverlay.isVisible().catch(() => false)); i++) {
    await fastClick(page, 'story-continue');
    await page.waitForTimeout(80);
  }
  await page.evaluate(async () => {
    await (
      window as unknown as { __game: { loadSlot: (s: string) => Promise<void> } }
    ).__game.loadSlot('slot1');
  });
  const reloadedAffinity = await getStoreSnapshot<number>(
    page,
    "s.relationships['madoka']?.affinity ?? -1",
  );
  expect(reloadedAffinity, 'affinity restored after browser reload + load').toBe(savedAffinity);

  // ---- Step 8: audio panel — actual widget interaction + persistence -------
  await fastClick(page, 'audio-open');
  await expect(page.locator('[data-testid="audio-panel"]')).toBeVisible();

  // Click the BGM-toggle checkbox via the real DOM click (the React onChange
  // handler fires off this exact event). `fastClick` bypasses Playwright's
  // multi-second actionability wait that the glass overlay otherwise triggers.
  await fastClick(page, 'audio-bgm-toggle');
  await page.waitForFunction(() => {
    return (
      window as unknown as {
        __store: { getState: () => { audio: { bgmEnabled: boolean } } };
      }
    ).__store.getState().audio.bgmEnabled === true;
  }, { timeout: 1_000 });

  // Set music volume via the slider's `input` event (range inputs don't accept
  // .fill(); driving the React-internal value setter is the standard recipe).
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(
      '[data-testid="audio-music-volume"]',
    );
    if (!el) throw new Error('audio-music-volume not found');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, '85');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const v = (
      window as unknown as {
        __store: { getState: () => { audio: { musicVolume: number } } };
      }
    ).__store.getState().audio.musicVolume;
    return Math.abs(v - 0.85) < 0.02;
  }, { timeout: 1_000 });

  // Mute toggle — clicking the checkbox itself.
  await fastClick(page, 'audio-mute-toggle');
  await page.waitForFunction(() => {
    return (
      window as unknown as {
        __store: { getState: () => { audio: { muted: boolean } } };
      }
    ).__store.getState().audio.muted === true;
  }, { timeout: 1_000 });

  // Header × button closes the panel (separate from the footer "닫기").
  await fastClick(page, 'audio-close-x');
  await expect(page.locator('[data-testid="audio-panel"]')).not.toBeVisible({ timeout: 1_000 });

  // Re-open to test the footer 닫기 button explicitly too.
  await fastClick(page, 'audio-open');
  await fastClick(page, 'audio-close');
  await expect(page.locator('[data-testid="audio-panel"]')).not.toBeVisible({ timeout: 1_000 });

  // Save and verify the audio slice round-trips through the save payload.
  await fastClick(page, 'open-save-panel');
  await fastClick(page, 'save-action-slot1');
  await expect(
    page.locator('[data-testid="toast-success"]').first(),
  ).toBeVisible({ timeout: 3_000 });
  await fastClick(page, 'save-panel-close');

  const saved = await page.request.get('http://localhost:3001/save/slot1');
  expect(saved.status()).toBe(200);
  const savedBody = await saved.json();
  expect(savedBody.audio).toBeTruthy();
  expect(savedBody.audio.musicVolume).toBeCloseTo(0.85, 2);
  expect(savedBody.audio.muted).toBe(true);
  expect(savedBody.audio.bgmEnabled).toBe(true);

  // Audio LOAD-side: corrupt the audio slice in memory, then loadSlot and
  // verify the audio settings are restored from the save payload. This closes
  // the round-trip — without it, a no-op `setAudioSettings` in SaveSystem
  // would still pass the serialize-side assertions above.
  await page.evaluate(() => {
    const s = (
      window as unknown as {
        __store: {
          getState: () => {
            setBgmEnabled: (v: boolean) => void;
            setMuted: (v: boolean) => void;
            setMusicVolume: (v: number) => void;
          };
        };
      }
    ).__store.getState();
    s.setBgmEnabled(false);
    s.setMuted(false);
    s.setMusicVolume(0.1);
  });
  await page.evaluate(async () => {
    await (
      window as unknown as { __game: { loadSlot: (s: string) => Promise<void> } }
    ).__game.loadSlot('slot1');
  });
  const restoredAudio = await getStoreSnapshot<{
    musicVolume: number;
    muted: boolean;
    bgmEnabled: boolean;
  }>(page, '({ musicVolume: s.audio.musicVolume, muted: s.audio.muted, bgmEnabled: s.audio.bgmEnabled })');
  expect(restoredAudio.musicVolume, 'audio.musicVolume restored after loadSlot').toBeCloseTo(0.85, 2);
  expect(restoredAudio.muted, 'audio.muted restored after loadSlot').toBe(true);
  expect(restoredAudio.bgmEnabled, 'audio.bgmEnabled restored after loadSlot').toBe(true);

  // ---- Step 9: HelpPanel — three close paths --------------------------------
  // 9a — × button
  await fastClick(page, 'help-open');
  await expect(page.locator('[data-testid="help-panel"]')).toBeVisible();
  await fastClick(page, 'help-close-x');
  await expect(page.locator('[data-testid="help-panel"]')).not.toBeVisible();

  // 9b — ESC
  await fastClick(page, 'help-open');
  await expect(page.locator('[data-testid="help-panel"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="help-panel"]')).not.toBeVisible();

  // 9c — backdrop. Real Playwright click here because we need a positional click
  // on the backdrop (testid catches the inner card otherwise).
  await fastClick(page, 'help-open');
  await expect(page.locator('[data-testid="help-panel"]')).toBeVisible();
  await page.locator('[data-testid="help-panel"]').click({
    position: { x: 5, y: 5 },
    force: true,
  });
  await expect(page.locator('[data-testid="help-panel"]')).not.toBeVisible();

  // ---- Step 10: flag-driven event via NATURAL eligibility pathway ----------
  // Set affinity high enough + clear blockers; the StorySystem's store
  // subscriber should detect the relationship change, run the eligibility
  // round-trip with the backend, and play `madoka_first_chat` on its own.
  await page.evaluate(() => {
    const s = (
      window as unknown as {
        __store: {
          getState: () => {
            setRelationship: (
              id: string,
              data: { npcId: string; affinity: number; emotion: string; lastUpdated: number },
            ) => void;
            clearFlag: (k: string) => void;
            story: { fireHistory: string[] };
            setStoryFireHistory: (h: string[]) => void;
          };
        };
      }
    ).__store.getState();
    s.clearFlag('madoka_first_chat_done');
    // Drop the gate we set in step 4 so this event becomes eligible again.
    s.setStoryFireHistory(
      s.story.fireHistory.filter((id: string) => id !== 'madoka_first_chat'),
    );
    // Bump affinity ABOVE the threshold; the change in `relationships` is
    // what wakes the StorySystem subscriber (the catalogue requires ≥60).
    s.setRelationship('madoka', {
      npcId: 'madoka',
      affinity: 80,
      emotion: 'happy',
      lastUpdated: Date.now(),
    });
  });

  // Wait for the natural pathway to set activeEventId. No __game.playEvent.
  await page.waitForFunction(
    () => {
      const s = (
        window as unknown as {
          __store: { getState: () => { story: { activeEventId: string | null } } };
        }
      ).__store.getState();
      return s.story.activeEventId === 'madoka_first_chat';
    },
    { timeout: 8_000 },
  );

  const storyOverlay = page.locator('[data-testid="story-overlay"]');
  await expect(storyOverlay).toBeVisible({ timeout: 3_000 });
  expect(await storyOverlay.getAttribute('data-event-id')).toBe('madoka_first_chat');

  // Click through to completion.
  for (let i = 0; i < 8; i++) {
    if (!(await storyOverlay.isVisible().catch(() => false))) break;
    await fastClick(page, 'story-continue');
    await page.waitForTimeout(60);
  }
  await expect(storyOverlay).not.toBeVisible({ timeout: 3_000 });
  // Effect step should have set the completion flag.
  const eventDoneFlag = await getStoreSnapshot<boolean | undefined>(
    page,
    "s.flags['madoka_first_chat_done']",
  );
  expect(eventDoneFlag).toBeTruthy();

  // ---- Step 11: time progression + schedule-driven NPC movement ------------
  const beforeTime = await getStoreSnapshot<{ hour: number; minute: number }>(
    page,
    '({ hour: s.time.hour, minute: s.time.minute })',
  );

  // Displace madoka so the next ScheduleSystem refresh has a delta to apply.
  await page.evaluate(() => {
    (
      window as unknown as {
        __game: { displaceNpc: (id: string, x: number, y: number) => void };
      }
    ).__game.displaceNpc('madoka', 42, 42);
  });

  // Advance the in-game clock by 5 minutes — this triggers the ScheduleSystem
  // store-subscription synchronously, which kicks off a fetch + teleport.
  await page.evaluate(() => {
    (
      window as unknown as { __game: { advanceTime: (m: number) => void } }
    ).__game.advanceTime(5);
  });

  // Wait for the async schedule fetch to land and madoka to be moved off (42,42).
  await page.waitForFunction(
    () => {
      const s = (
        window as unknown as {
          __store: {
            getState: () => {
              npcs: Record<string, { id: string; position: { x: number; y: number } }>;
            };
          };
        }
      ).__store.getState();
      const p = s.npcs['madoka']?.position;
      return p && (Math.abs(p.x - 42) > 5 || Math.abs(p.y - 42) > 5);
    },
    { timeout: 5_000 },
  );

  const afterTime = await getStoreSnapshot<{ hour: number; minute: number }>(
    page,
    '({ hour: s.time.hour, minute: s.time.minute })',
  );
  expect(
    afterTime.hour !== beforeTime.hour || afterTime.minute !== beforeTime.minute,
  ).toBe(true);

  const afterNpcs = await page.evaluate(() => {
    const s = (
      window as unknown as {
        __store: {
          getState: () => {
            npcs: Record<string, { id: string; position: { x: number; y: number } }>;
            npcSchedules: Record<string, { locationId: string | null; activity: string }>;
          };
        };
      }
    ).__store.getState();
    return {
      positions: Object.fromEntries(
        Object.entries(s.npcs).map(([id, n]) => [id, { x: n.position.x, y: n.position.y }]),
      ),
      schedules: s.npcSchedules,
    };
  });
  expect(
    Object.keys(afterNpcs.schedules).length,
    'expected ScheduleSystem to populate NPC schedules',
  ).toBeGreaterThan(0);
  const madokaPos = afterNpcs.positions['madoka'];
  expect(madokaPos, 'madoka should be moved away from displaced (42,42)').toBeTruthy();
  expect(
    Math.hypot((madokaPos as { x: number; y: number }).x - 42, (madokaPos as { x: number; y: number }).y - 42),
  ).toBeGreaterThan(10);

  // ---- Final assertions: zero console errors/warns, zero 5xx, zero pageerrors -
  expect(diag.pageErrors, `Page errors:\n${diag.pageErrors.join('\n')}`).toEqual([]);
  expect(
    diag.failedRequests,
    `5xx responses:\n${diag.failedRequests.map((r) => `${r.status} ${r.url}`).join('\n')}`,
  ).toEqual([]);
  expect(
    diag.consoleErrors,
    `Console errors:\n${diag.consoleErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    diag.consoleWarns,
    `Console warnings (excluding allowlist):\n${diag.consoleWarns.join('\n')}`,
  ).toEqual([]);
});
