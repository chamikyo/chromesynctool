
const puppeteer = require('puppeteer');
const REMOTE_DEBUG_PORTS = Array.from({ length: 20 }, (_, i) => 9222 + i);

async function startSync(masterIndex, count) {
  console.log(`📡 [startSync] Initializing with master ${masterIndex} among ${count}`);

  const pages = [];

  for (let i = 0; i < count; i++) {
    const browserURL = `http://localhost:${REMOTE_DEBUG_PORTS[i]}`;
    const browser = await puppeteer.connect({ browserURL });
    const page = (await browser.pages())[0];
// 1. defaultViewport 우회 (강제 null)
await page.setViewport(null);  // ✅ 핵심!
    // ✅ 뷰포트 오버라이드 해제 → 반응형 
    const client = await page.target().createCDPSession();
    await client.send('Emulation.clearDeviceMetricsOverride');

// 3. 창 자체 크기 조정
const { windowId } = await client.send('Browser.getWindowForTarget');
await client.send('Browser.setWindowBounds', {
  windowId,
  bounds: { width: 1440, height: 900 }
});
    pages.push(page);
  }

  const master = pages[masterIndex];
  const slaves = pages.filter((_, i) => i !== masterIndex);

  master.on('framenavigated', async () => {
    try {
      await master.waitForFunction('document.readyState === "complete"');
      await injectEventListeners(master);
      console.log("✅ Re-injected event listeners after navigation");

      // 💡 Emulation 해제 + 뷰포트 복구
      await master._client().send('Emulation.clearDeviceMetricsOverride');
      await master.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

      const newUrl = await master.url();
      for (const slave of slaves) {
        const slaveUrl = await slave.url();
        if (slaveUrl !== newUrl) {
          console.log(`🔄 Syncing slave to new URL: ${newUrl}`);
          await slave.goto(newUrl, { waitUntil: 'networkidle2' });
        }
      }

    } catch (err) {
      console.error("❗ Failed to rebind after navigation:", err);
    }
  });

  await master.exposeFunction('onUserEvent', async (event) => {
    console.log('[Sync] injecting input listener');

    for (const slave of slaves) {
      try {
        switch (event.type) {
          case 'click':
            if (await slave.$(event.selector)) await slave.click(event.selector);
            break;
          case 'input':
            if (await slave.$(event.selector)) {
              await slave.focus(event.selector);
              await slave.$eval(event.selector, el => el.value = '');
              await slave.type(event.selector, event.value);
            }
            break;
          case 'scroll':
            await slave.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), event.scrollY);
            break;
          case 'urlChange':
            const currentUrl = await slave.url();
            if (currentUrl !== event.url) {
              try {
                await slave.goto(event.url, { waitUntil: 'networkidle2' });
              } catch (err) {
                console.error(`Error navigating to ${event.url} on slave:`, err);
              }
            }
            break;
        }
      } catch (err) {
        console.error(`❗ Error syncing event ${event.type}:`, err);
      }
    }
  });

  const injectEventListeners = async (page) => {
    await page.evaluate(() => {
      if (window._syncAlreadyInjected) return;
      window._syncAlreadyInjected = true;

      function getSelector(el) {
        if (el.id) return `#${el.id}`;
        if (el.className) return '.' + el.className.split(' ').join('.');
        return el.tagName.toLowerCase();
      }

      const inputCache = new Map();

      console.log('[Sync] injecting input listener');
      document.addEventListener('input', (e) => {
        const selector = getSelector(e.target);
        const newValue = e.target.value;

        if (document.activeElement !== e.target) return;
        if (inputCache.get(selector) === newValue) return;

        inputCache.set(selector, newValue);

        if (typeof window.onUserEvent === 'function') {
          console.log('[Sync] input:', selector, '=>', newValue);
          window.onUserEvent({
            type: 'input',
            selector,
            value: newValue
          });
        }
      });

      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href) {
          const href = link.href;
          const isNewTab = link.target === '_blank' || e.ctrlKey || e.metaKey || e.button === 1;
      
          // ✅ 무조건 새탭 방지 후 현재 탭으로 이동 유도
          if (isNewTab) {
            e.preventDefault();
            console.log('[Sync] forcing single-tab nav (was _blank):', href);
      
            if (typeof window.onUserEvent === 'function') {
              window.onUserEvent({ type: 'urlChange', url: href });
            }
      
            // 슬레이브도 이동하게 하고 마스터도 직접 이동
            setTimeout(() => { location.href = href }, 50);
            return;
          }
        }
      
        if (typeof window.onUserEvent === 'function') {
          const selector = getSelector(e.target);
          console.log('[Sync] click:', selector);
          window.onUserEvent({ type: 'click', selector });
        }
      }, true);
      
      window.addEventListener('scroll', () => {
        if (typeof window.onUserEvent === 'function') {
          console.log('[Sync] scrollY:', window.scrollY);
          window.onUserEvent({ type: 'scroll', scrollY: window.scrollY });
        }
      });

      const pushState = history.pushState;
      history.pushState = function (...args) {
        pushState.apply(this, args);
        if (typeof window.onUserEvent === 'function') {
          console.log('[Sync] urlChange (pushState):', location.href);
          window.onUserEvent({ type: 'urlChange', url: location.href });
        }
      };

      window.addEventListener('popstate', () => {
        if (typeof window.onUserEvent === 'function') {
          console.log('[Sync] urlChange (popstate):', location.href);
          window.onUserEvent({ type: 'urlChange', url: location.href });
        }
      });

      window.open = function (url) {
        if (typeof window.onUserEvent === 'function') {
          console.log('[Sync] window.open hijacked:', url);
          window.onUserEvent({ type: 'urlChange', url });
        }
      
        location.href = url; // replace → href (히스토리 남게)
        return null;
      };
      

      let lastHref = location.href;
      if (!window._intervalSet) {
        window._intervalSet = true;
        setInterval(() => {
          const currentHref = location.href;
          if (currentHref !== lastHref) {
            lastHref = currentHref;
            if (typeof window.onUserEvent === 'function') {
              console.log('[Sync] urlChange (setInterval):', currentHref);
              window.onUserEvent({ type: 'urlChange', url: currentHref });
            }
          }
        }, 300);
      }
    });
  };

  await injectEventListeners(master);
  console.log('✅ Event listeners injected to master');
  for (const slave of slaves) {
    await injectEventListeners(slave);
  }
}

function monitorViewport(page) {
  setInterval(async () => {
    try {
      await page._client().send('Emulation.clearDeviceMetricsOverride');
      await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    } catch (err) {
      // 창 닫혔을 수도 있으므로 무시
    }
  }, 2000);
}

module.exports = { startSync };
