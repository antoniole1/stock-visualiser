#!/usr/bin/env python3
"""
Debug script to check what the API returns for portfolio list
"""
from supabase import create_client, Client
import os
from dotenv import load_dotenv
import json

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL or SUPABASE_KEY not set in .env file")
    exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("🔍 Checking what get_user_portfolios would return...\n")

try:
    # Get the first user to test with
    users_response = supabase.table('users').select('id').limit(1).execute()

    if not users_response.data:
        print("❌ No users found in database")
        exit(1)

    user_id = users_response.data[0]['id']
    print(f"Testing with user_id: {user_id}\n")

    # Get portfolios for this user (same as the backend function)
    response = supabase.table('portfolios').select(
        'id, portfolio_name, positions, is_default, created_at, updated_at'
    ).eq('user_id', user_id).execute()

    print(f"Found {len(response.data)} portfolios:\n")

    for p in response.data:
        print(f"Portfolio: {p['portfolio_name']}")
        print(f"  id: {p['id']}")
        print(f"  created_at: {p.get('created_at')}")
        print(f"  created_at type: {type(p.get('created_at'))}")
        print(f"  is_default: {p.get('is_default')}")
        print()

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("✨ Done!")
