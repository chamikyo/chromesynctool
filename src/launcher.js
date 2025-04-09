const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

async function launchChromeInstances(count) {
  const startPort = 9222;
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf-8'));
  const profiles = settings.profiles;
  const userDataRoot = settings.userDataRoot;

  const promises = [];

  for (let i = 0; i < count; i++) {
    const port = startPort + i;
    const profile = profiles[i % profiles.length];

    const chromeCmd = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"` +
      ` --remote-debugging-port=${port}` +
      ` --user-data-dir="${userDataRoot}"` +
      ` --profile-directory="${profile}"` +
      ` --new-window` +
      ` --window-size=1440,900`;

    console.log(`✅ Chrome launching on port ${port} | profile: ${profile}`);

    promises.push(new Promise((resolve, reject) => {
      exec(chromeCmd, (err) => {
        if (err) reject(err);
        else resolve({ port, profile });
      });
    }));
  }

  return Promise.all(promises);
}

module.exports = { launchChromeInstances };
