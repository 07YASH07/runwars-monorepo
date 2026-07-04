async function checkLocal() {
  const url = 'https://houses-tree-discuss-underground.trycloudflare.com/health';
  console.log(`🌐 Pinging Local Cloudflare tunnel health endpoint: ${url}...`);
  try {
    const res = await fetch(url, {
      headers: { 'Bypass-Tunnel-Reminder': 'true' },
      signal: AbortSignal.timeout(10000)
    });
    console.log(`Status Code: ${res.status}`);
    const text = await res.text();
    console.log(`Response Body:`, text);
  } catch (err) {
    console.log(`❌ Error fetching local tunnel: ${err.message}`);
  }
}

checkLocal();
