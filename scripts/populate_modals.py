#!/usr/bin/env python3
"""
Script to populate the modals table in Supabase with modal configurations.
This eliminates the need for fallback configs and 404 errors.
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file")
    exit(1)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Modal configurations to populate
# Only include columns that exist in the modals table schema
modals_to_add = [
    {
        'modal_key': 'delete_position',
        'title': 'Delete position',
        'body_text': 'Are you sure you want to delete {ticker} ({shares} shares)?',
        'warning_text': 'Once deleted, the data will disappear from the backend and it will not be possible to retrieve it again.',
        'cancel_button_text': 'Cancel',
        'confirm_button_text': 'Delete position',
        'confirm_button_color': 'danger'
    },
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

def main():
    print("=" * 60)
    print("Populating modals table in Supabase")
    print("=" * 60)
    print()

    for modal in modals_to_add:
        modal_key = modal['modal_key']
        print(f"Adding modal: {modal_key}...", end=" ")

        try:
            # First check if modal already exists
            existing = supabase.table('modals').select('*').eq('modal_key', modal_key).execute()

            if existing.data and len(existing.data) > 0:
                print("✓ Already exists (skipping)")
                continue

            # Insert the modal
            response = supabase.table('modals').insert(modal).execute()

            if response.data:
                print("✓ Added successfully")
            else:
                print("✗ Failed to add")

        except Exception as e:
            print(f"✗ Error: {str(e)}")

    print()
    print("=" * 60)
    print("✓ Modals table population complete!")
    print("=" * 60)
    print()
    print("Now when you:")
    print("  - Click 'Create new portfolio' → No 404 error for add_portfolio")
    print("  - Click delete icon on portfolio → No 404 error for delete_portfolio")
    print("  - Delete a position → No 404 error for delete_position")
    print()

if __name__ == '__main__':
    main()
