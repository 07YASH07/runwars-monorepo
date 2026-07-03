-- ============================================================
-- RunWars v2.0 - Database Migration Script
-- Safe to run on the SAME Supabase instance as production.
-- All changes are ADDITIVE ONLY (new tables + new columns).
-- Production server (reading only users/runs/territories) is 100% unaffected.
-- ============================================================

-- 1. Add activity_type to runs table
ALTER TABLE runs ADD COLUMN IF NOT EXISTS activity_type VARCHAR(20) DEFAULT 'run';

-- 2. Add speed audit columns to territories table (for anti-cheat)
ALTER TABLE territories ADD COLUMN IF NOT EXISTS avg_speed_kmh FLOAT DEFAULT 0;
ALTER TABLE territories ADD COLUMN IF NOT EXISTS activity_type VARCHAR(20) DEFAULT 'run';

-- 3. Posts table (user-created feed content + auto-generated territory/run cards)
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  image_url TEXT,
  post_type VARCHAR(20) DEFAULT 'user',    -- 'user' | 'territory' | 'announcement'
  related_id VARCHAR(128),                  -- territory ID or run ID if auto-generated
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_user_idx ON posts (user_id);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC);

-- 4. Likes table (one like per user per post, unique constraint enforces toggle)
CREATE TABLE IF NOT EXISTS likes (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  post_id INT REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);
CREATE INDEX IF NOT EXISTS likes_post_idx ON likes (post_id);

-- 5. Comments table
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  post_id INT REFERENCES posts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments (post_id);

-- 6. Announcements table (admin broadcasts → show in Feed natively)
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  created_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VERIFICATION QUERIES (run after migration to check)
-- ============================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'runs';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'territories';
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
