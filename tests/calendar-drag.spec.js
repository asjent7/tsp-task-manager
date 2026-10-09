// Playwright tests for calendar pointer-based interactions.
// Google calls are skipped automatically when google_auth table is empty (in-memory DB).
// Run: npx playwright test

const { test, expect } = require('@playwright/test');

test.setTimeout(40000); // Chrome cold-start needs extra time

const TEST_DATE = '2026-10-09'; // a Friday, safe for blocks
const WEEK_DATE = '2026-10-08'; // a Thursday

// ── API helpers ────────────────────────────────────────────────────────────────

async function createTask(request, overrides = {}) {
  const res = await request.post('/api/tasks', {
    data: { title: 'Test Task', status: 'pending', priority: 'medium', category: 'admin', ...overrides },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function createBlock(request, taskId, { date = TEST_DATE, start_time = '09:00', duration_minutes = 60 } = {}) {
  const res = await request.post('/api/time-blocks', {
    data: { task_id: taskId, date, start_time, duration_minutes },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

// ── Navigation helpers ─────────────────────────────────────────────────────────

async function goToCalendarDay(page, dateStr) {
  await page.goto('/app.html');
  // Category nav items are injected by renderSidebar() which runs at the END of loadAll()
  // so this selector fires only after state.tasks is fully populated
  await page.waitForSelector('[data-view^="category:"]', { timeout: 15000 });
  // Switch to calendar day view; clear due-pill filter so all tasks appear in panel
  await page.evaluate((d) => {
    calPanelDuePills.clear();
    state.calDayStr = d;
    state.calMode = 'day';
    setView('calendar');
  }, dateStr);
  await page.evaluate((d) => loadTimeBlocks(d).then(() => renderCalendarDay()), dateStr);
  await page.waitForSelector('#cal-day-content', { timeout: 8000 });
}

// Get bounding box of a block element
async function blockBox(page, blockId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-block-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height,
             cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
  }, blockId);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Day view — block interactions', () => {
  let task, block;

  test.beforeEach(async ({ page, request }) => {
    task = await createTask(request);
    block = await createBlock(request, task.id, { date: TEST_DATE, start_time: '09:00', duration_minutes: 60 });
    await goToCalendarDay(page, TEST_DATE);
  });

  test('click block body opens popover (no drag)', async ({ page }) => {
    const box = await blockBox(page, block.id);
    expect(box).not.toBeNull();

    // Clean click — no movement → calPD.moved stays false → popover opens
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.up();

    // After a clean click, calPdJustDragged should be false (it's set true only when moved)
    const justDragged = await page.evaluate(() => window.calPdJustDragged ?? false);
    expect(justDragged).toBe(false);

    // The block popover (#block-popover) should now be visible
    await expect(page.locator('#block-popover')).toBeVisible({ timeout: 2000 });
  });

  test('drag block body moves it to new time (PATCH called)', async ({ page, request }) => {
    const box = await blockBox(page, block.id);
    expect(box).not.toBeNull();

    // Drag ~2 hours down (PX_PER_HOUR = 80 in day view)
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx, box.cy + 160, { steps: 12 });
    await page.mouse.up();

    // Wait for API call and re-render
    await page.waitForTimeout(1200);

    // Block still exists in DOM (re-rendered at new position)
    await expect(page.locator(`[data-block-id="${block.id}"]`)).toBeVisible({ timeout: 4000 });

    // DB should reflect the new start_time
    const res = await request.get(`/api/time-blocks?date=${TEST_DATE}`);
    const blocks = await res.json();
    const moved = blocks.find(b => b.id === block.id);
    expect(moved).toBeTruthy();
    expect(moved.start_time).not.toBe('09:00');
  });

  test('drag resize-b handle extends duration (PATCH called)', async ({ page, request }) => {
    const box = await blockBox(page, block.id);
    expect(box).not.toBeNull();

    // The .cal-day-resize handle is at the very bottom of the block
    const resizeY = box.y + box.height - 4;
    const resizeX = box.cx;

    // Drag down by ~1 hour (80px)
    await page.mouse.move(resizeX, resizeY);
    await page.mouse.down();
    await page.mouse.move(resizeX, resizeY + 80, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(1200);

    const res = await request.get(`/api/time-blocks?date=${TEST_DATE}`);
    const blocks = await res.json();
    const resized = blocks.find(b => b.id === block.id);
    expect(resized).toBeTruthy();
    expect(resized.duration_minutes).toBeGreaterThan(60);
  });

  test('drag resize-t handle from top shrinks duration', async ({ page, request }) => {
    // Create a 120-min block with room to shrink from top
    const t2 = await createTask(request, { title: 'Resize top test' });
    const b2 = await createBlock(request, t2.id, { date: TEST_DATE, start_time: '10:00', duration_minutes: 120 });
    await page.evaluate((d) => loadTimeBlocks(d).then(() => renderCalendarDay()), TEST_DATE);
    await page.waitForTimeout(500);

    const box = await blockBox(page, b2.id);
    expect(box).not.toBeNull();

    // The .cal-day-resize-t handle is at the very top of the block (first 8px)
    const resizeY = box.y + 4;
    const resizeX = box.cx;

    // Drag the top down by 1 hour (80px) — shortens block
    await page.mouse.move(resizeX, resizeY);
    await page.mouse.down();
    await page.mouse.move(resizeX, resizeY + 80, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(1200);

    const res = await request.get(`/api/time-blocks?date=${TEST_DATE}`);
    const blocks = await res.json();
    const resized = blocks.find(b => b.id === b2.id);
    expect(resized).toBeTruthy();
    expect(resized.duration_minutes).toBeLessThan(120);
  });

  test('drag task from panel creates new block (POST called)', async ({ page, request }) => {
    // Create a task with no block, then reload the page so init() picks it up
    const newTask = await createTask(request, { title: 'Panel Task' });
    await goToCalendarDay(page, TEST_DATE);

    // Scroll the panel task into view (panel is overflow-y: auto)
    const panelTask = page.locator(`.cal-day-panel-task[data-task-id="${newTask.id}"]`);
    await panelTask.scrollIntoViewIfNeeded({ timeout: 5000 });
    await expect(panelTask).toBeVisible({ timeout: 5000 });
    const panelBox = await panelTask.boundingBox();
    expect(panelBox).not.toBeNull();

    // Drag onto the day grid at ~60% of its height (a valid mid-afternoon slot)
    const content = await page.locator('#cal-day-content').boundingBox();
    expect(content).not.toBeNull();
    const targetY = content.y + Math.round(content.height * 0.6);
    const targetX = content.x + content.width / 2;

    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 15 });
    await page.mouse.up();

    await page.waitForTimeout(1500);

    const res = await request.get(`/api/time-blocks?date=${TEST_DATE}`);
    const blocks = await res.json();
    const created = blocks.find(b => b.task_id === newTask.id);
    expect(created).toBeTruthy();
    expect(created.date).toBe(TEST_DATE);
  });
});

test.describe('Day view — API failure reverts block', () => {
  let task, block;

  test.beforeEach(async ({ page, request }) => {
    task = await createTask(request);
    block = await createBlock(request, task.id, { date: TEST_DATE, start_time: '09:00', duration_minutes: 60 });
    await goToCalendarDay(page, TEST_DATE);
  });

  test('PATCH failure reverts render and block stays visible', async ({ page }) => {
    // Intercept the PATCH and return 500
    await page.route(`/api/time-blocks/${block.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ error: 'Server error' }) });
      } else {
        await route.continue();
      }
    });

    const box = await blockBox(page, block.id);
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx, box.cy + 160, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(1500);

    // Block must still be visible after the failed move (render reverted)
    await expect(page.locator(`[data-block-id="${block.id}"]`)).toBeVisible({ timeout: 4000 });
  });
});

test.describe('Week view — block move', () => {
  let task, block;

  test.beforeEach(async ({ page, request }) => {
    task = await createTask(request);
    block = await createBlock(request, task.id, { date: WEEK_DATE, start_time: '10:00', duration_minutes: 60 });

    await page.goto('/app.html');
    await page.waitForSelector('[data-view^="category:"]', { timeout: 15000 });

    await page.evaluate(async (d) => {
      state.calMode = 'week';
      state.calWeekGridMode = true;
      // Point calWeekStart at Monday of the week containing d
      const dt = new Date(d + 'T12:00:00');
      const dow = dt.getDay(); // 0=Sun
      const mon = new Date(dt);
      mon.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1));
      state.calWeekStart = mon;
      setView('calendar');
    }, WEEK_DATE);

    await page.evaluate(() => loadWeekBlocks().then(() => renderCalendarWeekGrid()));
    await page.waitForSelector('.cal-wtg-col[data-date]', { timeout: 8000 });
  });

  test('drag block body in week view moves it (PATCH called)', async ({ page, request }) => {
    await expect(page.locator(`[data-block-id="${block.id}"]`)).toBeVisible({ timeout: 5000 });

    const box = await blockBox(page, block.id);
    expect(box).not.toBeNull();

    // Drag ~3 hours down within same column (PX_PER_HOUR_WEEK ≈ 50px)
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx, box.cy + 150, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(1500);

    const res = await request.get(`/api/time-blocks?date=${WEEK_DATE}`);
    const blocks = await res.json();
    const moved = blocks.find(b => b.id === block.id);
    expect(moved).toBeTruthy();
    expect(moved.start_time).not.toBe('10:00');
  });
});
