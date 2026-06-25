const localtunnel = require('localtunnel');

const PORT = 3000;
const SUBDOMAIN = 'runwars-india-live';
let activeTunnel = null;
let pingIntervalId = null;

async function startTunnel() {
  console.log(`[Tunnel] Requesting tunnel for port ${PORT} with subdomain "${SUBDOMAIN}"...`);
  try {
    if (pingIntervalId) {
      clearInterval(pingIntervalId);
      pingIntervalId = null;
    }

    const tunnel = await localtunnel({ 
      port: PORT, 
      subdomain: SUBDOMAIN,
      local_host: '127.0.0.1'
    });

    activeTunnel = tunnel;
    console.log(`[Tunnel] Tunnel established. URL: ${tunnel.url}`);

    // Verify if we got the requested subdomain
    if (!tunnel.url.includes(SUBDOMAIN)) {
      console.warn(`[Tunnel] Warning: Assigned URL "${tunnel.url}" does not match requested subdomain "${SUBDOMAIN}".`);
      console.log(`[Tunnel] Closing tunnel and retrying in 10 seconds to allow ghost sessions to clear...`);
      await tunnel.close();
      setTimeout(startTunnel, 10000);
      return;
    }

    console.log(`[Tunnel] Successfully secured requested subdomain: ${tunnel.url}`);

    // Start self-healing ping check every 30 seconds
    pingIntervalId = setInterval(async () => {
      try {
        const pingUrl = `${tunnel.url}/health`;
        const res = await fetch(pingUrl, {
          headers: { 'Bypass-Tunnel-Reminder': 'true' },
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) {
          throw new Error(`Unhealthy status: ${res.status}`);
        }
        // Ping succeeded
      } catch (err) {
        console.warn(`[Tunnel] Self-healing alert: Ping failed (${err.message}). Restarting tunnel...`);
        if (activeTunnel) {
          await activeTunnel.close().catch(() => {});
          activeTunnel = null;
        }
        clearInterval(pingIntervalId);
        pingIntervalId = null;
        setTimeout(startTunnel, 2000);
      }
    }, 30000);

    tunnel.on('close', () => {
      console.log('[Tunnel] Tunnel connection closed. Reconnecting in 5 seconds...');
      if (pingIntervalId) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
      }
      setTimeout(startTunnel, 5000);
    });

    tunnel.on('error', (err) => {
      console.error('[Tunnel] Tunnel error:', err.message || err);
      tunnel.close();
    });

  } catch (err) {
    console.error('[Tunnel] Error establishing tunnel:', err.message || err);
    console.log('[Tunnel] Retrying in 5 seconds...');
    setTimeout(startTunnel, 5000);
  }
}

startTunnel();
