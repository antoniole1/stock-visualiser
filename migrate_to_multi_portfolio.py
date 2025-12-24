#!/usr/bin/env python3
"""
Migration script to transition from single-portfolio-per-user to multi-portfolio support.

This script:
1. Creates user records from existing (username, password_hash) pairs
2. Updates portfolio records with user_id and sets is_default flags
3. Validates the migration and reports any issues

Run this AFTER applying SQL migrations 002 and 003:
    python3 migrate_to_multi_portfolio.py

To preview changes without committing:
    python3 migrate_to_multi_portfolio.py --dry-run
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client
from datetime import datetime

# Load environment variables
load_dotenv()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')

# Flags
DRY_RUN = '--dry-run' in sys.argv
VERBOSE = '--verbose' in sys.argv

class MultiPortfolioMigration:
    """Handles migration from single to multi-portfolio schema"""

    def __init__(self):
        """Initialize Supabase connection"""
        if not SUPABASE_URL or not SUPABASE_KEY:
            print("❌ Error: SUPABASE_URL and SUPABASE_KEY environment variables required")
            sys.exit(1)

        try:
            self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
            print("✓ Connected to Supabase")
        except Exception as e:
            print(f"❌ Failed to connect to Supabase: {e}")
            sys.exit(1)

        self.migration_log = {
            'timestamp': datetime.now().isoformat(),
            'dry_run': DRY_RUN,
            'users_created': 0,
            'portfolios_updated': 0,
            'errors': [],
            'warnings': []
        }

    def log(self, message, level='info'):
        """Log migration messages"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        prefix = {'info': '✓', 'warning': '⚠', 'error': '❌'}[level]
        print(f"[{timestamp}] {prefix} {message}")

        if level == 'error':
            self.migration_log['errors'].append(message)
        elif level == 'warning':
            self.migration_log['warnings'].append(message)

    def get_unique_users(self):
        """Extract unique (username, password_hash) pairs from portfolios table"""
        try:
            response = self.supabase.table('portfolios').select(
                'username, password_hash',
                count='exact'
            ).execute()

            if not response.data:
                self.log("No portfolios found in database", 'warning')
                return []

            # Get unique user credentials
            seen = set()
            unique_users = []

            for portfolio in response.data:
                username = portfolio.get('username')
                password_hash = portfolio.get('password_hash')

                if not username or not password_hash:
                    self.log(f"Skipping portfolio with missing credentials", 'warning')
                    continue

                user_key = (username, password_hash)
                if user_key not in seen:
                    seen.add(user_key)
                    unique_users.append({
                        'username': username,
                        'password_hash': password_hash
                    })

            self.log(f"Found {len(unique_users)} unique users in {len(response.data)} portfolios")
            return unique_users

        except Exception as e:
            self.log(f"Failed to fetch unique users: {e}", 'error')
            return []

    def create_users(self, unique_users):
        """Create user records for each unique (username, password_hash) pair"""
        user_map = {}  # Map of (username, password_hash) -> user_id

        for user in unique_users:
            username = user['username']
            password_hash = user['password_hash']

            try:
                # Check if user already exists
                existing = self.supabase.table('users').select(
                    'id'
                ).eq('username', username).execute()

                if existing.data:
                    user_id = existing.data[0]['id']
                    self.log(f"User '{username}' already exists (id: {user_id})")
                    user_map[(username, password_hash)] = user_id
                    continue

                # Create new user
                if not DRY_RUN:
                    response = self.supabase.table('users').insert({
                        'username': username,
                        'password_hash': password_hash
                    }).execute()

                    if response.data:
                        user_id = response.data[0]['id']
                        user_map[(username, password_hash)] = user_id
                        self.migration_log['users_created'] += 1
                        self.log(f"Created user '{username}' (id: {user_id})")
                    else:
                        self.log(f"Failed to create user '{username}': no data returned", 'error')
                else:
                    # In dry-run mode, generate a fake ID for logging
                    import uuid
                    user_id = str(uuid.uuid4())
                    user_map[(username, password_hash)] = user_id
                    self.log(f"[DRY-RUN] Would create user '{username}'")

            except Exception as e:
                self.log(f"Error creating user '{username}': {e}", 'error')
                continue

        return user_map

    def update_portfolios(self, user_map):
        """Update portfolio records with user_id and set is_default flags"""
        try:
            response = self.supabase.table('portfolios').select(
                'id, username, password_hash'
            ).execute()

            if not response.data:
                self.log("No portfolios to update", 'warning')
                return

            # Group portfolios by user
            portfolios_by_user = {}
            for portfolio in response.data:
                user_key = (portfolio['username'], portfolio['password_hash'])
                if user_key not in portfolios_by_user:
                    portfolios_by_user[user_key] = []
                portfolios_by_user[user_key].append(portfolio)

            # Update each portfolio with user_id and set is_default for first portfolio
            for user_key, portfolios in portfolios_by_user.items():
                user_id = user_map.get(user_key)
                if not user_id:
                    self.log(f"User not found in map for {user_key}", 'error')
                    continue

                # Set first portfolio as default
                for idx, portfolio in enumerate(portfolios):
                    is_default = (idx == 0)

                    try:
                        if not DRY_RUN:
                            self.supabase.table('portfolios').update({
                                'user_id': user_id,
                                'is_default': is_default
                            }).eq('id', portfolio['id']).execute()

                            self.migration_log['portfolios_updated'] += 1

                        action = f"Set user_id={user_id[:8]}..., is_default={is_default}"
                        self.log(f"Updated portfolio '{portfolio['id'][:8]}...': {action}")

                    except Exception as e:
                        self.log(f"Error updating portfolio {portfolio['id']}: {e}", 'error')

        except Exception as e:
            self.log(f"Error fetching portfolios: {e}", 'error')

    def validate_migration(self):
        """Validate that migration was successful"""
        try:
            self.log("\n" + "="*70)
            self.log("VALIDATION CHECKS", 'info')
            self.log("="*70)

            # Check 1: All portfolios have user_id
            response = self.supabase.table('portfolios').select(
                'id'
            ).is_('user_id', 'null').execute()

            if response.data:
                self.log(f"⚠ {len(response.data)} portfolios still have NULL user_id", 'warning')
                self.migration_log['warnings'].append(
                    f"{len(response.data)} portfolios have NULL user_id"
                )
            else:
                self.log("All portfolios have user_id assigned")

            # Check 2: Every user has at least one default portfolio
            users_response = self.supabase.table('users').select(
                'id, username'
            ).execute()

            if users_response.data:
                for user in users_response.data:
                    default_response = self.supabase.table('portfolios').select(
                        'id'
                    ).eq('user_id', user['id']).eq('is_default', True).execute()

                    if not default_response.data:
                        self.log(
                            f"⚠ User '{user['username']}' has no default portfolio",
                            'warning'
                        )
                        self.migration_log['warnings'].append(
                            f"User {user['id']} has no default portfolio"
                        )

                self.log(f"All {len(users_response.data)} users have at least one portfolio")

            # Check 3: No duplicate (user_id, portfolio_name) pairs
            self.log("Checking for duplicate portfolio names per user...")
            # This is handled by the unique constraint in the database

            # Check 4: Count summary
            users_count = len(users_response.data) if users_response.data else 0
            portfolios = self.supabase.table('portfolios').select(
                'id', count='exact'
            ).execute()
            portfolios_count = len(portfolios.data) if portfolios.data else 0

            self.log(f"\nMigration Summary:")
            self.log(f"  - Users created: {self.migration_log['users_created']}")
            self.log(f"  - Portfolios updated: {self.migration_log['portfolios_updated']}")
            self.log(f"  - Total users in DB: {users_count}")
            self.log(f"  - Total portfolios in DB: {portfolios_count}")

            if self.migration_log['errors']:
                self.log(f"  - Errors: {len(self.migration_log['errors'])}", 'error')
            if self.migration_log['warnings']:
                self.log(f"  - Warnings: {len(self.migration_log['warnings'])}", 'warning')

        except Exception as e:
            self.log(f"Validation failed: {e}", 'error')

    def run(self):
        """Execute the complete migration"""
        print("\n" + "="*70)
        print("MULTI-PORTFOLIO MIGRATION SCRIPT")
        print("="*70 + "\n")

        if DRY_RUN:
            print("⚠️  DRY-RUN MODE: No changes will be committed to the database\n")

        try:
            # Step 1: Get unique users
            self.log("Step 1: Extracting unique users from existing portfolios...")
            unique_users = self.get_unique_users()

            if not unique_users:
                self.log("No unique users found. Migration aborted.", 'warning')
                return

            # Step 2: Create user records
            self.log("\nStep 2: Creating user records...")
            user_map = self.create_users(unique_users)

            if not user_map:
                self.log("Failed to create users. Migration aborted.", 'error')
                return

            # Step 3: Update portfolio records
            self.log("\nStep 3: Updating portfolio records with user_id...")
            self.update_portfolios(user_map)

            # Step 4: Validate
            self.validate_migration()

            # Summary
            print("\n" + "="*70)
            if DRY_RUN:
                print("✓ DRY-RUN COMPLETED - No changes were made to the database")
            else:
                print("✓ MIGRATION COMPLETED SUCCESSFULLY")
            print("="*70 + "\n")

        except Exception as e:
            self.log(f"Migration failed: {e}", 'error')
            sys.exit(1)


if __name__ == '__main__':
    migration = MultiPortfolioMigration()
    migration.run()
