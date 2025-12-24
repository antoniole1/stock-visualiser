-- Modify portfolios table to support multiple portfolios per user
-- This migration adds user_id and is_default columns and updates constraints

-- Step 1: Add new columns to portfolios table if they don't exist
ALTER TABLE portfolios
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS user_id UUID,
ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

-- Step 2: Ensure the id column is set as primary key
-- Note: If portfolios table already has a primary key, we may need to drop it first
-- ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_pkey;
-- ALTER TABLE portfolios ADD PRIMARY KEY (id);

-- Step 3: Add foreign key constraint to users table
ALTER TABLE portfolios
ADD CONSTRAINT fk_portfolios_user_id
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Step 4: Drop the old unique constraint if it exists
ALTER TABLE portfolios
DROP CONSTRAINT IF EXISTS portfolios_username_password_hash_key;

-- Step 5: Add new unique constraint to allow multiple portfolios per user
-- but prevent duplicate portfolio names within the same user
ALTER TABLE portfolios
ADD CONSTRAINT unique_portfolio_per_user UNIQUE(user_id, portfolio_name);

-- Step 6: Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);

-- Step 7: Create index on is_default for portfolio selection queries
CREATE INDEX IF NOT EXISTS idx_portfolios_is_default ON portfolios(user_id, is_default);

-- Step 8: Update existing rows to have is_default = TRUE if they're the only portfolio for a user
-- This will be handled by a separate migration script in Python

-- Add comments explaining the changes
COMMENT ON COLUMN portfolios.id IS 'Unique portfolio identifier (UUID)';
COMMENT ON COLUMN portfolios.user_id IS 'Reference to user who owns this portfolio';
COMMENT ON COLUMN portfolios.is_default IS 'Flag indicating if this is the active portfolio for the user';

-- Note: The username and password_hash columns remain for backward compatibility during migration
-- They will be removed in a future cleanup migration once the data migration is confirmed successful
