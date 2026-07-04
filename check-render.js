async function checkRender() {
  const url = 'https://runwars-monorepo.onrender.com/health';
  console.log(`🌐 Pinging Render health endpoint: ${url}...`);
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

checkRender();
