const { Client } = require('pg');

const regions = [
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-north-1',
  'sa-east-1',
  'ca-central-1'
];

async function testRegions() {
  console.log('🔍 Scanning all AWS regions for the Supabase pooler...');
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const connectionString = `postgresql://postgres.eoeiohzjbnpbkfnkcywq:HS%233%24BeyW8X%23mQC@${host}:6543/postgres`;
    
    console.log(`Testing ${region}...`);
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 3000 // 3s timeout
    });
    
    try {
      await client.connect();
      const res = await client.query('SELECT 1');
      if (res.rows.length > 0) {
        console.log(`\n🎉 SUCCESS! Region is: ${region}`);
        console.log(`Connection string:\n${connectionString}\n`);
        await client.end();
        return;
      }
    } catch (err) {
      if (err.message.includes('tenant/user') && err.message.includes('not found')) {
        // Expected "not found" for wrong regions
        // console.log(`   X: Tenant not found in ${region}`);
      } else {
        console.log(`   Error in ${region}: ${err.message}`);
      }
    } finally {
      try { await client.end(); } catch (e) {}
    }
  }
  console.log('❌ Finished scanning. No active pooler region succeeded.');
}

testRegions();
