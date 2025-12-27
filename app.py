from flask import Flask, jsonify, request, send_from_directory, make_response
from flask_cors import CORS
import requests
from datetime import datetime, timedelta
import os
import time
import json
import hashlib
import secrets
import re
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, supports_credentials=True)  # Enable credentials for cookies

# Session configuration
app.config['SESSION_COOKIE_SECURE'] = True  # Only send cookie over HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevent JavaScript access
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection

# In-memory session storage (in production, use Redis or database)
_active_sessions = {}

# Session cleanup configuration
CLEANUP_INTERVAL_SECONDS = 3600  # Clean up expired sessions every hour
_last_cleanup_time = 0

def cleanup_expired_sessions():
    """Remove expired sessions from memory"""
    global _last_cleanup_time
    now = datetime.now()
    current_time = time.time()

    # Only run cleanup every CLEANUP_INTERVAL_SECONDS
    if current_time - _last_cleanup_time < CLEANUP_INTERVAL_SECONDS:
        return

    _last_cleanup_time = current_time
    expired_tokens = [
        token for token, session in _active_sessions.items()
        if now > session['expires_at']
    ]

    for token in expired_tokens:
        del _active_sessions[token]

    if expired_tokens:
        print(f"🧹 Cleaned up {len(expired_tokens)} expired sessions. Active sessions: {len(_active_sessions)}")

print("\n" + "="*70)
print("FLASK APP INITIALIZED - Portfolio storage with Supabase")
print("="*70 + "\n")

# Get API keys from environment variables
FINNHUB_API_KEY = os.environ.get('FINNHUB_API_KEY', 'd4gdnt9r01qm5b354vmgd4gdnt9r01qm5b354vn0')
ALPHAVANTAGE_API_KEY = os.environ.get('ALPHAVANTAGE_API_KEY', '')
MARKETAUX_API_KEY = os.environ.get('MARKETAUX_API_KEY', '')

# Supabase configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY', '')

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("✓ Supabase database connected")
    except Exception as e:
        print(f"⚠ Supabase connection failed: {e}")
else:
    print("⚠ Supabase credentials not configured - historical price caching will be disabled")

if not FINNHUB_API_KEY:
    print("\n" + "="*70)
    print("WARNING: FINNHUB_API_KEY environment variable not set!")
    print("Please get a free API key from: https://finnhub.io/")
    print("Then set it with: export FINNHUB_API_KEY='your_api_key_here'")
    print("="*70 + "\n")

if ALPHAVANTAGE_API_KEY:
    print(f"✓ AlphaVantage API key configured: {ALPHAVANTAGE_API_KEY[:8]}...")
else:
    print("⚠ AlphaVantage API key not configured - historical data will not be available")

FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'
ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query'

# Portfolio storage directory
PORTFOLIO_DIR = Path('portfolios')
PORTFOLIO_DIR.mkdir(exist_ok=True)

# Cache storage directory
CACHE_DIR = Path('cache')
CACHE_DIR.mkdir(exist_ok=True)

# Cache subdirectories
COMPANY_CACHE_DIR = CACHE_DIR / 'companies'
COMPANY_CACHE_DIR.mkdir(exist_ok=True)

PRICE_CACHE_DIR = CACHE_DIR / 'prices'
PRICE_CACHE_DIR.mkdir(exist_ok=True)

HISTORY_CACHE_DIR = CACHE_DIR / 'history'
HISTORY_CACHE_DIR.mkdir(exist_ok=True)

# Cache durations
COMPANY_CACHE_DAYS = 7  # Company names rarely change
PRICE_CACHE_MINUTES = 5  # Current prices updated frequently
HISTORY_CACHE_HOURS = 24  # Historical data updated daily

