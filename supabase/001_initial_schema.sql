-- Bam P2P File Sharing - Initial Database Schema
-- This migration creates all necessary tables and functions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  daily_files_count INTEGER NOT NULL DEFAULT 0,
  xp_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- File Transfers Table
CREATE TABLE IF NOT EXISTS file_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  file_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('burn', 'seed')),
  link_id TEXT NOT NULL UNIQUE,
  password_protected BOOLEAN NOT NULL DEFAULT FALSE,
  downloads_count INTEGER NOT NULL DEFAULT 0,
  max_downloads INTEGER,
  expires_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX idx_file_transfers_sender_id ON file_transfers(sender_id);
CREATE INDEX idx_file_transfers_link_id ON file_transfers(link_id);
CREATE INDEX idx_file_transfers_status ON file_transfers(status);
CREATE INDEX idx_file_transfers_created_at ON file_transfers(created_at DESC);

-- Function to increment download count
CREATE OR REPLACE FUNCTION increment_download_count(link_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE file_transfers
  SET 
    downloads_count = downloads_count + 1,
    updated_at = NOW()
  WHERE file_transfers.link_id = increment_download_count.link_id;
END;
$$;

-- Function to increment daily files count
CREATE OR REPLACE FUNCTION increment_daily_files(user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_profiles
  SET 
    daily_files_count = daily_files_count + 1,
    updated_at = NOW()
  WHERE id = user_id;
END;
$$;

-- Function to reset daily file counts (should be run daily via cron)
CREATE OR REPLACE FUNCTION reset_daily_file_counts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_profiles
  SET 
    daily_files_count = 0,
    updated_at = NOW()
  WHERE tier = 'free';
END;
$$;

-- Function to expire old transfers (should be run periodically via cron)
CREATE OR REPLACE FUNCTION expire_old_transfers()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE file_transfers
  SET 
    status = 'expired',
    updated_at = NOW()
  WHERE 
    status = 'active' 
    AND expires_at IS NOT NULL 
    AND expires_at < NOW();
END;
$$;

-- Function to auto-complete burn transfers after first download
CREATE OR REPLACE FUNCTION check_burn_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mode = 'burn' AND NEW.downloads_count >= 1 THEN
    NEW.status = 'completed';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger to auto-complete burn transfers
CREATE TRIGGER trigger_burn_transfer
BEFORE UPDATE ON file_transfers
FOR EACH ROW
EXECUTE FUNCTION check_burn_transfer();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Triggers for updated_at
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_file_transfers_updated_at
BEFORE UPDATE ON file_transfers
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_transfers ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
CREATE POLICY "Users can view their own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- File Transfers Policies
CREATE POLICY "Users can view their own transfers"
  ON file_transfers FOR SELECT
  USING (auth.uid() = sender_id OR (auth.uid() IS NULL AND sender_id IS NULL));

CREATE POLICY "Anyone can view active transfers by link_id"
  ON file_transfers FOR SELECT
  USING (status = 'active');

CREATE POLICY "Anyone can insert transfers"
  ON file_transfers FOR INSERT
  WITH CHECK (auth.uid() = sender_id OR (auth.uid() IS NULL AND sender_id IS NULL));

CREATE POLICY "Anyone can update transfers by link_id"
  ON file_transfers FOR UPDATE
  USING (status = 'active');

-- Enable Realtime for signaling
ALTER PUBLICATION supabase_realtime ADD TABLE file_transfers;

-- Comments
COMMENT ON TABLE user_profiles IS 'User profiles with gamification data';
COMMENT ON TABLE file_transfers IS 'P2P file transfer records';
COMMENT ON FUNCTION increment_download_count IS 'Increments download count for a file transfer';
COMMENT ON FUNCTION increment_daily_files IS 'Increments daily file count for a user';
COMMENT ON FUNCTION reset_daily_file_counts IS 'Resets daily file counts for free users (run daily)';
COMMENT ON FUNCTION expire_old_transfers IS 'Marks expired transfers as expired (run periodically)';
