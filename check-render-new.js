async function checkRenderNew() {
  const url = 'https://runwars-backend1.onrender.com/health';
  console.log(`🌐 Pinging new Render URL health endpoint: ${url}...`);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    });
    console.log(`Status Code: ${res.status}`);
    const text = await res.text();
    console.log(`Response Body:`, text);
  } catch (err) {
    console.log(`❌ Error fetching Render: ${err.message}`);
  }
}

checkRenderNew();
