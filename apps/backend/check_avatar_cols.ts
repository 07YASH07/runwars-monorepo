const { pool } = require('./src/db/index');
pool.query(`
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_name = 'users' 
  AND column_name IN ('selected_avatar', 'unlocked_avatars', 'expo_push_token')
  ORDER BY column_name
`).then((r: any) => {
  console.log('Avatar columns found:', JSON.stringify(r.rows));
  
  // Run migrations manually if columns are missing
  const missing = ['selected_avatar', 'unlocked_avatars', 'expo_push_token'].filter(
    col => !r.rows.find((row: any) => row.column_name === col)
  );
  
  if (missing.length > 0) {
    console.log('Missing columns, running manual migration...');
    return Promise.all([
      pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_avatar TEXT DEFAULT '🏃'"),
      pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_avatars TEXT[] DEFAULT ARRAY['⚔️','🥷','🧙','🏃']"),
      pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT"),
    ]).then(() => {
      console.log('Manual migration complete!');
    });
  } else {
    console.log('All columns already exist!');
  }
}).then(() => pool.end()).catch((e: any) => { console.error(e.message); pool.end(); });
