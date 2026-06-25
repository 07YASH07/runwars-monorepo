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
  pingIntervalId = setInterval(async () => {
    try {
      const res = await fetch(`${url}/health`, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' },
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) {
        throw new Error(`HTTP status ${res.status}`);
      }
    } catch (err) {
      log(`Self-healing alert: Heartbeat to ${url} failed: ${err.message}. Restarting tunnel...`);
      cleanup();
      if (cloudflaredProc) {
        cloudflaredProc.kill();
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
