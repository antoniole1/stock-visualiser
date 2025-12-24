# Multi-Portfolio Migration Guide

## Overview

This guide walks through the database migration needed to support multiple portfolios per user account. The migration happens in two stages:

1. **SQL Migrations** - Create schema changes in Supabase
2. **Python Migration Script** - Migrate existing data to new schema

## Prerequisites

- Supabase credentials configured in `.env`
- Access to Supabase SQL editor or `supabase-cli` installed
- Python 3.7+ with required dependencies (`pip install -r requirements.txt`)
- **BACKUP** your database before proceeding

## Stage 1: Apply SQL Migrations

### Option A: Using Supabase Dashboard

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **SQL Editor**
4. Create a new query
5. Copy and paste the contents of `migrations/002_create_users_table.sql`
6. Run the query and wait for completion
7. Repeat for `migrations/003_modify_portfolios_table.sql`

### Option B: Using Command Line (if supabase-cli is installed)

```bash
# Apply migrations using supabase CLI
supabase migration up

# Or manually:
psql [connection_string] < migrations/002_create_users_table.sql
psql [connection_string] < migrations/003_modify_portfolios_table.sql
```

### What These Migrations Do

**Migration 002 - Create Users Table:**
- Creates new `users` table with:
  - `id` (UUID primary key)
  - `username` (unique)
  - `password_hash`
  - `created_at` / `updated_at` timestamps
- Creates index on `username` for fast login lookups
- Enables Row Level Security (RLS)

**Migration 003 - Modify Portfolios Table:**
- Adds `id` (UUID) primary key
- Adds `user_id` (UUID) foreign key to `users` table
- Adds `is_default` (BOOLEAN) to track active portfolio
- Removes old `(username, password_hash)` unique constraint
- Adds new unique constraint on `(user_id, portfolio_name)`
- Creates indexes for performance

## Stage 2: Run Python Migration Script

### Prerequisites for Migration Script

```bash
# Ensure environment variables are set in .env
# Required:
# - SUPABASE_URL
# - SUPABASE_KEY

# Verify your environment:
cat .env | grep SUPABASE
```

### Dry-Run (Recommended First Step)

Always run in dry-run mode first to see what changes will be made:

```bash
python3 migrate_to_multi_portfolio.py --dry-run
```

Expected output:
```
[2024-12-24 10:30:45] ✓ Connected to Supabase
[2024-12-24 10:30:46] ✓ Found 3 unique users in 3 portfolios
[2024-12-24 10:30:46] ✓ [DRY-RUN] Would create user 'john_doe'
[2024-12-24 10:30:46] ✓ [DRY-RUN] Would create user 'jane_smith'
[2024-12-24 10:30:46] ✓ [DRY-RUN] Would create user 'bob_johnson'
[2024-12-24 10:30:46] ✓ Updated portfolio '...' in dry-run
...
✓ DRY-RUN COMPLETED - No changes were made to the database
```

### Execute Migration

Once you've verified the dry-run output:

```bash
python3 migrate_to_multi_portfolio.py
```

Expected output (actual run):
```
[2024-12-24 10:31:45] ✓ Connected to Supabase
[2024-12-24 10:31:46] ✓ Found 3 unique users in 3 portfolios
[2024-12-24 10:31:46] ✓ Created user 'john_doe' (id: a1b2c3d4-...)
[2024-12-24 10:31:47] ✓ Created user 'jane_smith' (id: b2c3d4e5-...)
[2024-12-24 10:31:47] ✓ Created user 'bob_johnson' (id: c3d4e5f6-...)
[2024-12-24 10:31:48] ✓ Updated portfolio 'd1e2f3g4-...': Set user_id=a1b2c3d4..., is_default=true
[2024-12-24 10:31:49] ✓ All portfolios have user_id assigned
[2024-12-24 10:31:50] ✓ All 3 users have at least one portfolio

Migration Summary:
  - Users created: 3
  - Portfolios updated: 3
  - Total users in DB: 3
  - Total portfolios in DB: 3
  - Errors: 0
  - Warnings: 0

✓ MIGRATION COMPLETED SUCCESSFULLY
```

