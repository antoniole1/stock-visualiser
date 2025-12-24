#!/usr/bin/env python3
"""
Fix RLS policy on users table to allow inserts.
This is needed for the migration to work.
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL and SUPABASE_KEY not configured")
    exit(1)

try:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✓ Connected to Supabase")

    # The issue is that RLS policies are too restrictive
    # We need to disable RLS on users table for the migration to work
    # Go to Supabase Dashboard and run this SQL:

    sql_commands = """
-- Disable RLS on users table temporarily for migration
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- After migration, you can re-enable with appropriate policies
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
"""

    print("\n" + "="*70)
    print("FIX FOR RLS POLICY")
    print("="*70)
    print("\nYou need to DISABLE RLS on the users table temporarily.")
    print("\nGo to Supabase Dashboard → SQL Editor and run:")
    print("\n" + sql_commands)
    print("\nAfter the migration is complete, you can re-enable it with:")
    print("ALTER TABLE users ENABLE ROW LEVEL SECURITY;")
    print("\nThen run the migration again:")
    print("python3 run_migration.py --execute")
    print("="*70 + "\n")

except Exception as e:
    print(f"❌ Error: {e}")
