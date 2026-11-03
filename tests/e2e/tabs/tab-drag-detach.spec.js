'use strict';

const { test, expect } = require('../fixtures/electronApp');

test.describe('Tab Vertical Drag, Detach, and Reattach E2E', () => {
  test('dragging a tab vertically down detaches it into a new window', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;
    shellWindow.on('console', msg => console.log('SHELL CONSOLE:', msg.text()));
    console.log('INITIAL WINDOWS:', app.windows().map(w => w.url()));

    // 1. Initial window has 1 tab. Add a second tab.
    const addTabBtn = shellWindow.locator('#add-tab');
    await expect(addTabBtn).toBeVisible({ timeout: 5000 });
    await addTabBtn.click();

    const tabs = shellWindow.locator('.tab');
    await expect(tabs).toHaveCount(2);

    const tab0 = tabs.nth(0);
    const tab1 = tabs.nth(1);
    const tab1Id = await tab1.getAttribute('data-tab-id');
    expect(tab1Id).toBeTruthy();

    const tab1Box = await tab1.boundingBox();
    expect(tab1Box).not.toBeNull();

    // 2. Perform vertical drag downwards by 60px
    const startX = tab1Box.x + tab1Box.width / 2;
    const startY = tab1Box.y + tab1Box.height / 2;

    await shellWindow.mouse.move(startX, startY);
    await shellWindow.mouse.down();

    // Drag down beyond 35px threshold
    await shellWindow.mouse.move(startX, startY + 70, { steps: 5 });
    await shellWindow.waitForTimeout(300);

    // 3. Verify a new BrowserWindow has been spawned
    let newWindow = null;
    await expect.poll(async () => {
      const windows = app.windows();
      return windows.filter(w => w.url().includes('index.html')).length;
    }, { timeout: 8000 }).toBe(2);

    // Get the second window
    const allWindows = app.windows().filter(w => w.url().includes('index.html'));
    newWindow = allWindows.find(w => w !== shellWindow);
    expect(newWindow).toBeTruthy();

    // Release mouse to complete the detachment
    await shellWindow.mouse.up();
    await shellWindow.waitForTimeout(500);

    // 4. Verify source window now has 1 tab
    await expect(shellWindow.locator('.tab')).toHaveCount(1);

    // 5. Verify the new window displays the detached tab
    await expect(newWindow.locator('.tab')).toHaveCount(1);
    const detachedTabId = await newWindow.locator('.tab').first().getAttribute('data-tab-id');
    expect(detachedTabId).toBe(tab1Id);

    // Clean up detached window so subsequent tests start with a single shell window
    await newWindow.close();
    await expect.poll(() => app.windows().filter(w => w.url().includes('index.html')).length).toBe(1);
  });

  test('dragging tab over another window tab bar reattaches it', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // 1. Add second tab to initial window
    const addTabBtn = shellWindow.locator('#add-tab');
    await expect(addTabBtn).toBeVisible({ timeout: 5000 });
    await addTabBtn.click();
    await expect(shellWindow.locator('.tab')).toHaveCount(2);

    const tab1 = shellWindow.locator('.tab').nth(1);
    const tab1Box = await tab1.boundingBox();
    const startX = tab1Box.x + tab1Box.width / 2;
    const startY = tab1Box.y + tab1Box.height / 2;

    // 2. Detach tab 1 into a new window
    await shellWindow.mouse.move(startX, startY);
    await shellWindow.mouse.down();
    await shellWindow.mouse.move(startX, startY + 70, { steps: 5 });
    await shellWindow.waitForTimeout(400);

    // Wait for new window
    await expect.poll(async () => {
      return app.windows().filter(w => w.url().includes('index.html')).length;
    }, { timeout: 8000 }).toBe(2);

    // Release mouse in free space
    await shellWindow.mouse.up();
    await shellWindow.waitForTimeout(400);

    const allWindows = app.windows().filter(w => w.url().includes('index.html'));
    const secondWindow = allWindows.find(w => w !== shellWindow);
    expect(secondWindow).toBeTruthy();

    // 3. Now drag the tab from secondWindow back over shellWindow's tab bar
    const secondTab = secondWindow.locator('.tab').first();
    const secondTabBox = await secondTab.boundingBox();
    const shellTabContainerBox = await shellWindow.locator('.tab-container').boundingBox();

    shellWindow.on('console', msg => console.log('SHELL CONSOLE:', msg.text()));
    secondWindow.on('console', msg => console.log('SECOND CONSOLE:', msg.text()));

    // Get shell window position on screen directly from shellWindow
    const shellBounds = await shellWindow.evaluate(() => ({
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
    }));
    expect(shellBounds).toBeTruthy();

    // Target point is inside shell window's tab strip (y is between bounds.y and bounds.y + 45):
    const targetScreenX = shellBounds.x + 350;
    const targetScreenY = shellBounds.y + 25;
    console.log('TARGET SCREEN COORDS FOR REATTACH:', { targetScreenX, targetScreenY, shellBounds });

    // Start drag on secondTab
    await secondWindow.mouse.move(secondTabBox.x + 20, secondTabBox.y + 10);
    await secondWindow.mouse.down();

    // Drag vertically down to start detach move
    await secondWindow.mouse.move(secondTabBox.x + 20, secondTabBox.y + 60, { steps: 5 });

    // Drag into shellWindow's tab bar screen position via electronAPI drag-move and drag-end.
    // Note: Once the tab is docked, secondWindow is destroyed, so the evaluate promise may close.
    await secondWindow.evaluate(({ targetScreenX, targetScreenY }) => {
      window.electronAPI.tabDragMove({ screenX: targetScreenX, screenY: targetScreenY });
      window.electronAPI.tabDragEnd();
    }, { targetScreenX, targetScreenY }).catch(() => {});

    await shellWindow.waitForTimeout(600);

    // 4. Verify shellWindow now has 2 tabs reattached
    await expect(shellWindow.locator('.tab')).toHaveCount(2);

    // Verify reattached tab does not have a stuck loading ring/spinner and shows tab icon
    const reattachedTab = shellWindow.locator('.tab').nth(1);
    await expect(reattachedTab.locator('.spinner')).toHaveCount(0);
    await expect(reattachedTab.locator('.tab-icon')).toBeVisible();

    // 5. Re-detach the tab again: verify it detaches into a new window and remains on top
    const reattachedBox = await reattachedTab.boundingBox();
    const rStartX = reattachedBox.x + reattachedBox.width / 2;
    const rStartY = reattachedBox.y + reattachedBox.height / 2;

    await shellWindow.mouse.move(rStartX, rStartY);
    await shellWindow.mouse.down();
    await shellWindow.mouse.move(rStartX, rStartY + 70, { steps: 5 });
    await shellWindow.waitForTimeout(400);

    // Verify a new detached window is spawned again
    await expect.poll(async () => {
      return app.windows().filter(w => w.url().includes('index.html')).length;
    }, { timeout: 8000 }).toBe(2);

    const reDetachedWindows = app.windows().filter(w => w.url().includes('index.html'));
    const thirdWindow = reDetachedWindows.find(w => w !== shellWindow);
    expect(thirdWindow).toBeTruthy();

    // Verify detached window is alwaysOnTop while dragging so it remains on top of existing window
    const isAlwaysOnTop = await app.evaluate(({ BrowserWindow }) => {
      const topWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isAlwaysOnTop());
      return !!topWin;
    });
    expect(isAlwaysOnTop).toBe(true);

    await shellWindow.mouse.up();
    await shellWindow.waitForTimeout(400);

    // Verify shellWindow now has 1 tab and thirdWindow has 1 tab
    await expect(shellWindow.locator('.tab')).toHaveCount(1);
    await expect(thirdWindow.locator('.tab')).toHaveCount(1);

    // Clean up thirdWindow so subsequent tests start with a single shell window
    await thirdWindow.close();
    await expect.poll(() => app.windows().filter(w => w.url().includes('index.html')).length).toBe(1);
  });

  test('tab favicon is preserved and loading spinner does not get stuck when detached and re-attached', async ({ invisurfApp }) => {
    const { shellWindow, app } = invisurfApp;

    // 1. Add second tab to initial window
    const addTabBtn = shellWindow.locator('#add-tab');
    await expect(addTabBtn).toBeVisible({ timeout: 5000 });
    await addTabBtn.click();
    await expect(shellWindow.locator('.tab')).toHaveCount(2);

    const tab1 = shellWindow.locator('.tab').nth(1);
    const tab1Id = await tab1.getAttribute('data-tab-id');
    expect(tab1Id).toBeTruthy();

    const customFavicon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjgiIGZpbGw9InJlZCIvPjwvc3ZnPg==';

    // Set custom favicon and Canva URL/title on the tab's WebContentsView and in Redux
    await app.evaluate(async (electronApp, [tId, fav]) => {
      const State = global.__invisurfState;
      if (!State) return;
      const winId = State.tabIdToWindowId.get(tId);
      const ctx = State.windowContextsById?.get(winId) || State.windowContexts?.get(winId);
      if (ctx && ctx.tabs && ctx.tabs[tId]) {
        const v = ctx.tabs[tId];
        v._favicon = fav;
        if (v.webContents) {
          v.webContents.getURL = () => 'https://canva.com';
          v.webContents.getTitle = () => 'Canva: Visual Suite for Everyone';
          v.webContents.isLoading = () => false;
          v.webContents.removeAllListeners('page-favicon-updated');
          v.webContents.on('page-favicon-updated', () => {});
        }
      }
      if (ctx && ctx.window && !ctx.window.isDestroyed()) {
        ctx.window.webContents.send('url-changed', { id: tId, url: 'https://canva.com' });
        ctx.window.webContents.send('tab-update', {
          id: tId,
          url: 'https://canva.com',
          title: 'Canva: Visual Suite for Everyone',
          favicon: fav,
          isLoading: false,
        });
      }
    }, [tab1Id, customFavicon]);

    await expect(tab1.locator('.tab-icon')).toHaveAttribute('src', customFavicon, { timeout: 4000 });
    await expect(tab1.locator('.spinner')).toHaveCount(0);

    // 2. Detach tab1 into a new window
    const tab1Box = await tab1.boundingBox();
    const startX = tab1Box.x + tab1Box.width / 2;
    const startY = tab1Box.y + tab1Box.height / 2;

    await shellWindow.mouse.move(startX, startY);
    await shellWindow.mouse.down();
    await shellWindow.mouse.move(startX, startY + 70, { steps: 5 });
    await shellWindow.waitForTimeout(400);

    // Wait for new window
    await expect.poll(async () => {
      return app.windows().filter(w => w.url().includes('index.html')).length;
    }, { timeout: 8000 }).toBe(2);

    await shellWindow.mouse.up();
    await shellWindow.waitForTimeout(400);

    const allWindows = app.windows().filter(w => w.url().includes('index.html'));
    const detachedWindow = allWindows.find(w => w !== shellWindow);
    expect(detachedWindow).toBeTruthy();

    // 3. Verify detached tab in the new window has preserved the favicon and has no spinner
    const detachedTab = detachedWindow.locator('.tab').first();
    await expect(detachedTab.locator('.spinner')).toHaveCount(0);
    await expect(detachedTab.locator('.tab-icon')).toHaveAttribute('src', customFavicon);

    // 4. Drag back into shellWindow to re-attach
    const detachedTabBox = await detachedTab.boundingBox();
    const shellBounds = await shellWindow.evaluate(() => ({
      x: window.screenX,
      y: window.screenY,
    }));

    const targetScreenX = shellBounds.x + 350;
    const targetScreenY = shellBounds.y + 25;

    await detachedWindow.mouse.move(detachedTabBox.x + 20, detachedTabBox.y + 10);
    await detachedWindow.mouse.down();
    await detachedWindow.mouse.move(detachedTabBox.x + 20, detachedTabBox.y + 60, { steps: 5 });

    await detachedWindow.evaluate(({ targetScreenX, targetScreenY }) => {
      window.electronAPI.tabDragMove({ screenX: targetScreenX, screenY: targetScreenY });
      window.electronAPI.tabDragEnd();
    }, { targetScreenX, targetScreenY }).catch(() => {});

    await shellWindow.waitForTimeout(600);

    // 5. Verify shellWindow now has 2 tabs and the re-attached tab has the favicon and no spinner
    await expect(shellWindow.locator('.tab')).toHaveCount(2);
    const reattachedTab = shellWindow.locator(`.tab[data-tab-id="${tab1Id}"]`);
    await expect(reattachedTab).toBeVisible();
    await expect(reattachedTab.locator('.spinner')).toHaveCount(0);
    await expect(reattachedTab.locator('.tab-icon')).toHaveAttribute('src', customFavicon);
  });
});
