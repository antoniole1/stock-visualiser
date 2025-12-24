# Fixing RLS Policy for Users Table

The migration failed because Row Level Security (RLS) policy on the `users` table is preventing INSERT operations.

## Quick Fix (2 steps)

### Step 1: Disable RLS on Users Table

Go to **Supabase Dashboard** → **SQL Editor** and run this SQL:

```sql
-- Disable RLS on users table temporarily for migration
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
```

This will allow the migration script to create user records.

### Step 2: Run Migration Again

Once you've disabled RLS, run the migration:

```bash
python3 run_migration.py --execute
```

Expected output:
```
✓ Created user: antoniole (id: ...)
✓ Created user: antonio 1 (id: ...)
✓ Successfully created/found 2 users
✓ Updated portfolio: My Portfolio (default=true)
✓ Successfully updated 2 portfolios
✓ MIGRATION COMPLETED SUCCESSFULLY
```

### Step 3: Re-enable RLS (Optional but Recommended)

After migration completes successfully, you can re-enable RLS for production:

```sql
-- Re-enable RLS on users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows public INSERT for registration
CREATE POLICY "Allow public insert to users" ON users
    FOR INSERT
    TO public
    WITH CHECK (true);

-- Create a policy that allows SELECT
CREATE POLICY "Allow public select from users" ON users
    FOR SELECT
    TO public
    USING (true);
```

## Why This Happened

The `users` table has RLS enabled but no INSERT policies defined. RLS blocks all operations by default unless explicitly allowed by a policy.

Since the Supabase SDK is using the anon (public) key, it can't INSERT without a policy allowing it.

## Detailed Steps

### Via Supabase Web Dashboard:

1. Go to https://app.supabase.com
2. Select your project
3. Click **SQL Editor** on the left sidebar
4. Click **New Query**
5. Copy this SQL:
   ```sql
   ALTER TABLE users DISABLE ROW LEVEL SECURITY;
   ```
6. Click **Run** (or press Ctrl+Enter)
7. You should see: `✓ Success. No rows returned`
8. Go back to your terminal and run:
   ```bash
   python3 run_migration.py --execute
   ```

### Via Command Line (if you have supabase-cli):

```bash
supabase sql
-- Then paste:
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
```

## Verification

After running the migration, verify in Supabase:

1. Go to **Data Editor**
2. Click on the **users** table
3. You should see 2 users:
   - antoniole
   - antonio 1

4. Click on the **portfolios** table
5. You should see both portfolios now have a user_id assigned

## Troubleshooting

If you get an error like "relation 'users' does not exist", it means:
- The users table wasn't created yet
- Go back and run migrations 002 and 003 in SQL Editor first

If you get "permission denied" error:
- Use the **postgres** account role in SQL Editor instead of **postgres**
- Or use Supabase Studio which uses the service role key automatically

## Next Steps

Once migration completes successfully:

1. ✓ Phase 1 is complete
2. → Proceed to Phase 2: Backend API Refactoring
