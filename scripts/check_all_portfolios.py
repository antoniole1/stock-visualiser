#!/usr/bin/env python3
"""
Check all portfolios to see which ones have created_at
"""
from supabase import create_client, Client
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL or SUPABASE_KEY not set in .env file")
    exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("🔍 Checking ALL portfolios in the database...\n")

try:
    # Get all portfolios
    response = supabase.table('portfolios').select(
        'id, portfolio_name, user_id, created_at, is_default'
    ).execute()

    print(f"Total portfolios: {len(response.data)}\n")

    # Group by user
    users = {}
    for p in response.data:
        user_id = p['user_id']
        if user_id not in users:
            users[user_id] = []
        users[user_id].append(p)

    for user_id, portfolios in users.items():
        print(f"User {user_id}:")
        for p in portfolios:
            print(f"  - {p['portfolio_name']:20} | created_at: {p.get('created_at')}")
        print()

except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("✨ Done!")
