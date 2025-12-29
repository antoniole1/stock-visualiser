#!/usr/bin/env python3
"""
Test what get_user_portfolios returns for the specific user with multiple portfolios
"""
from supabase import create_client, Client
import os
from dotenv import load_dotenv
import sys

# Add app.py to path to import functions
sys.path.insert(0, '/Users/ant/Desktop/StockVisualiser')

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: SUPABASE_URL or SUPABASE_KEY not set in .env file")
    exit(1)

# Import the function from app
from app import get_user_portfolios

# Test user ID from the database check
user_id = "ffff0940-03d5-4ecf-9c1f-57e0bc176a22"

print(f"Testing get_user_portfolios for user: {user_id}\n")

portfolios = get_user_portfolios(user_id)

print(f"Found {len(portfolios)} portfolios:\n")

for p in portfolios:
    print(f"Portfolio: {p['name']}")
    print(f"  id: {p['id']}")
    print(f"  created_at: {p.get('created_at')}")
    print(f"  positions_count: {p.get('positions_count')}")
    print()

print("✨ Done!")
