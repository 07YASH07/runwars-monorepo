/**
 * RunWars v2.0 - Database Migration Runner
 * Runs migrate-v2.sql against Supabase.
 * Safe to run multiple times (all statements use IF NOT EXISTS).
 */
import { pool } from './index';
import * as fs from 'fs';
import * as path from 'path';

async function migrateV2() {
  console.log('[Migrate v2] Starting v2 database migration...');
  const sql = fs.readFileSync(path.join(__dirname, 'migrate-v2.sql'), 'utf8');
  
  // Split on semicolons and run each statement individually (skip comments)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      console.log(`[Migrate v2] ✅ OK: ${stmt.substring(0, 60)}...`);
    } catch (err: any) {
      // Ignore "already exists" errors - migration is idempotent
      if (err.message.includes('already exists')) {
        console.log(`[Migrate v2] ⚠️  Already exists (skipped): ${stmt.substring(0, 60)}`);
      } else {
        console.error(`[Migrate v2] ❌ Error: ${err.message}`);
        console.error(`  Statement: ${stmt}`);
      }
    }
  }
  console.log('[Migrate v2] Migration complete!');
  await pool.end();
}

migrateV2().catch(console.error);