# Helper functions for portfolio management
def validate_strong_password(password):
    """
    Validate that password meets strong password requirements.
    Returns: (is_valid, error_message)
    """
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"

    has_uppercase = any(c.isupper() for c in password)
    has_lowercase = any(c.islower() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_special = any(c in '!@#$%^&*()_+-=[]{};\':"|,.<>?/' for c in password)

    if not has_uppercase:
        return False, "Password must contain at least one uppercase letter"
    if not has_lowercase:
        return False, "Password must contain at least one lowercase letter"
    if not has_digit:
        return False, "Password must contain at least one digit"
    if not has_special:
        return False, "Password must contain at least one special character (!@#$%^&*)"

    return True, None

def hash_password(password):
    """Hash a password"""
    return hashlib.sha256(password.encode()).hexdigest()

def get_portfolio_path(username, password):
    """Get the file path for a portfolio based on username and password hash"""
    password_hash = hash_password(password)
    # Use username + password hash to create unique filename
    return PORTFOLIO_DIR / f"{username}_{password_hash}.json"

# Session management functions - PHASE 2: Updated for multi-portfolio support
def create_session_token(user_id, username, active_portfolio_id=None):
    """Create a secure session token for authenticated user

    Args:
        user_id: UUID of the user
        username: Username for display
        active_portfolio_id: UUID of the active portfolio (optional)
    """
    token = secrets.token_urlsafe(32)
    _active_sessions[token] = {
        'user_id': user_id,
        'username': username,
        'active_portfolio_id': active_portfolio_id,
        'created_at': datetime.now(),
        'expires_at': datetime.now() + timedelta(days=7)  # Token expires in 7 days
    }
    return token

def validate_session_token(token):
    """Validate a session token and return session data if valid

    Returns:
        dict with user_id, username, active_portfolio_id or None if invalid
    """
    if token not in _active_sessions:
        return None

    session = _active_sessions[token]

    # Check if token has expired
    if datetime.now() > session['expires_at']:
        del _active_sessions[token]
        return None

    return session

def get_session_user_id(token):
    """Get user_id from session token"""
    session = validate_session_token(token)
    return session['user_id'] if session else None

def get_session_active_portfolio_id(token):
    """Get active_portfolio_id from session token"""
    session = validate_session_token(token)
    return session['active_portfolio_id'] if session else None

def revoke_session_token(token):
    """Revoke a session token (logout)"""
    if token in _active_sessions:
        del _active_sessions[token]

# PHASE 2: New helper functions for multi-portfolio support

def authenticate_user(username, password):
    """Authenticate user against the users table

    Returns:
        dict with user_id, username if successful, None otherwise
    """
    if not supabase:
        return None

    try:
        password_hash = hash_password(password)
        response = supabase.table('users').select('id').eq('username', username).eq('password_hash', password_hash).execute()

        if response.data and len(response.data) > 0:
            return {
                'user_id': response.data[0]['id'],
                'username': username
            }
    except Exception as e:
        print(f"Error authenticating user: {e}")

    return None

def calculate_portfolio_return(positions):
    """Calculate portfolio return percentage

    Args:
        positions: List of position dicts with shares and purchase_price

    Returns:
        float: Return percentage (can be negative)
    """
    if not positions or len(positions) == 0:
        return 0.0

    try:
        total_invested = 0
        total_current_value = 0

        for pos in positions:
            shares = float(pos.get('shares', 0))
            purchase_price = float(pos.get('purchase_price', 0))
            current_price = float(pos.get('current_price', purchase_price))

            # Calculate invested amount for this position
            invested = shares * purchase_price
            current_value = shares * current_price

            total_invested += invested
            total_current_value += current_value

        # Calculate return percentage
        if total_invested <= 0:
            return 0.0

        return_pct = ((total_current_value - total_invested) / total_invested) * 100
        return round(return_pct, 2)

    except Exception as e:
        print(f"Error calculating portfolio return: {e}")
        return 0.0

def get_user_portfolios(user_id):
    """Get all portfolios for a user with return percentages

    Returns:
        list of portfolio objects, empty list if none
    """
    if not supabase:
        return []

    try:
        # Try to select with cached_return_percentage, fallback if column doesn't exist
        try:
            response = supabase.table('portfolios').select(
                'id, portfolio_name, positions, is_default, created_at, updated_at, cached_return_percentage'
            ).eq('user_id', user_id).execute()
        except:
            # Fallback: column might not exist yet, select without it
            response = supabase.table('portfolios').select(
                'id, portfolio_name, positions, is_default, created_at, updated_at'
            ).eq('user_id', user_id).execute()

        if response.data:
            portfolios = []
            for p in response.data:
                positions = p.get('positions', [])

                # Use cached return percentage if available (set when dashboard was last loaded)
                # Otherwise, calculate based on stored data (which will be 0 if positions don't have current_price)
                cached_return = p.get('cached_return_percentage')
                if cached_return is not None:
                    return_pct = cached_return
                else:
                    # Fallback: calculate from stored positions (limited accuracy without live prices)
                    return_pct = calculate_portfolio_return(positions)

                portfolios.append({
                    'id': p['id'],
                    'name': p['portfolio_name'],
                    'positions_count': len(positions),
                    'is_default': p.get('is_default', False),
                    'created_at': p.get('created_at'),
                    'updated_at': p.get('updated_at'),
                    'return_percentage': return_pct  # PHASE 4: Added for portfolio switcher
                })
            return portfolios
        return []
    except Exception as e:
        print(f"Error getting user portfolios: {e}", flush=True)
        return []

def get_default_portfolio(user_id):
    """Get the default portfolio for a user

    Returns:
        portfolio dict or None
    """
    if not supabase:
        return None

    try:
        response = supabase.table('portfolios').select(
            'id, portfolio_name, positions, is_default, created_at, updated_at'
        ).eq('user_id', user_id).eq('is_default', True).execute()

        if response.data and len(response.data) > 0:
            p = response.data[0]
            return {
                'id': p['id'],
                'name': p['portfolio_name'],
                'positions': p.get('positions', []),
                'is_default': True,
                'created_at': p.get('created_at'),
                'updated_at': p.get('updated_at')
            }
    except Exception as e:
        print(f"Error getting default portfolio: {e}")

    return None

def get_portfolio_by_id(user_id, portfolio_id):
    """Get a specific portfolio by ID, ensuring user owns it

    Returns:
        portfolio dict or None
    """
    if not supabase:
        return None

    try:
        response = supabase.table('portfolios').select('*').eq('id', portfolio_id).eq('user_id', user_id).execute()

        if response.data and len(response.data) > 0:
            p = response.data[0]
            return {
                'id': p['id'],
                'name': p['portfolio_name'],
                'positions': p.get('positions', []),
                'is_default': p.get('is_default', False),
                'created_at': p.get('created_at'),
                'updated_at': p.get('updated_at')
            }
    except Exception as e:
        print(f"Error getting portfolio by ID: {e}")

    return None

def create_portfolio_for_user(user_id, portfolio_name):
    """Create a new portfolio for a user

    Returns:
        portfolio dict or None
    """
    if not supabase:
        return None

    try:
        # Check portfolio limit (max 5 portfolios)
        existing = supabase.table('portfolios').select('id').eq('user_id', user_id).execute()
        portfolio_count = len(existing.data) if existing.data else 0

        if portfolio_count >= 5:
            print(f"Portfolio limit (5) reached for user {user_id}")
            return None

        # Get username and password_hash from users table for backward compatibility
        print(f"[DEBUG] Fetching user details for user_id: {user_id}", flush=True)
        user_response = supabase.table('users').select('username, password_hash').eq('id', user_id).execute()
        username = None
        password_hash = None
        if user_response.data and len(user_response.data) > 0:
            username = user_response.data[0].get('username')
            password_hash = user_response.data[0].get('password_hash')
        print(f"[DEBUG] User details - username: {username}, password_hash: {bool(password_hash)}", flush=True)

        # Create portfolio
        data = {
            'user_id': user_id,
            'portfolio_name': portfolio_name,
            'positions': [],
            'is_default': (portfolio_count == 0),  # First portfolio is default
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }

        # Include username and password_hash for backward compatibility with old schema
        if username:
            data['username'] = username
            print(f"[DEBUG] Added username to portfolio data: {username}", flush=True)
        if password_hash:
            data['password_hash'] = password_hash
            print(f"[DEBUG] Added password_hash to portfolio data", flush=True)

        if not username or not password_hash:
            print(f"[DEBUG] WARNING: Missing user data - username: {bool(username)}, password_hash: {bool(password_hash)}", flush=True)

        print(f"[DEBUG] Inserting portfolio data: {data}", flush=True)
        response = supabase.table('portfolios').insert(data).execute()
        print(f"[DEBUG] Insert response: {response.data}", flush=True)

        if response.data and len(response.data) > 0:
            p = response.data[0]
            return {
                'id': p['id'],
                'name': p['portfolio_name'],
                'positions': p.get('positions', []),
                'is_default': p.get('is_default', False),
                'created_at': p.get('created_at')
            }
    except Exception as e:
        print(f"Error creating portfolio: {e}")

    return None

def update_portfolio_name(user_id, portfolio_id, new_name):
    """Update portfolio name

    Returns:
        True if successful, False otherwise
    """
    if not supabase:
        return False

    try:
        # Verify user owns this portfolio
        portfolio = get_portfolio_by_id(user_id, portfolio_id)
        if not portfolio:
            return False

        supabase.table('portfolios').update({
            'portfolio_name': new_name,
            'updated_at': datetime.now().isoformat()
        }).eq('id', portfolio_id).eq('user_id', user_id).execute()

        return True
    except Exception as e:
        print(f"Error updating portfolio name: {e}")
        return False

def delete_portfolio(user_id, portfolio_id):
    """Delete a portfolio

    Returns:
        True if successful, False otherwise
    """
    if not supabase:
        return False

    try:
        # Verify user owns this portfolio
        portfolio = get_portfolio_by_id(user_id, portfolio_id)
        if not portfolio:
            return False

        # Prevent deletion of only portfolio
        existing = supabase.table('portfolios').select('id', count='exact').eq('user_id', user_id).execute()
        if existing.count <= 1:
            print(f"Cannot delete user's only portfolio")
            return False

        # Delete portfolio
        supabase.table('portfolios').delete().eq('id', portfolio_id).eq('user_id', user_id).execute()

        # If deleted portfolio was default, set another as default
        if portfolio['is_default']:
            first = supabase.table('portfolios').select('id').eq('user_id', user_id).limit(1).execute()
            if first.data:
                supabase.table('portfolios').update({'is_default': True}).eq('id', first.data[0]['id']).execute()

        return True
    except Exception as e:
        print(f"Error deleting portfolio: {e}")
        return False

def set_active_portfolio(user_id, portfolio_id):
    """Set a portfolio as active/default

    Returns:
        True if successful, False otherwise
    """
    if not supabase:
        return False

    try:
        # Verify user owns this portfolio
        portfolio = get_portfolio_by_id(user_id, portfolio_id)
        if not portfolio:
            return False

        # Clear previous default
        supabase.table('portfolios').update({'is_default': False}).eq('user_id', user_id).execute()

        # Set new default
        supabase.table('portfolios').update({'is_default': True}).eq('id', portfolio_id).eq('user_id', user_id).execute()

        return True
    except Exception as e:
        print(f"Error setting active portfolio: {e}")
        return False

def load_portfolio(username, password):
    """Load a portfolio by username and password from Supabase database"""
    if not supabase:
        # Fallback to file-based storage if Supabase not available
        return load_portfolio_from_file(username, password)

    try:
        password_hash = hash_password(password)
        response = supabase.table('portfolios').select('*').eq('username', username).eq('password_hash', password_hash).execute()

        if response.data and len(response.data) > 0:
            portfolio_data = response.data[0]
            return {
                'username': portfolio_data['username'],
                'name': portfolio_data['portfolio_name'],
                'positions': portfolio_data['positions'] if portfolio_data['positions'] else [],
                'created_at': portfolio_data['created_at'],
                'last_updated': portfolio_data['updated_at']
            }
    except Exception as e:
        print(f"Error loading portfolio from Supabase: {e}")
        # Fallback to file-based storage
        return load_portfolio_from_file(username, password)

    return None

def load_portfolio_from_file(username, password):
    """Fallback: Load a portfolio from file system (backward compatibility)"""
    portfolio_path = get_portfolio_path(username, password)
    if portfolio_path.exists():
        with open(portfolio_path, 'r') as f:
            return json.load(f)

    # Backward compatibility: try to load old format (password_hash.json)
    old_portfolio_path = PORTFOLIO_DIR / f"{hash_password(password)}.json"
    if old_portfolio_path.exists():
        with open(old_portfolio_path, 'r') as f:
            portfolio = json.load(f)
            if 'username' not in portfolio:
                portfolio['username'] = username
            return portfolio

    return None

def save_portfolio(username, password, portfolio_data):
    """Save a portfolio to Supabase database"""
    if not supabase:
        # Fallback to file-based storage if Supabase not available
        print(f"⚠ Supabase not available, falling back to file storage for {username}")
        return save_portfolio_to_file(username, password, portfolio_data)

    try:
        password_hash = hash_password(password)

        # Prepare data for Supabase
        supabase_data = {
            'username': username,
            'password_hash': password_hash,
            'portfolio_name': portfolio_data.get('name', ''),
            'positions': portfolio_data.get('positions', []),
            'updated_at': datetime.now().isoformat()
        }

        # Check if portfolio exists
        response = supabase.table('portfolios').select('id').eq('username', username).eq('password_hash', password_hash).execute()

        if response.data and len(response.data) > 0:
            # Update existing portfolio
            print(f"Updating portfolio for {username}")
            supabase.table('portfolios').update(supabase_data).eq('username', username).eq('password_hash', password_hash).execute()
        else:
            # Insert new portfolio
            print(f"Creating new portfolio for {username}")
            supabase_data['created_at'] = datetime.now().isoformat()
            supabase.table('portfolios').insert(supabase_data).execute()

        print(f"✓ Portfolio saved to Supabase for {username}")
        return True
    except Exception as e:
        print(f"❌ Error saving portfolio to Supabase: {str(e)}")
        import traceback
        traceback.print_exc()
        # Fallback to file-based storage
        print(f"⚠ Falling back to file storage for {username}")
        return save_portfolio_to_file(username, password, portfolio_data)

def save_portfolio_to_file(username, password, portfolio_data):
    """Fallback: Save a portfolio to file system"""
    portfolio_path = get_portfolio_path(username, password)
    portfolio_data['last_updated'] = datetime.now().isoformat()

    with open(portfolio_path, 'w') as f:
        json.dump(portfolio_data, f, indent=2)

    return True

def load_portfolio_by_username(username):
    """Load a portfolio by username only (used with session token authentication)"""
    if not supabase:
        return None

    try:
        response = supabase.table('portfolios').select('*').eq('username', username).execute()

        if response.data and len(response.data) > 0:
            portfolio_data = response.data[0]
            return {
                'username': portfolio_data['username'],
                'name': portfolio_data['portfolio_name'],
                'positions': portfolio_data['positions'] if portfolio_data['positions'] else [],
                'created_at': portfolio_data['created_at'],
                'last_updated': portfolio_data['updated_at']
            }
    except Exception as e:
        print(f"Error loading portfolio from Supabase: {e}")

    return None

def save_portfolio_by_username(username, portfolio_data):
    """Save a portfolio by username only (used with session token authentication)"""
    if not supabase:
        print(f"⚠ Supabase not available, cannot save portfolio for {username}")
        return False

    try:
        # Prepare data for Supabase
        supabase_data = {
            'username': username,
            'portfolio_name': portfolio_data.get('name', ''),
            'positions': portfolio_data.get('positions', []),
            'updated_at': datetime.now().isoformat()
        }

        # Check if portfolio exists
        response = supabase.table('portfolios').select('id').eq('username', username).execute()

        if response.data and len(response.data) > 0:
            # Update existing portfolio
            print(f"Updating portfolio for {username}")
            supabase.table('portfolios').update(supabase_data).eq('username', username).execute()
        else:
            # Insert new portfolio
            print(f"Creating new portfolio for {username}")
            supabase_data['created_at'] = datetime.now().isoformat()
            supabase.table('portfolios').insert(supabase_data).execute()

        print(f"✓ Portfolio saved to Supabase for {username}")
        return True
    except Exception as e:
        print(f"❌ Error saving portfolio to Supabase: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# Database helper functions for historical prices
def get_cached_prices_from_db(ticker, from_date, to_date, retries=2):
    """Retrieve historical prices from Supabase database"""
    if not supabase:
        return []

    attempt = 0
    while attempt < retries:
        try:
            response = supabase.table('historical_prices').select('date, close').eq(
                "ticker",
                ticker.upper()
            ).gte('date', from_date).lte('date', to_date).order('date', desc=False).execute()

            return response.data if response.data else []
        except Exception as e:
            attempt += 1
            # Only retry on broken pipe and connection errors
            if attempt < retries and ('broken pipe' in str(e).lower() or 'errno 32' in str(e).lower() or 'connection' in str(e).lower()):
                print(f"Retry {attempt}/{retries-1} for get_cached_prices_from_db({ticker}): {e}")
                time.sleep(0.1 * attempt)  # Brief backoff
                continue
            print(f"Error retrieving prices from database: {e}")
            return []
    return []

def get_last_close_price(ticker, retries=2):
    """Get the most recent close price for a ticker from historical_prices"""
    if not supabase:
        return None

    attempt = 0
    while attempt < retries:
        try:
            response = supabase.table('historical_prices').select('date, close').eq(
                "ticker",
                ticker.upper()
            ).order('date', desc=True).limit(1).execute()

            if response.data and len(response.data) > 0:
                return {
                    'date': response.data[0]['date'],
                    'close': float(response.data[0]['close'])
                }
            return None
        except Exception as e:
            attempt += 1
            # Only retry on broken pipe and connection errors
            if attempt < retries and ('broken pipe' in str(e).lower() or 'errno 32' in str(e).lower() or 'connection' in str(e).lower()):
                print(f"Retry {attempt}/{retries-1} for get_last_close_price({ticker}): {e}")
                time.sleep(0.1 * attempt)  # Brief backoff
                continue
            print(f"Error retrieving last close price for {ticker}: {e}")
            return None
    return None

def get_last_sync_date(ticker, retries=2):
    """Get the most recent date for a ticker's historical prices (for smart syncing)"""
    if not supabase:
        return None

    attempt = 0
    while attempt < retries:
        try:
            response = supabase.table('historical_prices').select('date').eq(
                "ticker",
                ticker.upper()
            ).order('date', desc=True).limit(1).execute()

            if response.data and len(response.data) > 0:
                return response.data[0]['date']
            return None
        except Exception as e:
            attempt += 1
            # Only retry on broken pipe and connection errors
            if attempt < retries and ('broken pipe' in str(e).lower() or 'errno 32' in str(e).lower() or 'connection' in str(e).lower()):
                print(f"Retry {attempt}/{retries-1} for get_last_sync_date({ticker}): {e}")
                time.sleep(0.1 * attempt)  # Brief backoff
                continue
            print(f"Error retrieving last sync date for {ticker}: {e}")
            return None
    return None

def is_market_open():
    """Check if US stock market is currently open.
    Market hours: Mon-Fri, 9:30 AM - 4:00 PM EST
    Returns: Boolean indicating if market is currently trading
    """
    import pytz

    # Get current time in EST
    est = pytz.timezone('US/Eastern')
    now = datetime.now(est)

    # Check if weekday (0 = Monday, 4 = Friday)
    if now.weekday() > 4:  # Weekend (Saturday = 5, Sunday = 6)
        return False

    # Check if within trading hours (9:30 AM - 4:00 PM EST)
    market_open = now.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = now.replace(hour=16, minute=0, second=0, microsecond=0)

    return market_open <= now <= market_close

def save_prices_to_db(ticker, prices, retries=2):
    """
    Save historical prices to Supabase database and update last-sync timestamp.
    Uses upsert to avoid duplicate key errors and automatically update the most recent date.
    """
    if not supabase or not prices:
        return False

    attempt = 0
    while attempt < retries:
        try:
            records = [
                {
                    'ticker': ticker.upper(),
                    'date': p['date'],
                    'close': float(p['close'])
                }
                for p in prices
            ]

            # Use upsert to avoid duplicate key errors
            # This automatically updates the last-sync timestamp since new rows have today's date
            _ = supabase.table('historical_prices').upsert(records).execute()
            print(f"[save_prices_to_db] Saved {len(records)} prices for {ticker}. Last sync will be the most recent date in records.")
            return True
        except Exception as e:
            # Ignore duplicate key errors - they indicate data already exists
            if 'duplicate key' in str(e).lower() or '23505' in str(e):
                print(f"[save_prices_to_db] Skipping {ticker}: data already exists in database")
                return True

            attempt += 1
            # Only retry on broken pipe and connection errors
            if attempt < retries and ('broken pipe' in str(e).lower() or 'errno 32' in str(e).lower() or 'connection' in str(e).lower()):
                print(f"Retry {attempt}/{retries-1} for save_prices_to_db({ticker}): {e}")
                time.sleep(0.1 * attempt)  # Brief backoff
                continue

            print(f"Error saving prices to database: {e}")
            return False
    return False

# AlphaVantage API functions for historical prices
def fetch_historical_prices_from_alphavantage(ticker, from_date):
    """Fetch historical daily prices from AlphaVantage TIME_SERIES_DAILY endpoint"""
    if not ALPHAVANTAGE_API_KEY:
        return {'error': 'ALPHAVANTAGE_API_KEY not configured', 'prices': []}

    try:
        # Convert dates to AlphaVantage format (YYYY-MM-DD)
        from_date_str = from_date.strftime('%Y-%m-%d') if hasattr(from_date, 'strftime') else str(from_date)
        from_date_obj = datetime.strptime(from_date_str, '%Y-%m-%d').date() if isinstance(from_date_str, str) else from_date

        # AlphaVantage endpoint for daily time series
        params = {
            'function': 'TIME_SERIES_DAILY',
            'symbol': ticker.upper(),
            'apikey': ALPHAVANTAGE_API_KEY
        }

        response = requests.get(ALPHAVANTAGE_BASE_URL, params=params, timeout=15)

        if response.status_code != 200:
            return {'error': f'HTTP {response.status_code}', 'prices': []}

        data = response.json()

        # Check for errors in response
        if 'Error Message' in data:
            return {'error': f"AlphaVantage error: {data['Error Message']}", 'prices': []}

        if 'Information' in data:
            return {'error': f"AlphaVantage info: {data['Information']}", 'prices': []}

        # AlphaVantage returns data in 'Time Series (Daily)' key
        if 'Time Series (Daily)' not in data:
            return {'error': f"No 'Time Series (Daily)' in response. Keys: {list(data.keys())}", 'prices': []}

        time_series = data['Time Series (Daily)']

        # Convert AlphaVantage format to our format
        prices = []
        for date_str, day_data in time_series.items():
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()

            # Only include prices from from_date onwards
            if date_obj >= from_date_obj:
                prices.append({
                    'date': date_str,
                    'close': float(day_data.get('4. close', 0))
                })

        # Sort by date ascending
        prices.sort(key=lambda x: x['date'])

        # Save to database for future use
        if prices:
            save_prices_to_db(ticker, prices)

        return {'error': None, 'prices': prices}
    except Exception as e:
        return {'error': f'Exception: {str(e)}', 'prices': []}

# yfinance API functions for historical prices (no API key required, unlimited requests)
def fetch_historical_prices_from_yfinance(ticker, from_date, to_date=None):
    """Fetch historical daily prices using yfinance (free, unlimited)"""
    try:
        import yfinance as yf

        # Convert dates to proper format
        from_date_obj = from_date if isinstance(from_date, datetime) else datetime.strptime(str(from_date), '%Y-%m-%d')

        if to_date is None:
            to_date_obj = datetime.now()
        else:
            to_date_obj = to_date if isinstance(to_date, datetime) else datetime.strptime(str(to_date), '%Y-%m-%d')

        # Fetch data from yfinance
        stock = yf.Ticker(ticker.upper())
        hist = stock.history(start=from_date_obj, end=to_date_obj)

        if hist.empty:
            return {'error': f'No data found for ticker {ticker.upper()}', 'prices': []}

        # Convert yfinance format to our format
        prices = []
        for date_index, row in hist.iterrows():
            date_str = date_index.strftime('%Y-%m-%d')
            close_price = float(row['Close'])
            prices.append({
                'date': date_str,
                'close': close_price
            })

        # Sort by date ascending
        prices.sort(key=lambda x: x['date'])

        # Save to database for future use
        if prices:
            save_prices_to_db(ticker, prices)

        return {'error': None, 'prices': prices}
    except Exception as e:
        return {'error': f'Exception: {str(e)}', 'prices': []}

# Request hooks for maintenance
@app.before_request
def before_request():
    """Run maintenance tasks before each request"""
    cleanup_expired_sessions()

# Frontend routes
@app.route('/')
def serve_index():
    """Serve the main index.html file"""
    return send_from_directory('.', 'index.html')

@app.route('/css/<path:filepath>')
def serve_css(filepath):
    """Serve CSS files from the css directory"""
    return send_from_directory('css', filepath)

@app.route('/js/<path:filepath>')
def serve_js(filepath):
    """Serve JavaScript files from the js directory"""
    return send_from_directory('js', filepath)

# Catch-all route for serving static files and SPA - MOVED TO END OF FILE
# This is now registered after all API routes to give API routes priority

# Portfolio API routes
@app.route('/api/portfolio/create', methods=['POST'])
def create_portfolio():
    """PHASE 2: Create a new user and their first portfolio (registration)

    This endpoint now:
    1. Creates user in users table
    2. Creates first portfolio linked to user
    3. Returns proper multi-portfolio response format
    """
    data = request.json
    username = data.get('username')
    password = data.get('password')
    name = data.get('name')

    # Validate username
    if not username or len(username) < 3:
        return jsonify({
            'error': 'Username must be at least 3 characters long'
        }), 400

    if len(username) > 50:
        return jsonify({
            'error': 'Username must be 50 characters or less'
        }), 400

    # Validate password strength
    if not password:
        return jsonify({
            'error': 'Password is required'
        }), 400

    is_valid, error_msg = validate_strong_password(password)
    if not is_valid:
        return jsonify({
            'error': error_msg
        }), 400

    if not name:
        return jsonify({
            'error': 'Portfolio name is required'
        }), 400

    # PHASE 2: Use new multi-user architecture
    if not supabase:
        return jsonify({
            'error': 'Database connection failed'
        }), 500

    try:
        # Check if username already exists in users table
        existing_user = supabase.table('users').select('id').eq('username', username).execute()
        if existing_user.data and len(existing_user.data) > 0:
            return jsonify({
                'error': 'Username already exists'
            }), 409

        # Create new user in users table
        password_hash = hash_password(password)
        user_data = {
            'username': username,
            'password_hash': password_hash
        }

        user_response = supabase.table('users').insert(user_data).execute()

        if not user_response.data or len(user_response.data) == 0:
            return jsonify({
                'error': 'Failed to create user'
            }), 500

        user_id = user_response.data[0]['id']

        # Create first portfolio for user (will be set as default since it's first)
        portfolio_data = {
            'user_id': user_id,
            'portfolio_name': name,
            'positions': [],
            'is_default': True,  # First portfolio is always default
            'username': username,  # Keep for backward compatibility (old schema column)
            'password_hash': password_hash,  # Keep for backward compatibility (old schema column)
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }

        portfolio_response = supabase.table('portfolios').insert(portfolio_data).execute()

        if not portfolio_response.data or len(portfolio_response.data) == 0:
            return jsonify({
                'error': 'Failed to create portfolio'
            }), 500

        portfolio = portfolio_response.data[0]

        # Create session for the new user
        token = create_session_token(user_id, username, portfolio['id'])

        # Return response in new multi-portfolio format
        response = make_response(jsonify({
            'success': True,
            'message': 'Account created successfully',
            'user': {
                'id': user_id,
                'username': username
            },
            'portfolios': [
                {
                    'id': portfolio['id'],
                    'name': portfolio['portfolio_name'],
                    'positions_count': 0,
                    'is_default': True,
                    'created_at': portfolio['created_at']
                }
            ],
            'active_portfolio_id': portfolio['id'],
            'token': token
        }), 201)

        # Set session token as HTTP-only cookie
        response.set_cookie(
            'session_token',
            token,
            max_age=604800,  # 7 days
            secure=False,  # Set to True in production with HTTPS
            httponly=True,  # Prevent JavaScript access
            samesite='Lax'  # CSRF protection
        )

        return response

    except Exception as e:
        print(f"Error in create_portfolio: {e}")
        return jsonify({
            'error': f'Failed to create account: {str(e)}'
        }), 500

@app.route('/api/portfolio/login', methods=['POST'])
def login_portfolio():
    """PHASE 2: Authenticate user and return list of portfolios

    Returns:
        {
            success: true,
            user: {id, username},
            portfolios: [{id, name, positions_count, created_at, is_default}, ...],
            active_portfolio_id: 'uuid'
        }
    """
    data = request.json
    username = data.get('username')
    password = data.get('password')

    # Validate username
    if not username:
        return jsonify({
            'error': 'Username is required'
        }), 400

    # Validate password
    if not password:
        return jsonify({
            'error': 'Password is required'
        }), 400

    # PHASE 2: Authenticate against users table
    user = authenticate_user(username, password)

    if not user:
        return jsonify({
            'error': 'Invalid username or password'
        }), 404

    # Get user's portfolios
    portfolios = get_user_portfolios(user['user_id'])

    # Get default portfolio ID for active_portfolio_id
    default_portfolio = get_default_portfolio(user['user_id'])
    active_portfolio_id = default_portfolio['id'] if default_portfolio else None

    # Create session token with user_id and active_portfolio_id
    token = create_session_token(user['user_id'], user['username'], active_portfolio_id)

    # Return user and portfolios list
    response = make_response(jsonify({
        'success': True,
        'user': {
            'id': user['user_id'],
            'username': user['username']
        },
        'portfolios': portfolios,
        'active_portfolio_id': active_portfolio_id
    }))

    # Set HTTP-only secure cookie with session token
    response.set_cookie(
        'session_token',
        token,
        max_age=7 * 24 * 60 * 60,  # 7 days
        httponly=True,
        secure=True,  # Only send over HTTPS
        samesite='Lax'
    )

    return response

@app.route('/api/portfolio/logout', methods=['POST'])
def logout_portfolio():
    """Logout and revoke session token"""
    token = request.cookies.get('session_token')
    if token:
        revoke_session_token(token)

    response = make_response(jsonify({'success': True}))
    response.set_cookie('session_token', '', max_age=0)  # Delete cookie
    return response

# PHASE 2: New portfolio CRUD endpoints

@app.route('/api/user/portfolios', methods=['GET'])
def get_user_portfolios_endpoint():
    """Get list of all portfolios for authenticated user

    Returns:
        {
            success: true,
            portfolios: [{id, name, positions_count, created_at, is_default}, ...]
        }
    """
    token = request.cookies.get('session_token')
    if not token:
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']
    portfolios = get_user_portfolios(user_id)

    return jsonify({
        'success': True,
        'portfolios': portfolios
    })

@app.route('/api/user/portfolios', methods=['POST'])
def create_user_portfolio_endpoint():
    """Create a new portfolio for authenticated user

    Request body:
        {
            portfolio_name: 'Portfolio Name'
        }

    Returns:
        {
            success: true,
            portfolio: {id, name, positions_count, created_at, is_default}
        }
    """
    try:
        print(f"\n[DEBUG] POST /api/user/portfolios - Request received", flush=True)
        print(f"[DEBUG] Content-Type: {request.content_type}", flush=True)
        print(f"[DEBUG] Has session_token cookie: {request.cookies.get('session_token') is not None}", flush=True)

        token = request.cookies.get('session_token')
        if not token:
            print(f"[ERROR] No session token in cookies", flush=True)
            return jsonify({'error': 'Not authenticated'}), 401

        session = validate_session_token(token)
        if not session:
            print(f"[ERROR] Session token validation failed", flush=True)
            return jsonify({'error': 'Session expired or invalid'}), 401

        user_id = session['user_id']
        print(f"[DEBUG] User ID from session: {user_id}", flush=True)

        data = request.json
        print(f"[DEBUG] Request JSON data: {data}", flush=True)

        if not data:
            print(f"[ERROR] No JSON data received. Content-Type: {request.content_type}", flush=True)
            return jsonify({'error': 'Invalid request body'}), 400

        portfolio_name = data.get('portfolio_name')
        print(f"[DEBUG] Portfolio name from request: {portfolio_name}", flush=True)

        if not portfolio_name:
            print(f"[ERROR] Portfolio name not provided in request", flush=True)
            return jsonify({'error': 'Portfolio name is required'}), 400

        if len(portfolio_name) < 1 or len(portfolio_name) > 50:
            print(f"[ERROR] Portfolio name length invalid: {len(portfolio_name)}", flush=True)
            return jsonify({'error': 'Portfolio name must be 1-50 characters'}), 400

        print(f"[CREATE] Creating portfolio '{portfolio_name}' for user {user_id}", flush=True)
        portfolio = create_portfolio_for_user(user_id, portfolio_name)

        if not portfolio:
            print(f"[ERROR] create_portfolio_for_user returned None", flush=True)
            return jsonify({'error': 'Failed to create portfolio (limit may be reached)'}), 400

        print(f"[SUCCESS] Portfolio created: {portfolio['id']}", flush=True)
        return jsonify({
            'success': True,
            'portfolio': {
                'id': portfolio['id'],
                'name': portfolio['name'],
                'positions_count': 0,
                'created_at': portfolio['created_at'],
                'is_default': portfolio['is_default']
            }
        })
    except Exception as e:
        print(f"\n[EXCEPTION] Error creating portfolio: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/user/portfolios/<portfolio_id>/select', methods=['PUT'])
def select_portfolio_endpoint(portfolio_id):
    """Set a portfolio as active/default

    Returns:
        {
            success: true,
            active_portfolio_id: 'uuid'
        }
    """
    token = request.cookies.get('session_token')
    if not token:
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']

    if not set_active_portfolio(user_id, portfolio_id):
        return jsonify({'error': 'Failed to select portfolio'}), 400

    # Update session with new active portfolio
    _active_sessions[token]['active_portfolio_id'] = portfolio_id

    return jsonify({
        'success': True,
        'active_portfolio_id': portfolio_id
    })

@app.route('/api/user/portfolios/<portfolio_id>', methods=['PUT'])
def rename_portfolio_endpoint(portfolio_id):
    """Rename a portfolio

    Request body:
        {
            new_name: 'New Portfolio Name'
        }

    Returns:
        {
            success: true,
            portfolio: {id, name, ...}
        }
    """
    token = request.cookies.get('session_token')
    if not token:
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']
    data = request.json
    new_name = data.get('new_name')

    if not new_name:
        return jsonify({'error': 'New name is required'}), 400

    if len(new_name) < 1 or len(new_name) > 50:
        return jsonify({'error': 'Portfolio name must be 1-50 characters'}), 400

    if not update_portfolio_name(user_id, portfolio_id, new_name):
        return jsonify({'error': 'Failed to rename portfolio'}), 400

    portfolio = get_portfolio_by_id(user_id, portfolio_id)

    return jsonify({
        'success': True,
        'portfolio': {
            'id': portfolio['id'],
            'name': portfolio['name'],
            'is_default': portfolio['is_default']
        }
    })

@app.route('/api/user/portfolios/<portfolio_id>', methods=['DELETE'])
def delete_portfolio_endpoint(portfolio_id):
    """Delete a portfolio

    Returns:
        {
            success: true,
            message: 'Portfolio deleted'
        }
    """
    token = request.cookies.get('session_token')
    if not token:
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']

    if not delete_portfolio(user_id, portfolio_id):
        return jsonify({'error': 'Failed to delete portfolio (may be last portfolio)'}), 400

    return jsonify({
        'success': True,
        'message': 'Portfolio deleted'
    })

@app.route('/api/portfolio/details', methods=['GET'])
def get_portfolio_details():
    """PHASE 2: Get portfolio details using session token

    Query params:
        portfolio_id: optional UUID of portfolio to fetch (default: active portfolio)

    Returns:
        {
            success: true,
            portfolio: {id, name, positions, created_at, updated_at, is_default}
        }
    """
    token = request.cookies.get('session_token')

    if not token:
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']
    portfolio_id = request.args.get('portfolio_id', session['active_portfolio_id'])

    if not portfolio_id:
        return jsonify({'error': 'No portfolio specified'}), 400

    # PHASE 2: Get portfolio by ID, verify user owns it
    portfolio = get_portfolio_by_id(user_id, portfolio_id)

    if not portfolio:
        return jsonify({'error': 'Portfolio not found'}), 404

    return jsonify({
        'success': True,
        'portfolio': {
            'id': portfolio['id'],
            'name': portfolio['name'],
            'positions': portfolio['positions'],
            'created_at': portfolio['created_at'],
            'updated_at': portfolio['updated_at'],
            'is_default': portfolio['is_default']
        }
    })

@app.route('/api/portfolio/save', methods=['POST'])
def save_portfolio_data():
    """PHASE 2: Save/update portfolio positions

    Request body:
        {
            positions: [...],
            portfolio_id: optional UUID (uses active portfolio if not provided)
        }
    """
    token = request.cookies.get('session_token')
    if not token:
        return jsonify({
            'error': 'Unauthorized - no session token'
        }), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({
            'error': 'Unauthorized - invalid or expired session'
        }), 401

    user_id = session['user_id']
    data = request.json
    positions = data.get('positions')
    portfolio_id = data.get('portfolio_id', session['active_portfolio_id'])
    cached_return = data.get('cached_return_percentage')  # PHASE 4: Latest return for switcher

    if not positions:
        return jsonify({
            'error': 'Positions data is required'
        }), 400

    if not portfolio_id:
        return jsonify({
            'error': 'Portfolio not found'
        }), 404

    # PHASE 2: Get portfolio by ID, verify user owns it
    portfolio = get_portfolio_by_id(user_id, portfolio_id)

    if not portfolio:
        return jsonify({
            'error': 'Portfolio not found'
        }), 404

    # Update positions in Supabase
    try:
        update_data = {
            'positions': positions,
            'updated_at': datetime.now().isoformat()
        }
        # Note: cached_return_percentage column may not exist in database schema, so we skip it
        # The portfolio metrics are stored separately in the portfolio_metrics table

        supabase.table('portfolios').update(update_data).eq('id', portfolio_id).eq('user_id', user_id).execute()

        return jsonify({
            'success': True,
            'message': 'Portfolio saved successfully'
        })
    except Exception as e:
        print(f"Error saving portfolio: {e}")
        return jsonify({
            'error': 'Failed to save portfolio'
        }), 500

def fetch_current_price_for_ticker(ticker):
    """
    Shared price-fetching logic extracted from get_stock_instant().
    Fetches current price from Finnhub, falls back to last_close from database.

    Args:
        ticker: Stock ticker symbol

    Returns:
        float: Current price, or last_close from database, or 0
    """
    try:
        ticker = ticker.upper()

        # First try to get live price from Finnhub
        if FINNHUB_API_KEY:
            try:
                quote_params = {
                    'symbol': ticker,
                    'token': FINNHUB_API_KEY
                }
                quote_response = requests.get(
                    f'{FINNHUB_BASE_URL}/quote',
                    params=quote_params,
                    timeout=5
                )

                if quote_response.status_code == 200:
                    quote_data = quote_response.json()
                    price_value = quote_data.get('c')
                    if price_value is not None:
                        try:
                            price_float = float(price_value)
                            if price_float > 0:
                                print(f"[BACKGROUND] {ticker}: Got live price {price_float} from Finnhub", flush=True)
                                return price_float
                        except (TypeError, ValueError) as e:
                            print(f"[BACKGROUND] {ticker}: Could not convert price to float: {price_value}, error: {e}", flush=True)
            except Exception as e:
                print(f"[BACKGROUND] {ticker}: Finnhub failed: {e}", flush=True)

        # Fallback to last_close from database
        last_close = get_last_close_price(ticker)
        if last_close is not None:
            try:
                last_close_float = float(last_close)
                if last_close_float > 0:
                    print(f"[BACKGROUND] {ticker}: Using last_close {last_close_float} from database", flush=True)
                    return last_close_float
            except (TypeError, ValueError) as e:
                print(f"[BACKGROUND] {ticker}: Could not convert last_close to float: {last_close}, error: {e}", flush=True)

        # Final fallback
        print(f"[BACKGROUND] {ticker}: No price data available, using 0", flush=True)
        return 0.0

    except Exception as e:
        print(f"[BACKGROUND] Error fetching price for {ticker}: {e}", flush=True)
        return 0.0


@app.route('/api/portfolios/get-all-returns', methods=['POST'])
def get_all_portfolio_returns():
    """PHASE 4: Fetch returns for all user portfolios on login

    This endpoint fetches current prices for all positions across all user portfolios
    and calculates return percentages. Called immediately after login to populate
    the portfolio switcher with fresh return data.

    Response:
        {
            success: true,
            portfolios: [{id, name, positions_count, return_percentage, is_default}, ...]
        }
    """
    print(f"\n[LOGIN] POST /api/portfolios/get-all-returns called", flush=True)

    token = request.cookies.get('session_token')
    if not token:
        print(f"[LOGIN] No session token in cookies", flush=True)
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        print(f"[LOGIN] Session token validation failed", flush=True)
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']
    print(f"[LOGIN] Fetching portfolio returns for user: {user_id}", flush=True)

    try:
        # Get all portfolios for this user
        portfolios_response = supabase.table('portfolios').select(
            'id, portfolio_name, positions, is_default, created_at, updated_at'
        ).eq('user_id', user_id).execute()

        if not portfolios_response.data:
            return jsonify({'success': True, 'portfolios': []})

        # STEP 1: Collect all unique tickers across all portfolios to minimize API calls
        all_tickers = set()
        for portfolio in portfolios_response.data:
            positions = portfolio.get('positions', [])
            for position in positions:
                ticker = position.get('ticker', '').upper()
                if ticker:
                    all_tickers.add(ticker)

        print(f"[LOGIN] Collected {len(all_tickers)} unique tickers from {len(portfolios_response.data)} portfolios", flush=True)

        # STEP 2: Fetch prices for all unique tickers (with batching for rate limit safety)
        price_cache = {}
        batch_size = 20  # Concurrent requests per batch
        ticker_list = list(all_tickers)

        for i in range(0, len(ticker_list), batch_size):
            batch = ticker_list[i:i+batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(ticker_list) + batch_size - 1) // batch_size

            print(f"[LOGIN] Fetching batch {batch_num}/{total_batches}: {len(batch)} tickers", flush=True)

            # Fetch prices in parallel for this batch
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = {
                    executor.submit(fetch_current_price_for_ticker, ticker): ticker
                    for ticker in batch
                }
                for future in concurrent.futures.as_completed(futures):
                    ticker = futures[future]
                    try:
                        price = future.result()
                        price_cache[ticker] = price
                    except Exception as e:
                        print(f"[LOGIN] Error fetching {ticker}: {e}", flush=True)
                        price_cache[ticker] = 0.0

        print(f"[LOGIN] Price cache populated: {len(price_cache)} tickers", flush=True)

        # STEP 3: Calculate returns for each portfolio using cached prices
        updated_portfolios = []

        for portfolio in portfolios_response.data:
            positions = portfolio.get('positions', [])

            # Enrich positions with cached prices
            enriched_positions = []
            for position in positions:
                ticker = position.get('ticker', '').upper()
                if not ticker:
                    continue

                # Use cached price, or fallback to purchase price
                current_price = price_cache.get(ticker, position.get('purchase_price', 0))

                enriched_pos = position.copy()
                enriched_pos['current_price'] = current_price
                enriched_positions.append(enriched_pos)

            # Calculate return percentage with enriched positions
            return_pct = calculate_portfolio_return(enriched_positions)
            print(f"[LOGIN] Portfolio '{portfolio['portfolio_name']}': return={return_pct}%", flush=True)

            updated_portfolios.append({
                'id': portfolio['id'],
                'name': portfolio['portfolio_name'],
                'positions_count': len(positions),
                'is_default': portfolio.get('is_default', False),
                'created_at': portfolio.get('created_at'),
                'return_percentage': return_pct
            })

        print(f"[LOGIN] Returning {len(updated_portfolios)} portfolios to frontend", flush=True)
        return jsonify({
            'success': True,
            'portfolios': updated_portfolios
        })

    except Exception as e:
        print(f"[LOGIN] Error fetching portfolio returns: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to fetch portfolio returns'}), 500


@app.route('/api/portfolios/update-all-returns', methods=['POST'])
def update_all_portfolio_returns():
    """PHASE 4: Background update for all user portfolios' return percentages

    This endpoint fetches current prices for all positions across all user portfolios,
    recalculates return percentages, and updates the cached_return_percentage in the database.
    Used by frontend background update timer to keep portfolio switcher fresh.

    Response:
        {
            success: true,
            portfolios: [{id, name, positions_count, return_percentage, is_default}, ...]
        }
    """
    print(f"\n[BACKGROUND] POST /api/portfolios/update-all-returns called", flush=True)

    token = request.cookies.get('session_token')
    if not token:
        print(f"[BACKGROUND] No session token in cookies", flush=True)
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        print(f"[BACKGROUND] Session token validation failed", flush=True)
        return jsonify({'error': 'Session expired or invalid'}), 401

    user_id = session['user_id']
    print(f"[BACKGROUND] Starting portfolio update for user: {user_id}", flush=True)

    try:
        # Get all portfolios for this user
        portfolios_response = supabase.table('portfolios').select(
            'id, portfolio_name, positions, is_default, created_at, updated_at'
        ).eq('user_id', user_id).execute()

        if not portfolios_response.data:
            return jsonify({'success': True, 'portfolios': []})

        # STEP 1: Collect all unique tickers across all portfolios to minimize API calls
        all_tickers = set()
        for portfolio in portfolios_response.data:
            positions = portfolio.get('positions', [])
            for position in positions:
                ticker = position.get('ticker', '').upper()
                if ticker:
                    all_tickers.add(ticker)

        print(f"[BACKGROUND] Collected {len(all_tickers)} unique tickers from {len(portfolios_response.data)} portfolios", flush=True)

        # STEP 2: Fetch prices for all unique tickers (with batching for rate limit safety)
        price_cache = {}
        batch_size = 20  # Concurrent requests per batch
        ticker_list = list(all_tickers)

        for i in range(0, len(ticker_list), batch_size):
            batch = ticker_list[i:i+batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(ticker_list) + batch_size - 1) // batch_size

            print(f"[BACKGROUND] Fetching batch {batch_num}/{total_batches}: {len(batch)} tickers", flush=True)

            # Fetch prices in parallel for this batch
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = {
                    executor.submit(fetch_current_price_for_ticker, ticker): ticker
                    for ticker in batch
                }
                for future in concurrent.futures.as_completed(futures):
                    ticker = futures[future]
                    try:
                        price = future.result()
                        price_cache[ticker] = price
                    except Exception as e:
                        print(f"[BACKGROUND] Error fetching {ticker}: {e}", flush=True)
                        price_cache[ticker] = 0.0

        print(f"[BACKGROUND] Price cache populated: {len(price_cache)} tickers", flush=True)

        # STEP 3: Calculate returns for each portfolio using cached prices
        updated_portfolios = []

        for portfolio in portfolios_response.data:
            positions = portfolio.get('positions', [])
            print(f"[BACKGROUND] Processing portfolio '{portfolio['portfolio_name']}' with {len(positions)} positions", flush=True)
            if positions:
                print(f"[BACKGROUND] Sample position keys: {list(positions[0].keys())}", flush=True)
                print(f"[BACKGROUND] Sample position data: {positions[0]}", flush=True)

            # Enrich positions with cached prices
            enriched_positions = []
            for position in positions:
                ticker = position.get('ticker', '').upper()
                if not ticker:
                    print(f"[BACKGROUND] Position has no 'ticker' field. Available keys: {list(position.keys())}", flush=True)
                    continue

                # Use cached price, or fallback to purchase price
                current_price = price_cache.get(ticker, position.get('purchase_price', 0))

                enriched_pos = position.copy()
                enriched_pos['current_price'] = current_price
                enriched_positions.append(enriched_pos)

            # Debug: Log the enriched positions before calculation
            print(f"[BACKGROUND] Portfolio '{portfolio['portfolio_name']}' enriched positions:", flush=True)
            for ep in enriched_positions:
                print(f"  - {ep}", flush=True)

            # Calculate return percentage with enriched positions
            return_pct = calculate_portfolio_return(enriched_positions)
            print(f"[BACKGROUND] Portfolio '{portfolio['portfolio_name']}': positions={len(positions)}, return={return_pct}%", flush=True)

            updated_portfolios.append({
                'id': portfolio['id'],
                'name': portfolio['portfolio_name'],
                'positions_count': len(positions),
                'is_default': portfolio.get('is_default', False),
                'created_at': portfolio.get('created_at'),
                'return_percentage': return_pct
            })

        print(f"[BACKGROUND] Returning {len(updated_portfolios)} portfolios to frontend", flush=True)
        return jsonify({
            'success': True,
            'portfolios': updated_portfolios
        })

    except Exception as e:
        print(f"[BACKGROUND] Error updating portfolio returns: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to update portfolios'}), 500

@app.route('/api/portfolio/last-sync', methods=['POST'])
def get_portfolio_last_sync():
    """
    Get the last sync date for all tickers in a portfolio.
    Returns a dictionary mapping each ticker to its last update date in the database.
    Used for smart historical data fetching - only fetch missing date ranges.

    Request body:
        {
            "username": "user@example.com",
            "password": "password123",
            "tickers": ["AAPL", "MSFT", "GOOGL"]  # Optional: if not provided, uses portfolio positions
        }

    Response:
        {
            "last_sync": {
                "AAPL": "2025-11-28",
                "MSFT": "2025-11-27",
                "GOOGL": null
            }
        }
    """
    try:
        data = request.json
        username = data.get('username')
        password = data.get('password')
        tickers = data.get('tickers')

        # If tickers not provided, get them from portfolio
        if not tickers:
            portfolio = load_portfolio(username, password)
            if not portfolio:
                return jsonify({
                    'error': 'Portfolio not found'
                }), 404
            tickers = [pos['ticker'] for pos in portfolio.get('positions', [])]

        # Get last sync date for each ticker
        last_sync = {}
        for ticker in tickers:
            last_date = get_last_sync_date(ticker)
            last_sync[ticker.upper()] = last_date

        return jsonify({
            'last_sync': last_sync,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        return jsonify({
            'error': f'Error fetching last sync dates: {str(e)}'
        }), 500

@app.route('/api/stock/<ticker>', methods=['GET'])
def get_stock_data(ticker):
    if not FINNHUB_API_KEY:
        return jsonify({
            'error': 'Finnhub API key not configured. Please set FINNHUB_API_KEY environment variable.'
        }), 500

    try:
        ticker = ticker.upper()
        print(f"[STOCK] Fetching data for: {ticker}", flush=True)

        # Get current quote using Finnhub quote endpoint
        quote_params = {
            'symbol': ticker,
            'token': FINNHUB_API_KEY
        }
        print(f"[STOCK] Calling Finnhub with params: {quote_params}", flush=True)
        quote_response = requests.get(f'{FINNHUB_BASE_URL}/quote', params=quote_params)
        print(f"[STOCK] Finnhub response status: {quote_response.status_code}", flush=True)

        if quote_response.status_code != 200:
            print(f"[STOCK] Error response: {quote_response.text}", flush=True)
            return jsonify({
                'error': f'Failed to fetch quote data: {quote_response.status_code}'
            }), quote_response.status_code

        quote_data = quote_response.json()
        print(f"[STOCK] {ticker} - API response: {quote_data}", flush=True)

        # Check if valid response
        if 'c' not in quote_data or quote_data['c'] is None:
            return jsonify({
                'error': 'Invalid ticker symbol or data not available'
            }), 404

        # Extract price data with proper None handling
        current_price_raw = quote_data.get('c')
        previous_close_raw = quote_data.get('pc')
        change_amount_raw = quote_data.get('d')
        change_percent_raw = quote_data.get('dp')

        print(f"[STOCK] {ticker} - Raw values: c={current_price_raw}, pc={previous_close_raw}, d={change_amount_raw}, dp={change_percent_raw}", flush=True)

        # All core price data should be available for valid stocks
        if current_price_raw is None:
            return jsonify({
                'error': f'No price data available for {ticker} from API',
                'hint': f'"{ticker}" may not be supported by Finnhub. Try a US ticker symbol (e.g., AAL, MSFT, AAPL). FTSE100 stocks are not supported.'
            }), 404

        try:
            current_price = float(current_price_raw)
            previous_close = float(previous_close_raw) if previous_close_raw is not None else current_price
            change_amount = float(change_amount_raw) if change_amount_raw is not None else 0
            change_percent = float(change_percent_raw) if change_percent_raw is not None else 0
        except (TypeError, ValueError) as e:
            return jsonify({
                'error': f'Invalid price data for {ticker}: {str(e)}'
            }), 400

        if current_price == 0:
            return jsonify({
                'error': f'Ticker "{ticker}" not found in Finnhub database',
                'hint': f'This ticker may not be supported. Finnhub primarily supports US stocks. FTSE100 stocks (e.g., MRO.L, MTLN.L) are not available.'
            }), 404

        # Get company profile for name
        profile_params = {
            'symbol': ticker,
            'token': FINNHUB_API_KEY
        }
        profile_response = requests.get(f'{FINNHUB_BASE_URL}/stock/profile2', params=profile_params)

        company_name = ticker
        market_cap = 'N/A'

        if profile_response.status_code == 200:
            profile_data = profile_response.json()
            company_name = profile_data.get('name', ticker) or ticker
            market_cap_value = profile_data.get('marketCapitalization')
            if market_cap_value:
                try:
                    market_cap = int(market_cap_value * 1_000_000)  # Convert to actual value
                except:
                    market_cap = 'N/A'

        # Create simple 2-point chart (previous close -> current)
        yesterday = datetime.now() - timedelta(days=1)
        today = datetime.now()
        chart_data = [
            {'date': yesterday.strftime('%Y-%m-%d'), 'price': round(previous_close, 2)},
            {'date': today.strftime('%Y-%m-%d'), 'price': round(current_price, 2)}
        ]

        # Prepare response
        response_data = {
            'ticker': ticker,
            'company_name': company_name,
            'current_price': round(current_price, 2),
            'change_amount': round(change_amount, 2),
            'change_percent': round(change_percent, 2),
            'previous_close': round(previous_close, 2),
            'market_cap': market_cap,
            'chart_data': chart_data
        }

        return jsonify(response_data)

    except requests.exceptions.RequestException as e:
        print(f"[STOCK] Network error for {ticker}: {str(e)}", flush=True)
        import traceback
        print(traceback.format_exc(), flush=True)
        return jsonify({
            'error': f'Network error: {str(e)}'
        }), 500
    except Exception as e:
        print(f"[STOCK] ERROR for {ticker}: {str(e)}", flush=True)
        import traceback
        print(traceback.format_exc(), flush=True)
        return jsonify({
            'error': f'Error fetching stock data: {str(e)}'
        }), 500

@app.route('/api/stock/<ticker>/cached', methods=['GET'])
def get_stock_cached(ticker):
    """
    Get ONLY cached price data from database (no API calls).
    Returns instantly for immediate rendering.
    """
    try:
        ticker = ticker.upper()
        last_close_data = get_last_close_price(ticker)

        return jsonify({
            'ticker': ticker,
            'last_close': last_close_data,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({
            'error': f'Error fetching cached data: {str(e)}',
            'ticker': ticker,
            'last_close': None
        }), 500

@app.route('/api/stock/<ticker>/instant', methods=['GET'])
def get_stock_instant(ticker):
    """
    Get stock price data optimized for instant rendering (two-phase strategy).
    Returns: last cached close price + current live price + market status

    This endpoint supports the two-phase rendering strategy:
    - Phase 1: Use last_close from database for immediate render
    - Phase 2: Use current_price for real-time update (only during market hours)
    """
    try:
        ticker = ticker.upper()
        app.logger.info(f"[/instant] Fetching data for {ticker}")

        # PHASE 1: Get cached last close price from database (INSTANT)
        last_close_data = get_last_close_price(ticker)
        app.logger.info(f"[/instant] {ticker} - Database last_close: {last_close_data}")

        # PHASE 2: Try to get current live price from Finnhub
        current_price = None
        change_amount = None
        change_percent = None
        previous_close = None
        company_name = None

        if FINNHUB_API_KEY:
            try:
                # Get current quote using Finnhub quote endpoint
                quote_params = {
                    'symbol': ticker,
                    'token': FINNHUB_API_KEY
                }
                quote_response = requests.get(f'{FINNHUB_BASE_URL}/quote', params=quote_params, timeout=5)
                app.logger.info(f"[/instant] {ticker} - Finnhub quote status: {quote_response.status_code}")

                if quote_response.status_code == 200:
                    quote_data = quote_response.json()
                    app.logger.info(f"[/instant] {ticker} - Finnhub quote data: {quote_data}")

                    # Check if valid response
                    if 'c' in quote_data and quote_data['c'] is not None:
                        current_price_raw = quote_data.get('c')
                        previous_close_raw = quote_data.get('pc')
                        change_amount_raw = quote_data.get('d')
                        change_percent_raw = quote_data.get('dp')

                        current_price = float(current_price_raw)
                        previous_close = float(previous_close_raw) if previous_close_raw is not None else current_price
                        change_amount = float(change_amount_raw) if change_amount_raw is not None else 0
                        change_percent = float(change_percent_raw) if change_percent_raw is not None else 0
                        app.logger.info(f"[/instant] {ticker} - Parsed live price: {current_price}")

                # Get company name from profile
                profile_params = {
                    'symbol': ticker,
                    'token': FINNHUB_API_KEY
                }
                profile_response = requests.get(f'{FINNHUB_BASE_URL}/stock/profile2', params=profile_params, timeout=5)

                if profile_response.status_code == 200:
                    profile_data = profile_response.json()
                    company_name = profile_data.get('name', ticker) or ticker

            except Exception as e:
                # Finnhub call failed, but that's okay - we have cached data
                print(f"Warning: Could not fetch live price for {ticker} from Finnhub: {e}")

        # Determine if market is open
        market_open = is_market_open()

        # Only include current_price if it's valid (> 0)
        # This prevents returning invalid 0 prices from the API
        valid_current_price = current_price if (current_price and current_price > 0) else None
        app.logger.info(f"[/instant] {ticker} - Raw price: {current_price}, Valid: {valid_current_price}")

        # Prepare response for two-phase rendering
        response = {
            'ticker': ticker,
            'company_name': company_name or ticker,
            'market_open': market_open,
            'timestamp': datetime.now().isoformat(),
            'last_close': last_close_data,  # For Phase 1 (instant render)
            'current_price': valid_current_price,  # For Phase 2 (real-time update)
            'change_amount': change_amount if valid_current_price else None,
            'change_percent': change_percent if valid_current_price else None,
            'previous_close': previous_close if valid_current_price else None
        }
        app.logger.info(f"[/instant] {ticker} - Response: last_close={last_close_data}, current_price={valid_current_price}")

        # Always return 200, even if no data available
        # Phase 1 will use fallback prices if needed, and Phase 2 will retry with historical data
        return jsonify(response)

    except Exception as e:
        return jsonify({
            'error': f'Error fetching instant stock data: {str(e)}'
        }), 500

@app.route('/api/stock/<ticker>/history', methods=['GET'])
def get_stock_history(ticker):
    """
    Fetch historical daily prices for a ticker.
    Strategy: Check database first, fall back to AlphaVantage API, save to database.
    Query params:
        - from_date: Start date in YYYY-MM-DD format
        - to_date: End date in YYYY-MM-DD format (optional, defaults to today)
    """
    try:
        ticker = ticker.upper()

        # Get date parameters
        from_date_str = request.args.get('from_date')
        to_date_str = request.args.get('to_date')

        if not from_date_str:
            return jsonify({
                'error': 'from_date parameter is required (format: YYYY-MM-DD)'
            }), 400

        # Parse dates
        try:
            from_date = datetime.strptime(from_date_str, '%Y-%m-%d').date()
            if to_date_str:
                to_date = datetime.strptime(to_date_str, '%Y-%m-%d').date()
            else:
                to_date = datetime.now().date()
        except ValueError:
            return jsonify({
                'error': 'Invalid date format. Use YYYY-MM-DD'
            }), 400

        # STEP 1: Try to get prices from database first (fastest)
        db_prices = get_cached_prices_from_db(ticker, from_date.isoformat(), to_date.isoformat())

        if db_prices:
            # Convert database format to API format
            prices = [
                {
                    'date': p['date'],
                    'close': round(float(p['close']), 2)
                }
                for p in db_prices
            ]
            return jsonify({
                'ticker': ticker,
                'from_date': from_date_str,
                'to_date': to_date.isoformat(),
                'prices': prices,
                'source': 'database',
                'limited_data': False
            })

        # STEP 2: If not in database, fetch from yfinance (first-time only) - free and unlimited
        result = fetch_historical_prices_from_yfinance(ticker, from_date, to_date)
        prices_list = result.get('prices', [])
        fetch_error = result.get('error')

        if not prices_list:
            # Return detailed error info from yfinance fetch
            return jsonify({
                'error': 'No historical data available for this ticker',
                'debug': {
                    'ticker': ticker,
                    'from_date': from_date_str,
                    'source': 'yfinance',
                    'fetch_error': fetch_error
                }
            }), 404

        # Format prices
        prices = [
            {
                'date': p['date'],
                'close': round(float(p['close']), 2)
            }
            for p in prices_list
        ]

        return jsonify({
            'ticker': ticker,
            'from_date': from_date_str,
            'to_date': to_date.isoformat(),
            'prices': prices,
            'source': 'yfinance',
            'limited_data': False
        })

    except requests.exceptions.RequestException as e:
        return jsonify({
            'error': f'Network error: {str(e)}'
        }), 500
    except Exception as e:
        return jsonify({
            'error': f'Error fetching historical data: {str(e)}'
        }), 500

@app.route('/api/news/<ticker>', methods=['GET'])
def get_company_news(ticker):
    """
    Fetch news for a specific ticker from the past N days using Marketaux API.
    Query params:
        - days: Number of days to look back (1, 2, 5, or 7)
    """
    if not MARKETAUX_API_KEY:
        return jsonify({
            'error': 'Marketaux API key not configured. Please set MARKETAUX_API_KEY environment variable.'
        }), 500

    try:
        ticker = ticker.upper()
        days = request.args.get('days', '5', type=int)

        # Validate days parameter
        if days not in [1, 2, 5, 7]:
            days = 5

        # Calculate date range
        from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        to_date = datetime.now().strftime('%Y-%m-%d')

        # Fetch news from Marketaux API
        params = {
            'api_token': MARKETAUX_API_KEY,
            'symbols': ticker,
            'published_after': from_date,
            'published_before': to_date
        }

        response = requests.get('https://api.marketaux.com/v1/news/all', params=params)

        if response.status_code != 200:
            return jsonify({
                'error': f'Failed to fetch news: {response.status_code}'
            }), response.status_code

        data = response.json()

        # Transform Marketaux response to match expected format
        # Marketaux returns: { data: [ { headline, summary, url, source, published_at, ... } ] }
        news_items = []
        if data.get('data') and isinstance(data['data'], list):
            for article in data['data']:
                news_items.append({
                    'headline': article.get('title', ''),
                    'summary': article.get('description', ''),
                    'url': article.get('url', ''),
                    'source': article.get('source', ''),
                    'datetime': int(datetime.fromisoformat(article.get('published_at', '').replace('Z', '+00:00')).timestamp()) if article.get('published_at') else None
                })

        return jsonify({
            'ticker': ticker,
            'days': days,
            'from_date': from_date,
            'to_date': to_date,
            'news': news_items
        })

    except requests.exceptions.RequestException as e:
        return jsonify({
            'error': f'Network error: {str(e)}'
        }), 500
    except Exception as e:
        return jsonify({
            'error': f'Error fetching news: {str(e)}'
        }), 500

@app.route('/api/portfolio/delete-historical/<ticker>', methods=['DELETE'])
def delete_historical_data(ticker):
    """Delete all historical price data for a specific ticker from the database"""
    try:
        # Get session token from cookie to verify user
        token = request.cookies.get('session_token')
        if not token:
            return jsonify({'error': 'Not authenticated'}), 401

        username = validate_session_token(token)
        if not username:
            return jsonify({'error': 'Session expired or invalid'}), 401

        # Validate ticker
        ticker = ticker.upper().strip()
        if not ticker or not re.match(r'^[A-Z]{1,5}$', ticker):
            return jsonify({'error': 'Invalid ticker format'}), 400

        # Delete from Supabase historical_prices table
        if not supabase:
            return jsonify({'error': 'Database not available'}), 500

        try:
            _ = supabase.table('historical_prices').delete().eq('ticker', ticker).execute()
            print(f"✓ Deleted historical data for {ticker} from Supabase")
        except Exception as db_error:
            print(f"⚠ Error deleting from Supabase: {str(db_error)}")
            # Continue even if deletion fails - the position is already removed from portfolio

        return jsonify({'success': True, 'message': f'Historical data deleted for {ticker}'})

    except Exception as e:
        print(f"Error deleting historical data: {str(e)}")
        return jsonify({'error': f'Error deleting historical data: {str(e)}'}), 500

@app.route('/api/modals/<modal_key>', methods=['GET'])
def get_modal(modal_key):
    """Get modal configuration by key"""
    if not supabase:
        return jsonify({'error': 'Database not configured'}), 503

    try:
        print(f"[MODAL] Fetching modal config for: {modal_key}")
        response = supabase.table('modals').select('*').eq('modal_key', modal_key).execute()

        if response.data and len(response.data) > 0:
            modal = response.data[0]
            print(f"[MODAL] Successfully fetched modal config for: {modal_key}")
            return jsonify({
                'id': modal['id'],
                'modal_key': modal['modal_key'],
                'title': modal['title'],
                'body_text': modal['body_text'],
                'warning_text': modal.get('warning_text'),
                'cancel_button_text': modal.get('cancel_button_text', 'Cancel'),
                'confirm_button_text': modal['confirm_button_text'],
                'confirm_button_color': modal.get('confirm_button_color', 'danger')
            })
        else:
            print(f"[MODAL] Modal not found in database: {modal_key}")
            return jsonify({'error': f'Modal not found: {modal_key}'}), 404

    except Exception as e:
        error_msg = str(e)
        print(f"[MODAL] Error fetching modal '{modal_key}': {error_msg}")
        import traceback
        traceback.print_exc()
        # Return detailed error for debugging
        return jsonify({
            'error': f'Error fetching modal',
            'details': error_msg,
            'modal_key': modal_key
        }), 500

@app.route('/api/modals/test', methods=['GET'])
def test_modals():
    """Test endpoint to check if modals table is accessible"""
    if not supabase:
        return jsonify({'error': 'Database not configured'}), 503

    try:
        print("[MODAL TEST] Attempting to query modals table...")
        response = supabase.table('modals').select('modal_key').execute()

        print(f"[MODAL TEST] Response data: {response.data}")
        print(f"[MODAL TEST] Response count: {len(response.data) if response.data else 0}")

        return jsonify({
            'success': True,
            'message': 'Modals table is accessible',
            'modals': response.data if response.data else []
        })
    except Exception as e:
        error_msg = str(e)
        print(f"[MODAL TEST] Error accessing modals table: {error_msg}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': 'Error accessing modals table',
            'details': error_msg
        }), 500

@app.route('/api/modals/init', methods=['POST'])
def init_modals():
    """Initialize modals table with seed data (admin endpoint)"""
    if not supabase:
        return jsonify({'error': 'Database not configured'}), 503

    try:
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

        if response.data:
            return jsonify({
                'success': True,
                'message': 'Modals initialized successfully',
                'data': response.data
            })
        else:
            return jsonify({'error': 'Failed to initialize modals'}), 500

    except Exception as e:
        print(f"Error initializing modals: {str(e)}")
        return jsonify({'error': f'Error initializing modals: {str(e)}'}), 500

# ============================================================================
# PORTFOLIO METRICS: Database-backed portfolio metrics tables
# ============================================================================
# New architecture: Portfolio metrics are stored in database and updated
# every 5 minutes by background job. This allows instant metric retrieval
# on login without expensive recalculation.

def calculate_portfolio_metrics_from_positions(positions):
    """
    Calculate portfolio metrics (value, invested, gain/loss, return %) from positions.

    Args:
        positions: List of position dicts with: ticker, shares, purchase_price, current_price

    Returns:
        dict with: total_value, total_invested, gain_loss, return_percentage
    """
    total_invested = 0
    total_value = 0

    for position in positions:
        shares = float(position.get('shares', 0))
        # Support both snake_case and camelCase field names
        purchase_price = float(position.get('purchasePrice') or position.get('purchase_price', 0))
        current_price = float(position.get('current_price') or position.get('currentPrice', purchase_price))

        position_invested = shares * purchase_price
        position_value = shares * current_price

        total_invested += position_invested
        total_value += position_value

    gain_loss = total_value - total_invested
    return_pct = (gain_loss / total_invested * 100) if total_invested > 0 else 0

    return {
        'total_value': total_value,
        'total_invested': total_invested,
        'gain_loss': gain_loss,
        'return_percentage': return_pct
    }


def store_portfolio_metrics(portfolio_id, metrics, updated_by='system'):
    """
    Store or update portfolio metrics in the database.

    Args:
        portfolio_id: UUID of portfolio
        metrics: dict with total_value, total_invested, gain_loss, return_percentage
        updated_by: 'system', 'user', or 'background'

    Returns:
        dict with stored metrics or None if failed
    """
    try:
        # Check if record exists
        existing = supabase.table('portfolio_metrics').select('id').eq(
            'portfolio_id', str(portfolio_id)
        ).execute()

        if existing.data and len(existing.data) > 0:
            # Update existing record
            _ = supabase.table('portfolio_metrics').update({
                'total_value': metrics['total_value'],
                'total_invested': metrics['total_invested'],
                'gain_loss': metrics['gain_loss'],
                'return_percentage': metrics['return_percentage'],
                'updated_by': updated_by,
                'last_updated': datetime.now().isoformat()
            }).eq('portfolio_id', str(portfolio_id)).execute()
        else:
            # Insert new record
            _ = supabase.table('portfolio_metrics').insert({
                'portfolio_id': str(portfolio_id),
                'total_value': metrics['total_value'],
                'total_invested': metrics['total_invested'],
                'gain_loss': metrics['gain_loss'],
                'return_percentage': metrics['return_percentage'],
                'updated_by': updated_by,
                'last_updated': datetime.now().isoformat()
            }).execute()

        print(f"[METRICS] Stored metrics for portfolio {portfolio_id}: {metrics['return_percentage']:.2f}%", flush=True)
        return metrics

    except Exception as e:
        print(f"[METRICS] Error storing metrics for portfolio {portfolio_id}: {e}", flush=True)
        return None


def calculate_and_store_user_aggregate_metrics(user_id):
    """
    Calculate and store aggregated metrics across all user's portfolios.

    Args:
        user_id: UUID of user

    Returns:
        dict with aggregated metrics
    """
    try:
        # Get all portfolio metrics for this user
        portfolios_response = supabase.table('portfolios').select(
            'id, portfolio_name, positions'
        ).eq('user_id', str(user_id)).execute()

        if not portfolios_response.data:
            return None

        total_value = 0
        total_invested = 0

        # Sum up metrics from all portfolios
        for portfolio in portfolios_response.data:
            try:
                # Get stored metrics for this portfolio
                metrics_response = supabase.table('portfolio_metrics').select(
                    'total_value, total_invested'
                ).eq('portfolio_id', str(portfolio['id'])).execute()

                if metrics_response.data and len(metrics_response.data) > 0:
                    metric = metrics_response.data[0]
                    total_value += float(metric['total_value'])
                    total_invested += float(metric['total_invested'])

            except Exception as e:
                print(f"[METRICS] Error aggregating metrics for portfolio {portfolio['id']}: {e}", flush=True)

        gain_loss = total_value - total_invested
        aggregate_return = (gain_loss / total_invested * 100) if total_invested > 0 else 0

        aggregated = {
            'total_value_all_portfolios': total_value,
            'total_invested_all_portfolios': total_invested,
            'gain_loss_all_portfolios': gain_loss,
            'aggregate_return_percentage': aggregate_return,
            'portfolio_count': len(portfolios_response.data)
        }

        # Store or update user aggregate metrics
        existing = supabase.table('user_aggregate_metrics').select('id').eq(
            'user_id', str(user_id)
        ).execute()

        if existing.data and len(existing.data) > 0:
            supabase.table('user_aggregate_metrics').update({
                **aggregated,
                'last_updated': datetime.now().isoformat()
            }).eq('user_id', str(user_id)).execute()
        else:
            supabase.table('user_aggregate_metrics').insert({
                'user_id': str(user_id),
                **aggregated,
                'last_updated': datetime.now().isoformat()
            }).execute()

        print(f"[METRICS] Updated aggregate metrics for user {user_id}: {aggregate_return:.2f}% ({len(portfolios_response.data)} portfolios)", flush=True)
        return aggregated

    except Exception as e:
        print(f"[METRICS] Error calculating aggregate metrics for user {user_id}: {e}", flush=True)
        return None


@app.route('/api/portfolios/metrics', methods=['POST'])
def get_cached_portfolio_metrics():
    """
    FAST endpoint: Get cached portfolio metrics from database.
    Called on login to populate overview page instantly.
    No price fetches, no calculations - just reads from database.

    Response:
        {
            success: true,
            portfolios: [
                {
                    id, name, return_percentage, total_value, total_invested, gain_loss, last_updated
                }
            ],
            user_aggregate: {
                total_value_all_portfolios, total_invested_all_portfolios, aggregate_return_percentage
            }
        }
    """
    token = request.cookies.get('session_token')
    if not token:
        return jsonify({'error': 'Not authenticated'}), 401

    session = validate_session_token(token)
    if not session:
        return jsonify({'error': 'Session expired'}), 401

    user_id = session['user_id']
    print(f"[METRICS] Fetching cached metrics for user {user_id}", flush=True)

    try:
        # Get all portfolios for user
        portfolios_response = supabase.table('portfolios').select(
            'id, portfolio_name, is_default, positions'
        ).eq('user_id', str(user_id)).execute()

        if not portfolios_response.data:
            return jsonify({'success': True, 'portfolios': [], 'user_aggregate': None})

        # Get cached metrics for each portfolio
        portfolio_metrics_list = []

        for portfolio in portfolios_response.data:
            # Try to get cached metrics
            metrics_response = supabase.table('portfolio_metrics').select(
                '*'
            ).eq('portfolio_id', str(portfolio['id'])).execute()

            if metrics_response.data and len(metrics_response.data) > 0:
                metric = metrics_response.data[0]
                portfolio_metrics_list.append({
                    'id': str(portfolio['id']),
                    'name': portfolio['portfolio_name'],
                    'is_default': portfolio.get('is_default', False),
                    'positions_count': len(portfolio.get('positions', [])),
                    'total_value': float(metric['total_value']),
                    'total_invested': float(metric['total_invested']),
                    'gain_loss': float(metric['gain_loss']),
                    'return_percentage': float(metric['return_percentage']),
                    'last_updated': metric['last_updated']
                })
            else:
                # No cached metrics yet - return zeros
                portfolio_metrics_list.append({
                    'id': str(portfolio['id']),
                    'name': portfolio['portfolio_name'],
                    'is_default': portfolio.get('is_default', False),
                    'positions_count': len(portfolio.get('positions', [])),
                    'total_value': 0,
                    'total_invested': 0,
                    'gain_loss': 0,
                    'return_percentage': 0,
                    'last_updated': None
                })

        # Get user aggregate metrics
        user_agg_response = supabase.table('user_aggregate_metrics').select(
            '*'
        ).eq('user_id', str(user_id)).execute()

        user_aggregate = None
        if user_agg_response.data and len(user_agg_response.data) > 0:
            agg = user_agg_response.data[0]
            user_aggregate = {
                'total_value_all_portfolios': float(agg['total_value_all_portfolios']),
                'total_invested_all_portfolios': float(agg['total_invested_all_portfolios']),
                'gain_loss_all_portfolios': float(agg['gain_loss_all_portfolios']),
                'aggregate_return_percentage': float(agg['aggregate_return_percentage']),
                'last_updated': agg['last_updated']
            }

        print(f"[METRICS] Returning metrics for {len(portfolio_metrics_list)} portfolios", flush=True)
        return jsonify({
            'success': True,
            'portfolios': portfolio_metrics_list,
            'user_aggregate': user_aggregate
        })

    except Exception as e:
        print(f"[METRICS] Error fetching metrics: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to fetch metrics'}), 500


@app.route('/api/background/update-portfolio-metrics', methods=['POST'])
def background_update_portfolio_metrics():
    """
    Background job endpoint: Update all portfolio metrics from live prices.
    Called every 5 minutes to refresh portfolio metrics in database.

    Request body (optional):
        {
            "user_id": "optional - update only one user, otherwise update all"
        }

    Response:
        {
            success: true,
            updated_count: number of portfolios updated,
            failed_count: number of failures
        }
    """
    print(f"\n[BACKGROUND_METRICS] Starting background metrics update job", flush=True)

    updated_count = 0
    failed_count = 0

    try:
        # Get list of users to update (get unique user_ids from portfolios table)
        request_data = request.get_json() or {}
        specific_user_id = request_data.get('user_id')

        if specific_user_id:
            # Update specific user's portfolios
            users_to_process = [str(specific_user_id)]
        else:
            # Get all unique user_ids from portfolios table
            all_portfolios = supabase.table('portfolios').select('user_id').execute()
            # Extract unique user_ids
            user_ids = set()
            for portfolio in all_portfolios.data:
                user_ids.add(portfolio['user_id'])
            users_to_process = list(user_ids)

        print(f"[BACKGROUND_METRICS] Processing {len(users_to_process)} users", flush=True)

        for user_id in users_to_process:

            try:
                # Get all portfolios for this user
                portfolios_response = supabase.table('portfolios').select(
                    'id, portfolio_name, positions'
                ).eq('user_id', str(user_id)).execute()

                if not portfolios_response.data:
                    continue

                # Collect all unique tickers
                all_tickers = set()
                for portfolio in portfolios_response.data:
                    positions = portfolio.get('positions', [])
                    for position in positions:
                        ticker = position.get('ticker', '').upper()
                        if ticker:
                            all_tickers.add(ticker)

                print(f"[BACKGROUND_METRICS] User {user_id}: {len(portfolios_response.data)} portfolios, {len(all_tickers)} unique tickers", flush=True)

                # Batch fetch prices for all tickers
                price_cache = {}
                batch_size = 20
                ticker_list = list(all_tickers)

                for i in range(0, len(ticker_list), batch_size):
                    batch = ticker_list[i:i+batch_size]

                    import concurrent.futures
                    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                        futures = {
                            executor.submit(fetch_current_price_for_ticker, ticker): ticker
                            for ticker in batch
                        }
                        for future in concurrent.futures.as_completed(futures):
                            ticker = futures[future]
                            try:
                                price = future.result()
                                price_cache[ticker] = price
                            except Exception as e:
                                print(f"[BACKGROUND_METRICS] Error fetching {ticker}: {e}", flush=True)
                                price_cache[ticker] = 0.0

                # Update metrics for each portfolio
                for portfolio in portfolios_response.data:
                    try:
                        positions = portfolio.get('positions', [])

                        # Enrich positions with current prices
                        enriched_positions = []
                        for position in positions:
                            ticker = position.get('ticker', '').upper()
                            if ticker:
                                enriched_pos = position.copy()
                                enriched_pos['current_price'] = price_cache.get(ticker, position.get('purchase_price', 0))
                                enriched_positions.append(enriched_pos)

                        # Calculate metrics
                        metrics = calculate_portfolio_metrics_from_positions(enriched_positions)

                        # Store in database
                        store_portfolio_metrics(portfolio['id'], metrics, updated_by='background')
                        updated_count += 1

                    except Exception as e:
                        print(f"[BACKGROUND_METRICS] Error updating portfolio {portfolio['id']}: {e}", flush=True)
                        failed_count += 1

                # Update user aggregate metrics
                calculate_and_store_user_aggregate_metrics(user_id)

            except Exception as e:
                print(f"[BACKGROUND_METRICS] Error processing user {user_id}: {e}", flush=True)
                failed_count += 1

        print(f"[BACKGROUND_METRICS] Job complete: {updated_count} updated, {failed_count} failed", flush=True)
        return jsonify({
            'success': True,
            'updated_count': updated_count,
            'failed_count': failed_count
        })

    except Exception as e:
        print(f"[BACKGROUND_METRICS] Job failed: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Background job failed'}), 500


@app.route('/api/admin/init-portfolio-metrics', methods=['POST'])
def init_portfolio_metrics():
    """
    Initialize portfolio metrics for all existing portfolios.
    Called once on first setup to populate empty metrics tables.
    """
    print(f"\n[INIT] Initializing portfolio metrics from existing portfolios...", flush=True)

    try:
        # Get all portfolios
        portfolios_response = supabase.table('portfolios').select(
            'id, user_id, portfolio_name, positions'
        ).execute()

        if not portfolios_response.data:
            return jsonify({'success': True, 'message': 'No portfolios found'})

        print(f"[INIT] Found {len(portfolios_response.data)} portfolios", flush=True)

        # Collect all unique tickers
        all_tickers = set()
        for portfolio in portfolios_response.data:
            positions = portfolio.get('positions', [])
            for position in positions:
                ticker = position.get('ticker', '').upper()
                if ticker:
                    all_tickers.add(ticker)

        print(f"[INIT] Collected {len(all_tickers)} unique tickers", flush=True)

        # Batch fetch prices
        price_cache = {}
        batch_size = 20
        ticker_list = list(all_tickers)

        for i in range(0, len(ticker_list), batch_size):
            batch = ticker_list[i:i+batch_size]
            batch_num = (i // batch_size) + 1
            total_batches = (len(ticker_list) + batch_size - 1) // batch_size
            print(f"[INIT] Fetching prices batch {batch_num}/{total_batches}", flush=True)

            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                futures = {
                    executor.submit(fetch_current_price_for_ticker, ticker): ticker
                    for ticker in batch
                }
                for future in concurrent.futures.as_completed(futures):
                    ticker = futures[future]
                    try:
                        price = future.result()
                        price_cache[ticker] = price
                    except Exception as e:
                        print(f"[INIT] Error fetching {ticker}: {e}", flush=True)
                        price_cache[ticker] = 0.0

        print(f"[INIT] Price cache populated: {len(price_cache)} tickers", flush=True)

        # Process portfolios
        portfolios_by_user = {}
        metrics_created = 0

        for portfolio in portfolios_response.data:
            user_id = portfolio['user_id']
            if user_id not in portfolios_by_user:
                portfolios_by_user[user_id] = []
            portfolios_by_user[user_id].append(portfolio)

            # Calculate metrics
            positions = portfolio.get('positions', [])
            enriched_positions = []

            for position in positions:
                ticker = position.get('ticker', '').upper()
                if ticker:
                    enriched_pos = position.copy()
                    enriched_pos['current_price'] = price_cache.get(ticker, position.get('purchase_price', 0))
                    enriched_positions.append(enriched_pos)

            # Store metrics
            metrics = calculate_portfolio_metrics_from_positions(enriched_positions)
            store_portfolio_metrics(portfolio['id'], metrics, updated_by='init')
            metrics_created += 1

        # Create aggregates for each user
        aggregates_created = 0
        for user_id in portfolios_by_user.keys():
            calculate_and_store_user_aggregate_metrics(user_id)
            aggregates_created += 1

        print(f"[INIT] ✓ Success: {metrics_created} portfolio metrics, {aggregates_created} user aggregates", flush=True)
        return jsonify({
            'success': True,
            'portfolios_initialized': metrics_created,
            'users_initialized': aggregates_created,
            'message': 'Portfolio metrics initialized successfully'
        })

    except Exception as e:
        print(f"[INIT] Error: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Failed to initialize metrics', 'details': str(e)}), 500


@app.route('/api/debug/position-structure', methods=['GET'])
def debug_position_structure():
    """
    Debug endpoint: Show the actual position structure from database.
    Helps identify field names for metrics calculation.
    """
    try:
        # Get first portfolio with positions
        portfolios_response = supabase.table('portfolios').select(
            'portfolio_name, positions'
        ).limit(1).execute()

        if not portfolios_response.data:
            return jsonify({'error': 'No portfolios found'})

        portfolio = portfolios_response.data[0]
        positions = portfolio.get('positions', [])

        if not positions:
            return jsonify({'error': 'No positions in portfolio', 'portfolio': portfolio['portfolio_name']})

        # Show first position
        first_position = positions[0]

        return jsonify({
            'portfolio_name': portfolio['portfolio_name'],
            'positions_count': len(positions),
            'first_position_fields': list(first_position.keys()),
            'first_position_data': first_position,
            'all_positions': positions
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    has_api_key = bool(FINNHUB_API_KEY)
    return jsonify({
        'status': 'ok',
        'api_key_configured': has_api_key
    })

if __name__ == '__main__':
    # Verify metrics tables exist on startup
    print("\n[STARTUP] Verifying portfolio metrics tables...")
    try:
        if supabase:
            # Try to query the portfolio_metrics table to see if it exists
            test_query = supabase.table('portfolio_metrics').select('id', count='exact').limit(1).execute()
            print("[STARTUP] ✓ Portfolio metrics tables verified")
        else:
            print("[STARTUP] ⚠️  Supabase not configured - metrics tables will not be available")
    except Exception as e:
        print(f"[STARTUP] ⚠️  Portfolio metrics tables may not exist yet")
        print(f"[STARTUP] Error: {str(e)[:100]}")
        print("[STARTUP] To create tables, run the SQL from supabase_migrations.sql in Supabase SQL editor")

    port = int(os.environ.get('PORT', 5001))
    print(f"\nStarting Flask server on http://0.0.0.0:{port}")
    print("API endpoint: /api/stock/{ticker}")
    if FINNHUB_API_KEY:
        print(f"Finnhub API key configured: {FINNHUB_API_KEY[:8]}...")
    app.run(host='0.0.0.0', port=port, debug=False)
