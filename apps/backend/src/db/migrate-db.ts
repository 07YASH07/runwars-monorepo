import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ Error: DATABASE_URL is not set in apps/backend/.env');
  process.exit(1);
}

console.log('🔗 Connecting to database...');
const pool = new Pool({ connectionString });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('✅ Connected successfully.');
    
    // 1. Enable PostGIS
    console.log('📦 Enabling PostGIS extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
    console.log('✅ PostGIS extension enabled.');

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    // 3. Execute schema
    console.log('🚀 Running database schema migrations...');
    await client.query(schemaSql);
    console.log('🎉 Database migrations completed successfully!');

  } catch (err: any) {
    console.error('❌ Database migration failed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
