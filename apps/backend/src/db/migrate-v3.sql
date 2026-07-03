-- Create Friends Table
CREATE TABLE IF NOT EXISTS friends (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  friend_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Extend Users table columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INT DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_colors TEXT[] DEFAULT '{"#FF4D4D", "#1E90FF"}';
