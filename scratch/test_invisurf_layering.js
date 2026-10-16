const { app, BrowserWindow, WebContentsView, View } = require('electron');
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
    await tabView.webContents.loadURL('data:text/html,<html><body style="background:lightblue;padding:40px;"><h1>Tab Web Content View</h1><p>Bottom area is lightblue.</p></body></html>');

    // 3. Status bubble WebContentsView on win.contentView
    const bubbleView = new WebContentsView();
    bubbleView.setBackgroundColor('#00000000');
    win.contentView.addChildView(bubbleView);
    await bubbleView.webContents.loadURL('data:text/html,<html><body style="margin:0;background:red;color:white;font-family:sans-serif;height:24px;line-height:24px;padding:0 8px;font-weight:bold;">STATUS BUBBLE TEST URL</body></html>');

    bubbleView.setBounds({ x: 0, y: 700 - 24, width: 300, height: 24 });

    console.log('Container bounds:', container.getBounds());
    console.log('TabView bounds:', tabView.getBounds());
    console.log('BubbleView bounds:', bubbleView.getBounds());

    // Wait 1 second and capture screenshot
    setTimeout(async () => {
        const image = await win.webContents.capturePage();
        const screenshotPath = path.join(__dirname, 'screenshot_layering.png');
        fs.writeFileSync(screenshotPath, image.toPNG());
        console.log('Saved screenshot to:', screenshotPath);
        app.quit();
    }, 1200);
});
