const fs = require('fs');
const path = require('path');

const URL_FILE_PATH = path.join(__dirname, 'active-tunnel-url.txt');
const DEFAULT_URL = 'https://runwars-india-live.loca.lt';
const LOG_FILE = path.join(__dirname, 'connection-check.log');

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(line.trim());
  fs.appendFileSync(LOG_FILE, line);
}

function getTunnelUrl() {
  if (fs.existsSync(URL_FILE_PATH)) {
    try {
      const url = fs.readFileSync(URL_FILE_PATH, 'utf8').trim();
      if (url.startsWith('http')) {
        return `${url}/health`;
      }
    } catch (e) {}
  }
  return `${DEFAULT_URL}/health`;
}

async function check() {
  const url = getTunnelUrl();
  try {
    const res = await fetch(url, {
      headers: { 'Bypass-Tunnel-Reminder': 'true' },
      signal: AbortSignal.timeout(15000) // 15s timeout
    });
    
    if (!res.ok) {
      log(`ERROR: HTTP status ${res.status} for ${url}`);
      return;
    }
    
    const body = await res.json();
    if (body.status === 'ok' && body.db === 'connected') {
      log(`OK: Connected. Players: ${body.playersCount}, Territories: ${body.territoriesCount}, DB: ${body.db}`);
    } else {
      log(`WARNING: Server responded, but state unhealthy: ${JSON.stringify(body)}`);
    }
  } catch (err) {
    log(`ERROR: Failed to connect to tunnel: ${err.message}`);
  }
}

if (process.argv.includes('--loop')) {
  log('Starting connection checker loop (every 1 minute)...');
  check();
  setInterval(check, 60000);
} else {
  check();
}
