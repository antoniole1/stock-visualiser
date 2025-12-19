#!/usr/bin/env python3
"""
Setup script to create the modals table in Supabase.
Run this script to initialize the modals table with seed data.
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY environment variables not set")
    sys.exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def setup_modals_table():
    """Create modals table and insert seed data"""
    try:
        # Read migration SQL
        with open('migrations/001_create_modals_table.sql', 'r') as f:
            sql = f.read()

        # Execute migration using the admin API
        # Note: This requires a direct SQL execution which might not be available via the standard client
        # Instead, we'll use the upsert method to ensure the data exists

        print("Setting up modals table...")

        # First, check if the table exists by trying to query it
        try:
            response = supabase.table('modals').select('count(*)', count='exact').execute()
            print("✓ Modals table already exists")
        except Exception as e:
            print(f"⚠ Modals table doesn't exist yet. Please create it manually in Supabase SQL editor using migrations/001_create_modals_table.sql")
            print(f"Error: {e}")
            return False

        # Insert or update seed data
        modal_data = {
            'modal_key': 'delete_position',
            'title': 'Delete position',
            'body_text': 'Are you sure you want to delete {ticker} ({shares} shares)?',
            'warning_text': 'Once deleted, the data will disappear from the backend and it will not be possible to retrieve it again.',
            'cancel_button_text': 'Cancel',
            'confirm_button_text': 'Delete position',
            'confirm_button_color': 'danger'
        }

        response = supabase.table('modals').upsert([modal_data]).execute()
        print("✓ Seed data inserted successfully")
        print(f"✓ Modal configuration: {response.data}")

        return True

    except Exception as e:
        print(f"✗ Error setting up modals table: {e}")
        return False

if __name__ == '__main__':
    success = setup_modals_table()
    sys.exit(0 if success else 1)
