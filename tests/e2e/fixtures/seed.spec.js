'use strict';

const { test, expect } = require('./electronApp');

test('seed: launches InviSurf shell', async ({ invisurfApp }) => {
  const { shellWindow, app } = invisurfApp;
  
  // Verify main shell window is rendered
  await expect(shellWindow).toHaveTitle(/InviSurf/i);
  await expect(shellWindow.locator('#url-input')).toBeVisible();

  // Verify Electron main process is healthy
  const isHealthy = await app.evaluate(() => {
    return process.type === 'browser';
  });
  expect(isHealthy).toBe(true);
});
