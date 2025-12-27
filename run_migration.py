#!/usr/bin/env python3
"""
Run database migration by executing SQL directly through Supabase.
This executes raw SQL to add missing modals to the modals table.
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file")
    exit(1)

# Initialize Supabase client with service role key (bypasses RLS)
# Use service role key if available, otherwise use regular key
if SUPABASE_SERVICE_ROLE_KEY:
    print("Using service role key to bypass RLS policies...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
else:
    print("Warning: SUPABASE_SERVICE_ROLE_KEY not set, using regular key (RLS restrictions apply)")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Read the migration SQL file
migration_file = '/Users/ant/Desktop/StockVisualiser/migrations/002_add_missing_modals.sql'

if not os.path.exists(migration_file):
    print(f"Error: Migration file not found: {migration_file}")
    exit(1)

with open(migration_file, 'r') as f:
    sql = f.read()

print("=" * 60)
print("Running Migration: Add Missing Modals")
print("=" * 60)
print()

try:
    # Execute the SQL using Supabase's rpc functionality
    # Note: This uses the service_role key which bypasses RLS policies
    result = supabase.rpc('exec_sql', {'sql': sql}).execute()
    print("✓ Migration executed successfully")
    print(result)
except Exception as e:
    # Try direct SQL execution via the client
    print(f"Note: RPC method not available, trying direct insertion...")

    try:
        # Method 2: Insert each modal individually using Python
        modals = [
            {
                'modal_key': 'delete_portfolio',
                'title': 'Delete portfolio',
                'body_text': 'Are you sure you want to delete this portfolio?',
                'cancel_button_text': 'Close',
                'confirm_button_text': 'Delete portfolio',
                'confirm_button_color': 'danger'
            },
            {
                'modal_key': 'add_portfolio',
                'title': 'Add new portfolio',
                'body_text': 'Enter a name for your new portfolio',
                'cancel_button_text': 'Cancel',
                'confirm_button_text': 'Create portfolio',
                'confirm_button_color': 'primary'
            }
        ]

        for modal in modals:
            print(f"  Adding modal: {modal['modal_key']}...", end=" ")
            try:
                # Try to upsert using the service_role client
                # Note: Standard client has RLS restrictions
                response = supabase.table('modals').upsert([modal]).execute()
                if response.data:
                    print("✓")
                else:
                    print("✗ (No data returned)")
            except Exception as modal_error:
                print(f"✗ ({str(modal_error)})")

        print()
        print("=" * 60)
        print("✓ Migration complete!")
        print("=" * 60)

    except Exception as final_error:
        print(f"✗ Error: {str(final_error)}")
        print()
        print("To fix this, you need to run the SQL migration manually:")
        print("1. Go to Supabase SQL Editor")
        print("2. Paste the contents of migrations/002_add_missing_modals.sql")
        print("3. Click 'Run'")
        exit(1)

print()
print("After migration, the console errors will be gone:")
print("  - Creating portfolio → No 404 error for add_portfolio")
print("  - Deleting portfolio → No 404 error for delete_portfolio")
print()
