-- RunWars Database Schema (Phase 4)
-- Uses JSONB for coordinates instead of PostGIS for simplicity

-- Migration patch for existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(128) PRIMARY KEY,
  email VARCHAR(255),
  display_name VARCHAR(100),
  avatar_url TEXT,
  bio TEXT,
  character_type VARCHAR(50),
  color VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  route_points JSONB NOT NULL DEFAULT '[]',
  distance_meters FLOAT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS territories (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  polygon_coordinates JSONB NOT NULL DEFAULT '[]',
  area_square_meters FLOAT DEFAULT 0,
  color VARCHAR(20),
  run_session_id VARCHAR(64),
  claimed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast JSON queries
CREATE INDEX IF NOT EXISTS territories_owner_idx ON territories (owner_id);
CREATE INDEX IF NOT EXISTS runs_user_idx ON runs (user_id);
