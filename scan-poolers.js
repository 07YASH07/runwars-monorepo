const { Client } = require('pg');

const projectRef = 'eoeiohzjbnpbkfnkcywq';
const password = 'HS%233%24BeyW8X%23mQC'; // URL encoded: HS#3$BeyW8X#mQC

const regions = [
  'ap-southeast-1', // Singapore (likely, based on IPv6 prefix)
  'ap-south-1',     // Mumbai
  'ap-southeast-2', // Sydney
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'us-east-1',      // N. Virginia
  'us-east-2',      // Ohio
  'us-west-1',      // N. California
  'us-west-2',      // Oregon
  'eu-west-1',      // Ireland
  'eu-west-2',      // London
  'eu-west-3',      // Paris
  'eu-central-1',   // Frankfurt
  'eu-north-1',     // Stockholm
  'sa-east-1',      // São Paulo
  'ca-central-1'    // Canada Central
];

const indexes = [0, 1, 2, 3, 4, 5];

async function scan() {
  console.log(`🔍 Scanning poolers for project ${projectRef}...`);
  
  for (const region of regions) {
    for (const idx of indexes) {
      const host = `aws-${idx}-${region}.pooler.supabase.com`;
      const connectionString = `postgresql://postgres.${projectRef}:${password}@${host}:6543/postgres`;
      
      console.log(`Testing: ${host}...`);
      
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: 4000 // 4 seconds timeout
      });
      
      try {
        await client.connect();
        const res = await client.query('SELECT 1 as connected');
        if (res.rows.length > 0) {
          console.log(`\n🎉 WORKING POOLER FOUND!`);
          console.log(`Host: ${host}`);
          console.log(`Connection string:\n${connectionString}\n`);
          await client.end();
          return;
        }
      } catch (err) {
        if (err.message.includes('tenant/user') && err.message.includes('not found')) {
          // Silent: wrong region or index
        } else {
          console.log(`   [${host}] Error: ${err.message}`);
        }
      } finally {
        try {
          await client.end();
        } catch (e) {}
      }
    }
  }
  
  console.log('\n❌ Done scanning. No working pooler host found.');
}

scan();
