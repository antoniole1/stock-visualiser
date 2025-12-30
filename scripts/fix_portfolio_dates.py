#!/usr/bin/env python3
"""
Fix portfolio created_at dates by using updated_at as fallback
This script updates all portfolios that have NULL created_at to use their updated_at value
"""

import os
import sys
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

# Load environment variables
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY environment variables are required")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    # Get all portfolios with NULL created_at
    print("Fetching portfolios with NULL created_at...")
    response = supabase.table('portfolios').select('*').is_('created_at', 'null').execute()

    if not response.data:
        print("✓ No portfolios with NULL created_at found")
        sys.exit(0)

    print(f"Found {len(response.data)} portfolios with NULL created_at")

    # Update each one to use updated_at or current time
    updated_count = 0
    for portfolio in response.data:
        portfolio_id = portfolio['id']
        portfolio_name = portfolio.get('portfolio_name', 'Unknown')
        updated_at = portfolio.get('updated_at')

        # Use updated_at if available, otherwise use current time
        created_at = updated_at or datetime.now().isoformat()

        print(f"  Updating '{portfolio_name}' (ID: {portfolio_id}) with created_at={created_at}")

        update_response = supabase.table('portfolios').update({
            'created_at': created_at
        }).eq('id', portfolio_id).execute()

        if update_response.data:
            updated_count += 1
            print(f"    ✓ Updated successfully")
        else:
            print(f"    ✗ Failed to update")

    print(f"\n✓ Successfully updated {updated_count} portfolios")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
