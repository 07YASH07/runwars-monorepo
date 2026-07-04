const { Client } = require('pg');

const projectRef = 'eoeiohzjbnpbkfnkcywq';
const password = 'HS%233%24BeyW8X%23mQC';

async function testPort(port) {
  const host = 'aws-1-ap-southeast-1.pooler.supabase.com';
  const connectionString = `postgresql://postgres.${projectRef}:${password}@${host}:${port}/postgres`;
  
  console.log(`Testing port ${port} on ${host}...`);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000
  });
  
  try {
    await client.connect();
    const res = await client.query('SELECT 1');
    console.log(`   ✅ Success on port ${port}!`);
  } catch (err) {
    console.log(`   ❌ Failed on port ${port}: ${err.message}`);
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

async function run() {
  await testPort(6543);
  await testPort(5432);
}

run();
