import { pool } from './index';
import * as fs from 'fs';
import * as path from 'path';

async function migrateV4() {
  console.log('[Migrate v4] Starting v4 database migration (Avatar Rewards)...');
  const sql = fs.readFileSync(path.join(__dirname, 'migrate-v4.sql'), 'utf8');
  
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      console.log(`[Migrate v4] ✅ OK: ${stmt.substring(0, 60)}...`);
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log(`[Migrate v4] ⚠️  Already exists (skipped): ${stmt.substring(0, 60)}`);
      } else {
        console.error(`[Migrate v4] ❌ Error: ${err.message}`);
        console.error(`  Statement: ${stmt}`);
      }
    }
  }
  console.log('[Migrate v4] Migration complete!');
  await pool.end();
}

migrateV4().catch(console.error);
