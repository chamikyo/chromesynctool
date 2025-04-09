const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { launchChromeInstances } = require('./launcher');
const puppeteer = require('puppeteer');
const { startSync } = require('./sync');
const http = require('http');
let profileWin = null;
const fs = require('fs');
const settingsPath = path.join(__dirname, 'settings.json');

const REMOTE_DEBUG_PORTS = Array.from({ length: 20 }, (_, i) => 9222 + i);
let win;

function waitUntilChromeReady(port) {
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(`http://localhost:${port}/json/version`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(check, 300);
        }
      });
      req.on('error', () => setTimeout(check, 300));
    };
    check();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile(path.join(__dirname, 'gui.html'));
}

function openProfileListWindow() {
  const profileWin = new BrowserWindow({
    width: 500,
    height: 800,
    title: '계정 경로 설정',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  profileWin.loadFile(path.join(__dirname, 'profiles.html'));
}


app.whenReady().then(createWindow);

ipcMain.handle('launch-chromes', async (_, count) => {
  try {
    const instances = await launchChromeInstances(count);
    await Promise.all(
      instances.map(async (_, i) => {
        const port = REMOTE_DEBUG_PORTS[i];
        await waitUntilChromeReady(port);
        console.log(`✅ 포트 ${port} 준비 완료`);
      })
    );
    return { success: true, length: instances.length };
  } catch (error) {
    console.error('❌ Failed to launch chromes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-browser-list', async (_, count) => {
  const pages = [];
  for (let i = 0; i < count; i++) {
    const port = REMOTE_DEBUG_PORTS[i];
    try {
      const browserURL = `http://localhost:${port}`;
      const browser = await puppeteer.connect({ browserURL });
      const page = (await browser.pages())[0];
      const title = await page.title();
      const url = page.url();
      pages.push({ index: i, port, title, url });
    } catch (e) {
      pages.push({ index: i, port, title: '[연결 실패]', url: '' });
    }
  }
  return pages;
});

ipcMain.handle('start-sync', async (_, masterIndex, count) => {
  console.log(`🔁 Sync requested: master=${masterIndex}, count=${count}`);
  try {
    await startSync(masterIndex, count);
    console.log("✅ Sync started successfully");
    return { success: true };
  } catch (err) {
    console.error("❌ Failed to start sync:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-master-alert', async (_, masterIndex) => {
  try {
    const port = REMOTE_DEBUG_PORTS[masterIndex];
    const browserURL = `http://localhost:${port}`;
    const browser = await puppeteer.connect({ browserURL });
    const page = (await browser.pages())[0];
    await page.evaluate(() => {
      alert("이 페이지는 마스터 페이지입니다");
    });
    await page.evaluate(() => {
      const existing = document.querySelector('#master-banner');
      if (existing) return;
      const msg = document.createElement('div');
      msg.id = 'master-banner';
      msg.textContent = '✅ 마스터 페이지';
      msg.style.position = 'fixed';
      msg.style.top = '10px';
      msg.style.left = '10px';
      msg.style.background = 'rgba(113, 113, 113, 0.5)';
      msg.style.color = '#fff';
      msg.style.padding = '5px 10px';
      msg.style.fontSize = '10px';
      msg.style.fontWeight = '400';
      msg.style.borderRadius = '4px';
      msg.style.zIndex = '99999';
      document.body.appendChild(msg);
    });
  } catch (err) {
    console.error("❗ Failed to show master alert:", err);
  }
});

ipcMain.handle('close-all-chromes', async () => {
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'darwin') {
      execSync(`pkill -f 'Google Chrome.*--remote-debugging-port='`);
    } else if (process.platform === 'win32') {
      execSync(`taskkill /IM chrome.exe /F`);
    } else {
      execSync(`pkill chrome`);
    }
    return { success: true };
  } catch (err) {
    console.error("❌ Failed to close Chrome windows:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-profile-list', async () => {
  if (profileWin) {
    profileWin.focus();
    return;
  }

  profileWin = new BrowserWindow({
    width: 480,
    height: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  profileWin.on('closed', () => {
    profileWin = null;
  });

  profileWin.loadFile(path.join(__dirname, 'profile-list.html'));
});


ipcMain.handle('get-settings', () => {
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw);
  } else {
    return { profiles: Array.from({ length: 20 }, (_, i) => `Profile ${i + 1}`) };
  }
});

ipcMain.handle('save-settings', async (_, updatedSettings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
    return { success: true };
  } catch (err) {
    console.error('❌ Failed to save settings:', err);
    return { success: false, error: err.message };
  }
});


// settings 저장도 필요함
ipcMain.handle('save-user-data-root', async (_, newPath) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    settings.userDataRoot = newPath;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (err) {
    console.error('❌ Failed to save settings:', err);
    return { success: false, error: err.message };
  }
});