### Verbose Mode

For detailed logging during migration:

```bash
python3 migrate_to_multi_portfolio.py --verbose
```

## Verification

After migration completes, verify the data manually in Supabase:

### Check Users Table
```sql
SELECT COUNT(*) as user_count FROM users;
SELECT * FROM users LIMIT 10;
```

Should show all unique users created.

### Check Portfolios
```sql
SELECT id, user_id, portfolio_name, is_default
FROM portfolios
LIMIT 10;
```

Should show all portfolios have `user_id` assigned and `is_default` set.

### Check for Issues
```sql
-- Find portfolios without user_id (should return 0 rows)
SELECT COUNT(*) FROM portfolios WHERE user_id IS NULL;

-- Find users without a default portfolio (should return 0 rows)
SELECT u.id, u.username
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.user_id = u.id AND p.is_default = TRUE
);

-- Find duplicate portfolio names per user (should return 0 rows)
SELECT user_id, portfolio_name, COUNT(*)
FROM portfolios
GROUP BY user_id, portfolio_name
HAVING COUNT(*) > 1;
```

## Rollback Plan

If something goes wrong, you can rollback:

### Option 1: Restore from Backup
```bash
# Supabase automatically creates backups
# Go to Supabase Dashboard → Database → Backups
# Click "Restore" on the backup before migration
```

### Option 2: Manual Rollback (SQL)
```sql
-- Only if you know what you're doing!
-- Drop user_id constraints and columns
ALTER TABLE portfolios DROP CONSTRAINT fk_portfolios_user_id;
ALTER TABLE portfolios DROP COLUMN user_id;
ALTER TABLE portfolios DROP COLUMN is_default;

-- Drop users table
DROP TABLE users;
```

## Troubleshooting

### Error: "SUPABASE_URL and SUPABASE_KEY not found"
**Solution:** Make sure `.env` file exists in project root with:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
```

### Error: "Failed to create user: unique violation"
**Solution:** User with that username already exists in `users` table. Script will skip and continue.

### Error: "Foreign key constraint violation"
**Solution:** Ensure SQL migrations 002 and 003 were applied successfully before running Python script.

### Some portfolios have NULL user_id
**Solution:** Check that all users were created in Step 1. If usernames are duplicated with different passwords, manually handle as needed.

### Script hangs or times out
**Solution:**
- Check network connectivity to Supabase
- Try smaller batches if you have many portfolios
- Check Supabase status page for outages

## What Happens Next

After migration is complete:

1. **Phase 2 (Backend)** - Update API endpoints to use new schema
   - Login returns portfolio list
   - New CRUD endpoints for portfolios
   - Session storage updated

2. **Phase 3 (Frontend)** - Add UI for portfolio selection
   - Portfolio landing page after login
   - Update state management

3. **Phase 4 (Frontend)** - Portfolio switcher dropdown
   - Top-right user profile dropdown
   - Create/rename/delete portfolio options

4. **Testing** - Full workflow testing across all platforms

## Backup Your Data

Before proceeding, backup your database:

### Supabase Backup
1. Go to Supabase Dashboard
2. Select your project
3. Click "Settings" → "Backups"
4. Click "Request a backup"

### Export Data
```sql
-- Export users
\copy (SELECT * FROM users) TO 'users_backup.csv' CSV HEADER;

-- Export portfolios
\copy (SELECT * FROM portfolios) TO 'portfolios_backup.csv' CSV HEADER;
```

## Questions?

Refer to the main `IMPLEMENTATION_PLAN.txt` for:
- Overall architecture changes
- Phase descriptions
- Integration with other phases
- User requirements and design specifications

---

**Migration Date:** [Record when you run this]
**Backup Timestamp:** [Record your backup time]
**Completed By:** [Your name]
**Status:** ☐ Dry-Run Successful | ☐ Migration Successful | ☐ Verification Complete
