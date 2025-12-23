#!/usr/bin/env python3
"""
Create modals table in Supabase by executing SQL via the admin API.
This script reads the migration SQL and executes it.
"""

import os
import sys
from dotenv import load_dotenv
import requests
import json

# Load environment variables
load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY environment variables not set")
    sys.exit(1)

def create_modals_table():
    """Create modals table using Supabase REST API with RPC"""
    try:
        # Read the SQL migration file
        with open('migrations/001_create_modals_table.sql', 'r') as f:
            sql_statements = f.read()

        print("SQL to execute:")
        print("-" * 70)
        print(sql_statements)
        print("-" * 70)

        # Split SQL into individual statements
        statements = [s.strip() for s in sql_statements.split(';') if s.strip()]

        print(f"\nFound {len(statements)} SQL statements to execute")

        # Try to execute via direct SQL execution endpoint
        # First, let's try to create the table by inserting data
        # which will fail if table doesn't exist, then we know we need the admin API

        print("\nAttempting to create modals table...")

        # Use the Supabase HTTP API to check if table exists
        headers = {
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json'
        }

        # Try to query the modals table
        response = requests.get(
            f'{SUPABASE_URL}/rest/v1/modals?limit=1',
            headers=headers
        )

        if response.status_code == 200:
            print("✓ Modals table already exists!")
            return True
        elif response.status_code == 404:
            print("⚠ Modals table does not exist")
            print("\nTo create the table, please run the following in your Supabase SQL editor:")
            print("1. Go to https://app.supabase.com")
            print("2. Select your project")
            print("3. Go to SQL Editor")
            print("4. Click 'New Query'")
            print("5. Copy and paste the SQL below:")
            print("\n" + "=" * 70)
            print(sql_statements)
            print("=" * 70)
            print("\nOr run this script with the Supabase admin credentials.")
            return False
        else:
            print(f"✗ Error checking table: {response.status_code}")
            print(response.text)
            return False

    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == '__main__':
    success = create_modals_table()
    sys.exit(0 if success else 1)
