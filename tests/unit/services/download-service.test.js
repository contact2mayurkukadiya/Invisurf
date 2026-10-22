'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const downloadService = require('../../../main/services/downloadService');
const encryption = require('../../../encryption');

describe('DownloadService', () => {
  const tmpDir = path.join(os.tmpdir(), `invisurf-dl-test-${Date.now()}`);

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Mock app for testing
    const mockApp = {
      getPath: (name) => {
        if (name === 'userData' || name === 'downloads') return tmpDir;
        return tmpDir;
      },
    };
    downloadService.init(mockApp, encryption);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('getUnusedFilePath', () => {
    test('returns original filename when no collision exists', () => {
      const filePath = downloadService.getUnusedFilePath(tmpDir, 'document.pdf');
      assert.equal(path.basename(filePath), 'document.pdf');
    });

    test('increments filename with (1), (2) when file already exists', () => {
      const original = path.join(tmpDir, 'photo.png');
      fs.writeFileSync(original, 'content');

      const next1 = downloadService.getUnusedFilePath(tmpDir, 'photo.png');
      assert.equal(path.basename(next1), 'photo (1).png');

      fs.writeFileSync(next1, 'content 2');
      const next2 = downloadService.getUnusedFilePath(tmpDir, 'photo.png');
      assert.equal(path.basename(next2), 'photo (2).png');
    });

    test('increments filename when in-progress .invdownload file exists', () => {
      const original = path.join(tmpDir, 'download-in-progress.zip');
      const invPath = original + '.invdownload';
      fs.writeFileSync(invPath, 'partial bytes');

      const chosen = downloadService.getUnusedFilePath(tmpDir, 'download-in-progress.zip');
      assert.equal(path.basename(chosen), 'download-in-progress (1).zip');

      fs.unlinkSync(invPath);
    });

    test('sanitizes unsafe characters in filename', () => {
      const filePath = downloadService.getUnusedFilePath(tmpDir, 'un*safe:file?.zip');
      assert.equal(path.basename(filePath), 'un_safe_file_.zip');
    });
  });

  describe('cleanupPartialDownloadFile', () => {
    test('removes partial file, partial .invdownload file, and .crdownload file', () => {
      const partialPath = path.join(tmpDir, 'partial-download.bin');
      const invdownloadPath = partialPath + '.invdownload';
      const crdownloadPath = partialPath + '.crdownload';

      fs.writeFileSync(partialPath, 'partial data');
      fs.writeFileSync(invdownloadPath, 'invdownload data');
      fs.writeFileSync(crdownloadPath, 'crdownload data');

      assert.equal(fs.existsSync(partialPath), true);
      assert.equal(fs.existsSync(invdownloadPath), true);
      assert.equal(fs.existsSync(crdownloadPath), true);

      downloadService.cleanupPartialDownloadFile(partialPath);

      assert.equal(fs.existsSync(partialPath), false);
      assert.equal(fs.existsSync(invdownloadPath), false);
      assert.equal(fs.existsSync(crdownloadPath), false);
    });

    test('handles non-existent file gracefully without throwing', () => {
      assert.doesNotThrow(() => {
        downloadService.cleanupPartialDownloadFile(path.join(tmpDir, 'non-existent-file.tmp'));
      });
    });
  });

  describe('History Persistence', () => {
    const testProfileId = 'test-profile-dl';

    test('saves and loads encrypted download records for a profile', () => {
      const records = [
        {
          id: 'dl-test-1',
          filename: 'archive.zip',
          savePath: path.join(tmpDir, 'archive.zip'),
          url: 'https://example.com/archive.zip',
          totalBytes: 102400,
          receivedBytes: 102400,
          state: 'completed',
          startTime: Date.now() - 5000,
          endTime: Date.now(),
        },
      ];

      // Initially empty
      const initial = downloadService.loadHistory(testProfileId);
      assert.deepEqual(initial, []);

      // Modify and save
      initial.push(...records);
      downloadService.saveHistory(testProfileId);

      // Verify written file is encrypted JSON payload
      const historyFile = path.join(tmpDir, `downloads-${testProfileId}.json`);
      assert.equal(fs.existsSync(historyFile), true);
      const raw = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      assert.ok(raw.encrypted !== undefined, 'History file should be encrypted');

      // Clear cache to verify loading from disk
      const reloaded = downloadService.getAll(testProfileId);
      assert.equal(reloaded.history.length, 1);
      assert.equal(reloaded.history[0].id, 'dl-test-1');
      assert.equal(reloaded.history[0].filename, 'archive.zip');
    });

    test('removes single download from history', () => {
      const res = downloadService.removeFromHistory(testProfileId, 'dl-test-1');
      assert.equal(res.success, true);

      const afterRemove = downloadService.getAll(testProfileId);
      assert.equal(afterRemove.history.length, 0);
    });

    test('clearAllHistory wipes history clean', () => {
      const history = downloadService.loadHistory(testProfileId);
      history.push(
        { id: 'dl-a', filename: 'a.txt', state: 'completed' },
        { id: 'dl-b', filename: 'b.txt', state: 'completed' }
      );
      downloadService.saveHistory(testProfileId);

      assert.equal(downloadService.getAll(testProfileId).history.length, 2);

      downloadService.clearAllHistory(testProfileId);
      assert.equal(downloadService.getAll(testProfileId).history.length, 0);
    });

    test('deduplicates entries with identical id when loading or saving history', () => {
      const history = downloadService.loadHistory(testProfileId);
      history.push(
        { id: 'dl-dup-1', filename: 'file1.bin', state: 'cancelled' },
        { id: 'dl-dup-1', filename: 'file1.bin', state: 'cancelled' },
        { id: 'dl-dup-2', filename: 'file2.bin', state: 'completed' }
      );
      downloadService.saveHistory(testProfileId);

      const loaded = downloadService.getAll(testProfileId);
      assert.equal(loaded.history.length, 2, 'Duplicates with same id should be collapsed to 1');
      assert.equal(loaded.history.filter(h => h.id === 'dl-dup-1').length, 1);
    });

    test('retryDownload removes the old record from history', () => {
      const history = downloadService.loadHistory(testProfileId);
      history.push({
        id: 'dl-retry-test',
        filename: 'retry-me.zip',
        url: 'https://example.com/retry-me.zip',
        state: 'cancelled',
      });
      downloadService.saveHistory(testProfileId);

      assert.equal(downloadService.getAll(testProfileId).history.some(h => h.id === 'dl-retry-test'), true);

      // retryDownload without electron session should still remove the old record from history
      downloadService.retryDownload('dl-retry-test', testProfileId);

      const afterRetry = downloadService.getAll(testProfileId);
      assert.equal(afterRetry.history.some(h => h.id === 'dl-retry-test'), false, 'Retried card should be removed from history');
    });

    test('getAll attaches fileExists: true when file exists on disk and false when deleted', () => {
      const realFile = path.join(tmpDir, 'real-file.txt');
      fs.writeFileSync(realFile, 'hello world');

      const nonExistentFile = path.join(tmpDir, 'missing-file.txt');

      const history = downloadService.loadHistory(testProfileId);
      history.push(
        {
          id: 'dl-file-exists',
          filename: 'real-file.txt',
          savePath: realFile,
          state: 'completed',
        },
        {
          id: 'dl-file-missing',
          filename: 'missing-file.txt',
          savePath: nonExistentFile,
          state: 'completed',
        }
      );
      downloadService.saveHistory(testProfileId);

      const all = downloadService.getAll(testProfileId);
      const existsRecord = all.history.find(h => h.id === 'dl-file-exists');
      const missingRecord = all.history.find(h => h.id === 'dl-file-missing');

      assert.equal(existsRecord?.fileExists, true, 'Existing file should have fileExists === true');
      assert.equal(missingRecord?.fileExists, false, 'Deleted or missing file should have fileExists === false');

      fs.unlinkSync(realFile);
    });
  });

  describe('broadcastDownloadEvent', () => {
    test('broadcasts download events to window webContents and all tab webContents', () => {
      const State = require('../../../main/state');
      const messagesSentWindow = [];
      const messagesSentTab = [];

      const mockTab = {
        webContents: {
          isDestroyed: () => false,
          send: (channel, data) => messagesSentTab.push({ channel, data }),
        },
      };

      const mockContext = {
        window: {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => false,
            send: (channel, data) => messagesSentWindow.push({ channel, data }),
          },
        },
        tabs: {
          'tab-1': mockTab,
        },
      };

      State.windowContextsById.set('mock-win-1', mockContext);

      downloadService.broadcastDownloadEvent('downloads:progress', { id: 'dl-test', percent: 50 });

      assert.equal(messagesSentWindow.length, 1);
      assert.equal(messagesSentWindow[0].channel, 'downloads:progress');
      assert.equal(messagesSentWindow[0].data.percent, 50);

      assert.equal(messagesSentTab.length, 1);
      assert.equal(messagesSentTab[0].channel, 'downloads:progress');
      assert.equal(messagesSentTab[0].data.percent, 50);

      State.windowContextsById.delete('mock-win-1');
    });
  });

  describe('pauseDownload & resumeDownload', () => {
    test('pauseDownload returns error when download is not active', () => {
      const result = downloadService.pauseDownload('non-existent-id');
      assert.equal(result.success, false);
      assert.ok(result.error);
    });

    test('resumeDownload returns error when download is not active', () => {
      const result = downloadService.resumeDownload('non-existent-id');
      assert.equal(result.success, false);
      assert.ok(result.error);
    });
  });
});

