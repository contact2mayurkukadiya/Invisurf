const { app, BrowserWindow, WebContentsView, View, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        show: true,
    });

    // 1. Tab container View
    const container = new View();
    win.contentView.addChildView(container);
    container.setBounds({ x: 0, y: 0, width: 1000, height: 700 });

    // 2. Tab WebContentsView inside container
    const tabView = new WebContentsView();
    container.addChildView(tabView);
    tabView.setBounds({ x: 0, y: 72, width: 1000, height: 628 });
    await tabView.webContents.loadURL('data:text/html,<html><body style="background:yellow;margin:0;height:100vh;display:flex;align-items:flex-end;"><h1 style="margin:20px;color:black;">BOTTOM OF WEBPAGE CONTENT</h1></body></html>');

    // 3. Status bubble added to container (SAME parent as tabView!)
    const bubbleView = new WebContentsView();
    container.addChildView(bubbleView);
    await bubbleView.webContents.loadURL('data:text/html,<html><body style="margin:0;background:blue;color:white;font-size:16px;line-height:24px;padding:0 8px;font-family:sans-serif;font-weight:bold;">STATUS BUBBLE ON TOP OF TAB</body></html>');

    bubbleView.setBounds({ x: 0, y: 700 - 24, width: 350, height: 24 });

    setTimeout(async () => {
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1000, height: 700 } });
        const winSource = sources.find(s => s.name.includes('Electron') || s.id.includes(String(win.id)));
        if (winSource) {
            fs.writeFileSync(path.join(__dirname, 'container_capture.png'), winSource.thumbnail.toPNG());
            console.log('Capture saved to container_capture.png');
        }
        app.quit();
    }, 1500);
});
