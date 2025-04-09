async function resizeBrowserWindow(browser, width, height) {
    const targets = await browser._connection.send('Target.getTargets');
    const { targetId } = targets.targetInfos[0];
  
    const { windowId } = await browser._connection.send('Browser.getWindowForTarget', { targetId });
  
    await browser._connection.send('Browser.setWindowBounds', {
      windowId,
      bounds: { width, height }
    });
  }
  