import { pool } from './index';
import * as fs from 'fs';
import * as path from 'path';

async function migrateV3() {
  console.log('[Migrate v3] Starting v3 database migration...');
  const sql = fs.readFileSync(path.join(__dirname, 'migrate-v3.sql'), 'utf8');
  
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      console.log(`[Migrate v3] ✅ OK: ${stmt.substring(0, 60)}...`);
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log(`[Migrate v3] ⚠️  Already exists (skipped): ${stmt.substring(0, 60)}`);
      } else {
        console.error(`[Migrate v3] ❌ Error: ${err.message}`);
        console.error(`  Statement: ${stmt}`);
      }
    }
  }
  console.log('[Migrate v3] Migration complete!');
  await pool.end();
}

migrateV3().catch(console.error);
