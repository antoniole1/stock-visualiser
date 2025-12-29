#!/usr/bin/env python3
"""
Script to verify and populate created_at values for portfolios in Supabase
"""
from supabase import create_client, Client
from datetime import datetime
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

print("🔍 Checking portfolios with NULL created_at values...")

try:
    # Get all portfolios with NULL created_at
    response = supabase.table('portfolios').select(
        'id, portfolio_name, created_at'
    ).is_('created_at', 'null').execute()

    null_portfolios = response.data if response.data else []

    print(f"Found {len(null_portfolios)} portfolios with NULL created_at:")
    for p in null_portfolios:
        print(f"  - {p['id']}: {p['portfolio_name']}")

    if len(null_portfolios) > 0:
        print(f"\n📝 Updating {len(null_portfolios)} portfolios with created_at = now()...")

        # Update all portfolios with NULL created_at
        update_response = supabase.table('portfolios').update(
            {'created_at': datetime.now().isoformat()}
        ).is_('created_at', 'null').execute()

        print(f"✅ Updated {len(update_response.data)} portfolios")

        for p in update_response.data:
            print(f"  - {p['id']}: {p['portfolio_name']} -> {p['created_at']}")
    else:
        print("✅ All portfolios already have created_at values!")

        # Show all portfolios
        all_response = supabase.table('portfolios').select(
            'id, portfolio_name, created_at'
        ).execute()

        print(f"\n📊 All portfolios ({len(all_response.data)} total):")
        for p in all_response.data:
            print(f"  - {p['id']}: {p['portfolio_name']} (created: {p['created_at']})")

except Exception as e:
    print(f"❌ Error: {e}")
    exit(1)

print("\n✨ Done!")
