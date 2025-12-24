-- Create users table to separate user authentication from portfolios
-- This enables multiple portfolios per user account

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index on username for faster lookups during login
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public access (authentication will be handled in backend)
CREATE POLICY "Allow public access to users for authentication" ON users
    FOR SELECT
    TO public
    USING (true);

-- Add comment explaining the table
COMMENT ON TABLE users IS 'User accounts - separated from portfolios to enable multiple portfolios per account';
COMMENT ON COLUMN users.id IS 'Unique user identifier (UUID)';
COMMENT ON COLUMN users.username IS 'Username for login - must be unique';
COMMENT ON COLUMN users.password_hash IS 'SHA-256 hash of user password';
