#!/usr/bin/env python3
"""Verify the data was created correctly in Supabase"""

from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY not set")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Check if the user was created
username = "testuser1766572850"
user_response = supabase.table('users').select('*').eq('username', username).execute()

if user_response.data:
    user = user_response.data[0]
    user_id = user['id']
    print(f"✓ User found in users table:")
    print(f"  ID: {user_id}")
    print(f"  Username: {user['username']}")
    print(f"  Has password_hash: {'password_hash' in user and user['password_hash'] is not None}")

    # Check if portfolio was created with the user_id
    portfolio_response = supabase.table('portfolios').select('*').eq('user_id', user_id).execute()

    if portfolio_response.data:
        portfolio = portfolio_response.data[0]
        print(f"\n✓ Portfolio found linked to user:")
        print(f"  Portfolio ID: {portfolio['id']}")
        print(f"  Portfolio Name: {portfolio['portfolio_name']}")
        print(f"  User ID: {portfolio['user_id']}")
        print(f"  Is Default: {portfolio['is_default']}")
        print(f"  Positions Count: {len(portfolio.get('positions', []))}")
    else:
        print(f"\n✗ No portfolio found for user {user_id}")
else:
    print(f"✗ User '{username}' not found in users table")
