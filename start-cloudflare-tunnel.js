const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MOBILE_ENV_PATH = path.join(__dirname, 'apps', 'mobile', '.env');
const URL_FILE_PATH = path.join(__dirname, 'active-tunnel-url.txt');
const LOG_FILE = path.join(__dirname, 'connection-check.log');

let cloudflaredProc = null;
let pingIntervalId = null;
let currentUrl = null;

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [CF-Tunnel] ${msg}\n`;
  console.log(line.trim());
  fs.appendFileSync(LOG_FILE, line);
}

function updateMobileEnv(url) {
  try {
    if (!fs.existsSync(MOBILE_ENV_PATH)) {
      log(`Warning: Mobile .env not found at ${MOBILE_ENV_PATH}`);
      return;
    }
    let content = fs.readFileSync(MOBILE_ENV_PATH, 'utf8');
    
    // Replace EXPO_PUBLIC_BACKEND_URL
    content = content.replace(/EXPO_PUBLIC_BACKEND_URL=.*/g, `EXPO_PUBLIC_BACKEND_URL=${url}`);
    // Replace EXPO_PUBLIC_SOCKET_URL
    content = content.replace(/EXPO_PUBLIC_SOCKET_URL=.*/g, `EXPO_PUBLIC_SOCKET_URL=${url}`);
    
    fs.writeFileSync(MOBILE_ENV_PATH, content, 'utf8');
    log(`Updated mobile .env with URL: ${url}`);
  } catch (err) {
    log(`Error updating mobile .env: ${err.message}`);
  }
}

function updateQrCode(url) {
  try {
    const qrPath = path.join(__dirname, 'qrcode.html');
    if (fs.existsSync(qrPath)) {
      let content = fs.readFileSync(qrPath, 'utf8');
      content = content.replace(/var PUBLIC_APK_URL = ".*";/, `var PUBLIC_APK_URL = "${url}/download/strideclash.apk";`);
      fs.writeFileSync(qrPath, content, 'utf8');
      log(`Updated qrcode.html with URL: ${url}`);
    }
  } catch (err) {
    log(`Error updating qrcode.html: ${err.message}`);
  }
}

function updateApiConfig(url) {
  try {
    const apiPath = path.join(__dirname, 'apps', 'mobile', 'src', 'config', 'api.ts');
    if (fs.existsSync(apiPath)) {
      let content = fs.readFileSync(apiPath, 'utf8');
      content = content.replace(/process\.env\.EXPO_PUBLIC_BACKEND_URL \|\| '.*'/, `process.env.EXPO_PUBLIC_BACKEND_URL || '${url}'`);
      fs.writeFileSync(apiPath, content, 'utf8');
      log(`Updated apps/mobile/src/config/api.ts with URL: ${url}`);
    }
  } catch (err) {
    log(`Error updating api.ts: ${err.message}`);
  }
}

function startTunnel() {
  log('Starting Cloudflare Quick Tunnel...');
  
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  
  const cfPath = path.join(__dirname, 'cloudflared.exe');
  cloudflaredProc = spawn(cfPath, ['tunnel', '--url', `http://localhost:${PORT}`], {
    cwd: __dirname
  });
  
  let urlFound = false;
  
  const handleData = (data) => {
    const output = data.toString();
    // Search for trycloudflare.com URL
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !urlFound) {
      urlFound = true;
      currentUrl = match[0];
      log(`Tunnel URL obtained: ${currentUrl}`);
      
      // Write to active-tunnel-url.txt
      fs.writeFileSync(URL_FILE_PATH, currentUrl, 'utf8');
      
      // Update mobile .env
      updateMobileEnv(currentUrl);
      updateQrCode(currentUrl);
      updateApiConfig(currentUrl);
      
      // Start ping heartbeat
      startHeartbeat(currentUrl);
    }
  };
  
  cloudflaredProc.stdout.on('data', handleData);
  cloudflaredProc.stderr.on('data', handleData);
  
  cloudflaredProc.on('close', (code) => {
    log(`Cloudflare process exited with code ${code}`);
    cleanup();
    log('Reconnecting in 10 seconds...');
    setTimeout(startTunnel, 10000);
  });
  
  cloudflaredProc.on('error', (err) => {
    log(`Cloudflare process error: ${err.message}`);
    cleanup();
  });
}

function startHeartbeat(url) {
  let consecutiveFailures = 0;
  pingIntervalId = setInterval(async () => {
    try {
      const res = await fetch(`${url}/health`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
      }
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      log(`Warning: Heartbeat attempt ${consecutiveFailures}/3 failed: ${err.message}`);
      if (consecutiveFailures >= 3) {
        log(`Self-healing alert: 3 consecutive heartbeats to ${url} failed. Restarting tunnel...`);
        cleanup();
        if (cloudflaredProc) {
          cloudflaredProc.kill();
        }
      }
    }
  }, 30000);
}

function cleanup() {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  if (fs.existsSync(URL_FILE_PATH)) {
    try { fs.unlinkSync(URL_FILE_PATH); } catch (e) {}
  }
}

// Handle exit
process.on('SIGINT', () => {
  cleanup();
  if (cloudflaredProc) cloudflaredProc.kill();
  process.exit();
});
process.on('SIGTERM', () => {
  cleanup();
  if (cloudflaredProc) cloudflaredProc.kill();
  process.exit();
});

startTunnel();
