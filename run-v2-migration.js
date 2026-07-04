/**
 * RunWars v2 - Remote DB Migration Runner
 * Runs the v2 SQL migration directly against Supabase using DATABASE_URL from .env
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, 'apps/backend/.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = fs.readFileSync(
  path.join(__dirname, 'apps/backend/src/db/migrate-v2.sql'),
  'utf8'
);

// Split into individual statements, skip comments and blanks
const statements = sql
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 10);

async function run() {
  console.log(`\n🚀 RunWars v2 DB Migration\n${'─'.repeat(40)}`);
  let ok = 0, skipped = 0, failed = 0;
  
  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 70);
    try {
      await pool.query(stmt);
      console.log(`✅ ${preview}`);
      ok++;
    } catch (err) {
      if (err.message.includes('already exists') || err.message.includes('duplicate')) {
        console.log(`⚠️  Already exists: ${preview}`);
        skipped++;
      } else {
        console.error(`❌ FAILED: ${preview}`);
        console.error(`   Error: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`✅ ${ok} succeeded | ⚠️  ${skipped} skipped | ❌ ${failed} failed`);
  
  if (failed === 0) {
    console.log('\n🎉 v2 migration complete! Database is ready.\n');
  } else {
    console.log('\n⚠️  Some statements failed - review above.\n');
  }
  
  await pool.end();
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
