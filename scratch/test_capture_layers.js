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
    await tabView.webContents.loadURL('data:text/html,<html><body style="background:cyan;margin:0;height:100vh;display:flex;align-items:flex-end;"><h1 style="margin:20px;">BOTTOM OF TAB VIEW</h1></body></html>');

    // 3. Status bubble WebContentsView on win.contentView
    const bubbleView = new WebContentsView();
    win.contentView.addChildView(bubbleView);
    await bubbleView.webContents.loadURL('data:text/html,<html><body style="margin:0;background:magenta;color:white;font-size:18px;height:24px;line-height:24px;font-weight:bold;">STATUS BUBBLE TEST URL</body></html>');

    bubbleView.setBounds({ x: 0, y: 700 - 40, width: 300, height: 40 });

    setTimeout(async () => {
        // Capture screen to see what is on screen
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1000, height: 700 } });
        const winSource = sources.find(s => s.name.includes('Electron') || s.id.includes(String(win.id)));
        console.log('Available sources:', sources.map(s => s.name));
        if (winSource) {
            fs.writeFileSync(path.join(__dirname, 'window_capture.png'), winSource.thumbnail.toPNG());
            console.log('Window capture saved to scratch/window_capture.png');
        }
        
        // Also capture tabView and bubbleView individually
        const tabImg = await tabView.webContents.capturePage();
        const bubbleImg = await bubbleView.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'tab_capture.png'), tabImg.toPNG());
        fs.writeFileSync(path.join(__dirname, 'bubble_capture.png'), bubbleImg.toPNG());
        console.log('Tab capture size:', tabImg.getSize(), 'Bubble capture size:', bubbleImg.getSize());

        app.quit();
    }, 1500);
});
