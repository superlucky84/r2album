-- Add signup approval workflow fields to allowed_users (DC-11)

ALTER TABLE allowed_users ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE allowed_users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE allowed_users ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_allowed_users_status ON allowed_users (status, created_at DESC);
