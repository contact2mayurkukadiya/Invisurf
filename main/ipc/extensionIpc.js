const { ipcMain } = require('electron');
const { getExtensionController } = require('../extensions/ExtensionController');
const { getWindowContextByEventSender, getWindowContextForShellFallback } = require('../windows/windowContextUtils');
const State = require('../state');

function isWebStoreOrTrustedSender(event) {
    try {
        const frameUrl = event.senderFrame?.url || event.sender?.getURL() || '';
        return (
            frameUrl.startsWith('app://') ||
            frameUrl.startsWith('https://chromewebstore.google.com') ||
            frameUrl.startsWith('https://chrome.google.com/webstore')
        );
    } catch {
        return false;
    }
}

function isTrustedShellSender(event) {
    try {
        const frameUrl = event.senderFrame?.url || event.sender?.getURL() || '';
        return frameUrl.startsWith('app://');
    } catch {
        return false;
    }
}

function resolveContext(event) {
    return getWindowContextByEventSender(event.sender) || getWindowContextForShellFallback();
}

function registerExtensionIpcHandlers() {
    const controller = getExtensionController();

    // 1. Check if extension is installed (called by webstore page or shell)
    ipcMain.handle('extensions:is-installed', async (event, { extensionId }) => {
        if (!isWebStoreOrTrustedSender(event)) return false;
        const context = resolveContext(event);
        const profileId = context?.profileId || State.defaultProfileId;
        return controller.isExtensionInstalled(profileId, extensionId);
    });

    // 2. Prepare installation from Web Store (called when clicking 'Add to InviSurf')
    ipcMain.handle('extensions:webstore-prepare-install', async (event, { extensionId }) => {
        if (!isWebStoreOrTrustedSender(event)) {
            throw new Error('Unauthorized sender');
        }

        const context = resolveContext(event);
        const profileId = context?.profileId || State.defaultProfileId;

        console.log(`[ExtensionIPC] Prepare webstore install: ${extensionId} for profile ${profileId}`);
        const prep = await controller.prepareInstallFromWebStore(profileId, extensionId);

        // Display install prompt in top-level overlay WebContentsView above all web tabs
        if (context) {
            const overlayManager = require('../windows/overlayManager');
            overlayManager.showExtensionInstallPromptOverlay(context, prep);
        }

        return prep;
    });

    // 3. Confirm installation (ONLY callable by trusted InviSurf UI modal)
    ipcMain.handle('extensions:confirm-install', async (event, { installToken }) => {
        if (!isTrustedShellSender(event)) {
            throw new Error('Unauthorized sender: only InviSurf UI can confirm install');
        }

        const result = await controller.confirmInstall(installToken);

        // Notify all webContents in the window of completion
        const context = resolveContext(event);
        if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send('extensions:updated', { profileId: context.profileId });
        }

        // Notify tabs (e.g. Chrome Web Store page) that install succeeded
        if (context?.tabs) {
            for (const view of Object.values(context.tabs)) {
                if (view?.webContents && !view.webContents.isDestroyed()) {
                    view.webContents.send('extensions:install-completed', {
                        extensionId: result.extension.id,
                    });
                }
            }
        }

        return result;
    });

    // 4. Cancel installation (ONLY callable by trusted InviSurf UI modal)
    ipcMain.handle('extensions:cancel-install', async (event, { installToken }) => {
        if (!isTrustedShellSender(event)) {
            throw new Error('Unauthorized sender');
        }

        const pending = controller.pendingInstalls.get(installToken);
        const extensionId = pending?.extensionId;
        controller.cancelInstall(installToken);

        const context = resolveContext(event);
        if (extensionId && context?.tabs) {
            for (const view of Object.values(context.tabs)) {
                if (view?.webContents && !view.webContents.isDestroyed()) {
                    view.webContents.send('extensions:install-cancelled', { extensionId });
                }
            }
        }

        return { cancelled: true };
    });

    // 5. List installed extensions (ONLY callable by trusted InviSurf UI)
    ipcMain.handle('extensions:list', async (event, { profileId } = {}) => {
        if (!isTrustedShellSender(event)) return [];
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;
        return controller.getInstalledExtensions(targetProfile);
    });

    // 6. Toggle extension enabled state (ONLY callable by trusted InviSurf UI)
    ipcMain.handle('extensions:toggle', async (event, { extensionId, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;

        const exts = controller.getInstalledExtensions(targetProfile);
        const target = exts.find(e => e.id === extensionId);
        if (!target) throw new Error('Extension not found');

        let updated;
        if (target.enabled) {
            updated = await controller.disableExtension(targetProfile, extensionId);
        } else {
            updated = await controller.enableExtension(targetProfile, extensionId);
        }

        if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send('extensions:updated', { profileId: targetProfile });
        }

        return updated;
    });

    // 7. Uninstall extension (ONLY callable by trusted InviSurf UI)
    ipcMain.handle('extensions:uninstall', async (event, { extensionId, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;

        const success = await controller.uninstallExtension(targetProfile, extensionId);

        if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send('extensions:updated', { profileId: targetProfile });
        }

        return { success };
    });

    // 8. Toggle extension pinned state (ONLY callable by trusted InviSurf UI)
    ipcMain.handle('extensions:toggle-pin', async (event, { extensionId, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;
        const ext = controller.togglePinExtension(targetProfile, extensionId);
        if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send('extensions:updated', { profileId: targetProfile });
        }
        return ext;
    });

    // 9. Activate extension action on current active tab (prompts permission if needed)
    ipcMain.handle('extensions:activate-action', async (event, { extensionId, anchorRect } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        if (!context) return { ok: false };
        const targetProfile = context.profileId || State.defaultProfileId;
        return controller.activateExtensionAction(targetProfile, extensionId, context, anchorRect);
    });

    // 10. Omnibox Extension query and interaction handlers
    ipcMain.handle('omnibox:query-extension', async (event, { text } = {}) => {
        if (!isTrustedShellSender(event)) return [];
        try {
            const { getOmniboxManager } = require('../extensions/compat/OmniboxManager');
            return await getOmniboxManager().query(text);
        } catch (err) {
            console.warn('[ExtensionIPC] omnibox:query-extension error:', err?.message || err);
            return [];
        }
    });

    ipcMain.handle('omnibox:extension-input-entered', async (event, { extensionId, text, disposition } = {}) => {
        if (!isTrustedShellSender(event)) return false;
        try {
            const { getOmniboxManager } = require('../extensions/compat/OmniboxManager');
            return getOmniboxManager().inputEntered(extensionId, text, disposition);
        } catch (err) {
            console.warn('[ExtensionIPC] omnibox:extension-input-entered error:', err?.message || err);
            return false;
        }
    });

    ipcMain.handle('omnibox:extension-input-cancelled', async (event, { extensionId } = {}) => {
        if (!isTrustedShellSender(event)) return false;
        try {
            const { getOmniboxManager } = require('../extensions/compat/OmniboxManager');
            return getOmniboxManager().inputCancelled(extensionId);
        } catch (err) {
            console.warn('[ExtensionIPC] omnibox:extension-input-cancelled error:', err?.message || err);
            return false;
        }
    });

    // 11. Load unpacked extension directory (ONLY callable by trusted InviSurf UI)
    ipcMain.handle('extensions:load-unpacked', async (event, { profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;

        const { dialog } = require('electron');
        const win = context?.window;
        const result = await dialog.showOpenDialog(win, {
            title: 'Select Unpacked Extension Directory',
            properties: ['openDirectory'],
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { canceled: true };
        }

        const selectedPath = result.filePaths[0];
        try {
            const ext = await controller.loadUnpackedExtension(targetProfile, selectedPath);
            if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
                context.window.webContents.send('extensions:updated', { profileId: targetProfile });
            }
            return { success: true, extension: ext };
        } catch (err) {
            console.error('[ExtensionIPC] load-unpacked error:', err);
            return { success: false, error: err?.message || String(err) };
        }
    });

    // 12. Reload extension (ONLY callable by trusted InviSurf UI)
    ipcMain.handle('extensions:reload', async (event, { extensionId, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;

        try {
            const ext = await controller.reloadExtension(targetProfile, extensionId);
            if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
                context.window.webContents.send('extensions:updated', { profileId: targetProfile });
            }
            return { success: true, extension: ext };
        } catch (err) {
            console.error('[ExtensionIPC] reload error:', err);
            return { success: false, error: err?.message || String(err) };
        }
    });

    // 13. Set site access mode for an extension ('onClick' | 'onHost' | 'all')
    ipcMain.handle('extensions:set-site-access', async (event, { extensionId, mode, host, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;
        const updated = controller.setSiteAccess(targetProfile, extensionId, mode, host);
        if (context?.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send('extensions:updated', { profileId: targetProfile });
        }
        return updated;
    });

    // 14. Inspect extension popup
    ipcMain.handle('extensions:inspect-popup', async (event, { extensionId, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;
        return controller.inspectPopup(targetProfile, extensionId, context);
    });

    // 15. Open extension options page in a new tab
    ipcMain.handle('extensions:open-options-page', async (event, { extensionId, profileId } = {}) => {
        if (!isTrustedShellSender(event)) throw new Error('Unauthorized');
        const context = resolveContext(event);
        const targetProfile = profileId || context?.profileId || State.defaultProfileId;
        return controller.openOptionsPage(targetProfile, extensionId, context);
    });

    // Forward updates to renderer windows
    controller.on('extensions-updated', ({ profileId }) => {
        for (const ctx of State.windowContextsById.values()) {
            if (ctx.profileId === profileId && ctx.window?.webContents && !ctx.window.webContents.isDestroyed()) {
                ctx.window.webContents.send('extensions:updated', { profileId });
            }
        }
    });
}

module.exports = {
    registerExtensionIpcHandlers,
};
