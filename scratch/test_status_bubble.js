const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        show: true,
    });

    const webView = new WebContentsView();
    win.contentView.addChildView(webView);
    webView.setBounds({ x: 0, y: 72, width: 1000, height: 628 });
    await webView.webContents.loadURL('data:text/html,<html><body style="background:lightblue;padding:40px;"><h1>Web Content View</h1><a id="testlink" href="https://example.com/test-target-link" style="font-size:24px;">Hover Over Me</a></body></html>');

    const bubbleView = new WebContentsView();
    bubbleView.setBackgroundColor('#00000000');
    win.contentView.addChildView(bubbleView);
    await bubbleView.webContents.loadURL('data:text/html,<html><body style="margin:0;background:yellow;color:black;font-family:sans-serif;height:24px;line-height:24px;padding:0 8px;">https://example.com/test-target-link</body></html>');

    bubbleView.setBounds({ x: 0, y: 700 - 24, width: 300, height: 24 });

    console.log('WebView bounds:', webView.getBounds());
    console.log('BubbleView bounds:', bubbleView.getBounds());
    console.log('Children count:', win.contentView.children.length);

    webView.webContents.on('update-target-url', (event, url) => {
        console.log('update-target-url fired:', url);
    });

    // Test hovering programmatically
    setTimeout(async () => {
        console.log('Testing hover event via sendInputEvent...');
        // get coordinates of #testlink
        const coords = await webView.webContents.executeJavaScript(`
            (() => {
                const r = document.getElementById('testlink').getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            })()
        `);
        console.log('Link coords:', coords);
        webView.webContents.sendInputEvent({
            type: 'mouseMove',
            x: coords.x,
            y: coords.y,
        });

        setTimeout(() => {
            app.quit();
        }, 1500);
    }, 1000);
});
