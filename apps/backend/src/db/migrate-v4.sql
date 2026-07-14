-- ============================================================
-- StrideClash v4.0 - Database Migration Script
-- Adds avatar reward system (milestone & coin-based)
-- Safe to run multiple times (all statements use IF NOT EXISTS / DO NOTHING)
-- ============================================================

-- 1. Add selected_avatar column to users (which emoji/avatar they currently display)
ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_avatar TEXT DEFAULT '🏃';

-- 2. Add unlocked_avatars column (array of all avatars this user has earned)
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_avatars TEXT[] DEFAULT ARRAY['⚔️', '🥷', '🧙', '🏃'];

-- 3. Add followers table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS followers (
  id SERIAL PRIMARY KEY,
  follower_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  following_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS followers_follower_idx ON followers (follower_id);
CREATE INDEX IF NOT EXISTS followers_following_idx ON followers (following_id);

-- 4. Add expo_push_token column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT;
