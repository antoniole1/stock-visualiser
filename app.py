from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import requests
from datetime import datetime, timedelta
import os
import time
import json
import hashlib
from pathlib import Path

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Get Finnhub API key from environment variable
FINNHUB_API_KEY = os.environ.get('FINNHUB_API_KEY', 'd4gdnt9r01qm5b354vmgd4gdnt9r01qm5b354vn0')

if not FINNHUB_API_KEY:
    print("\n" + "="*70)
    print("WARNING: FINNHUB_API_KEY environment variable not set!")
    print("Please get a free API key from: https://finnhub.io/")
    print("Then set it with: export FINNHUB_API_KEY='your_api_key_here'")
    print("="*70 + "\n")

FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

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
def hash_password(password):
    """Hash a 4-digit password"""
    return hashlib.sha256(password.encode()).hexdigest()

def get_portfolio_path(password):
    """Get the file path for a portfolio based on its password"""
    password_hash = hash_password(password)
    return PORTFOLIO_DIR / f"{password_hash}.json"

def load_portfolio(password):
    """Load a portfolio by password"""
    portfolio_path = get_portfolio_path(password)
    if not portfolio_path.exists():
        return None

    with open(portfolio_path, 'r') as f:
        return json.load(f)

def save_portfolio(password, portfolio_data):
    """Save a portfolio to disk"""
    portfolio_path = get_portfolio_path(password)
    portfolio_data['last_updated'] = datetime.now().isoformat()

    with open(portfolio_path, 'w') as f:
        json.dump(portfolio_data, f, indent=2)

    return True

# Frontend routes
@app.route('/')
def serve_index():
    """Serve the main index.html file"""
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static files (CSS, JS, etc.)"""
    if filename.startswith('api'):
        return None
    return send_from_directory('.', filename)

# Portfolio API routes
@app.route('/api/portfolio/create', methods=['POST'])
def create_portfolio():
    """Create a new portfolio"""
    data = request.json
    password = data.get('password')
    name = data.get('name')

    if not password or len(password) != 4 or not password.isdigit():
        return jsonify({
            'error': 'Password must be exactly 4 digits'
        }), 400

    if not name:
        return jsonify({
            'error': 'Portfolio name is required'
        }), 400

    # Check if portfolio already exists
    if load_portfolio(password):
        return jsonify({
            'error': 'A portfolio with this password already exists'
        }), 409

    # Create new portfolio
    portfolio_data = {
        'name': name,
        'password': password,  # Store for reference (will hash for filename)
        'positions': [],
        'created_at': datetime.now().isoformat()
    }

    save_portfolio(password, portfolio_data)

    return jsonify({
        'success': True,
        'message': 'Portfolio created successfully',
        'portfolio': {
            'name': name,
            'positions': []
        }
    })

@app.route('/api/portfolio/login', methods=['POST'])
def login_portfolio():
    """Load a portfolio by password"""
    data = request.json
    password = data.get('password')

    if not password or len(password) != 4 or not password.isdigit():
        return jsonify({
            'error': 'Password must be exactly 4 digits'
        }), 400

    portfolio = load_portfolio(password)

    if not portfolio:
        return jsonify({
            'error': 'Portfolio not found'
        }), 404

    # Return portfolio data (excluding password hash)
    return jsonify({
        'success': True,
        'portfolio': {
            'name': portfolio['name'],
            'positions': portfolio.get('positions', []),
            'created_at': portfolio.get('created_at'),
            'last_updated': portfolio.get('last_updated')
        }
    })

@app.route('/api/portfolio/save', methods=['POST'])
def save_portfolio_data():
    """Save/update portfolio positions"""
    data = request.json
    password = data.get('password')
    positions = data.get('positions')

    if not password or len(password) != 4 or not password.isdigit():
        return jsonify({
            'error': 'Password must be exactly 4 digits'
        }), 400

    portfolio = load_portfolio(password)

    if not portfolio:
        return jsonify({
            'error': 'Portfolio not found'
        }), 404

    # Update positions
    portfolio['positions'] = positions
    save_portfolio(password, portfolio)

    return jsonify({
        'success': True,
        'message': 'Portfolio saved successfully'
    })

@app.route('/api/stock/<ticker>', methods=['GET'])
def get_stock_data(ticker):
    if not FINNHUB_API_KEY:
        return jsonify({
            'error': 'Finnhub API key not configured. Please set FINNHUB_API_KEY environment variable.'
        }), 500

    try:
        ticker = ticker.upper()

        # Get current quote using Finnhub quote endpoint
        quote_params = {
            'symbol': ticker,
            'token': FINNHUB_API_KEY
        }
        quote_response = requests.get(f'{FINNHUB_BASE_URL}/quote', params=quote_params)

        if quote_response.status_code != 200:
            return jsonify({
                'error': f'Failed to fetch quote data: {quote_response.status_code}'
            }), quote_response.status_code

        quote_data = quote_response.json()

        # Check if valid response
        if 'c' not in quote_data or quote_data['c'] is None:
            return jsonify({
                'error': 'Invalid ticker symbol or data not available'
            }), 404

        current_price = float(quote_data.get('c', 0))  # Current price
        previous_close = float(quote_data.get('pc', 0))  # Previous close
        change_amount = float(quote_data.get('d', 0))  # Change amount
        change_percent = float(quote_data.get('dp', 0))  # Change percent

        if current_price == 0:
            return jsonify({
                'error': 'Invalid ticker symbol or data not available'
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
        return jsonify({
            'error': f'Network error: {str(e)}'
        }), 500
    except Exception as e:
        return jsonify({
            'error': f'Error fetching stock data: {str(e)}'
        }), 500

@app.route('/api/stock/<ticker>/history', methods=['GET'])
def get_stock_history(ticker):
    """
    Fetch historical daily prices for a ticker from a specific date to today.
    Query params:
        - from_date: Start date in YYYY-MM-DD format
        - to_date: End date in YYYY-MM-DD format (optional, defaults to today)
    """
    if not FINNHUB_API_KEY:
        return jsonify({
            'error': 'Finnhub API key not configured. Please set FINNHUB_API_KEY environment variable.'
        }), 500

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
            from_date = datetime.strptime(from_date_str, '%Y-%m-%d')
            if to_date_str:
                to_date = datetime.strptime(to_date_str, '%Y-%m-%d')
            else:
                to_date = datetime.now()
        except ValueError:
            return jsonify({
                'error': 'Invalid date format. Use YYYY-MM-DD'
            }), 400

        # Convert dates to Unix timestamps (Finnhub requires timestamps)
        from_timestamp = int(from_date.timestamp())
        to_timestamp = int(to_date.timestamp())

        # Fetch historical data using Finnhub candle endpoint
        params = {
            'symbol': ticker,
            'resolution': 'D',  # Daily resolution
            'from': from_timestamp,
            'to': to_timestamp,
            'token': FINNHUB_API_KEY
        }
        response = requests.get(f'{FINNHUB_BASE_URL}/stock/candle', params=params)

        if response.status_code == 403:
            return jsonify({
                'error': 'Historical data not available. Upgrade to Finnhub paid plan for detailed historical data.'
            }), 403
        elif response.status_code != 200:
            return jsonify({
                'error': f'Failed to fetch historical data: {response.status_code}'
            }), response.status_code

        data = response.json()

        # Check for API errors
        if data.get('s') == 'no_data':
            return jsonify({
                'error': 'No historical data available for this ticker'
            }), 404

        # Extract candle data
        closes = data.get('c', [])  # Close prices
        timestamps = data.get('t', [])  # Timestamps

        if not closes or not timestamps:
            return jsonify({
                'error': 'No historical data available for this ticker'
            }), 404

        # Format prices
        prices = []
        for timestamp, close_price in zip(timestamps, closes):
            date_str = datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d')
            prices.append({
                'date': date_str,
                'close': round(float(close_price), 2)
            })

        if not prices:
            return jsonify({
                'error': 'No data available for the specified date range'
            }), 404

        return jsonify({
            'ticker': ticker,
            'from_date': from_date_str,
            'to_date': to_date.strftime('%Y-%m-%d'),
            'prices': prices,
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
    Fetch news for a specific ticker from the past N days.
    Query params:
        - days: Number of days to look back (1, 2, 5, or 7)
    """
    if not FINNHUB_API_KEY:
        return jsonify({
            'error': 'Finnhub API key not configured. Please set FINNHUB_API_KEY environment variable.'
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

        # Fetch news from Finnhub
        params = {
            'symbol': ticker,
            'from': from_date,
            'to': to_date,
            'token': FINNHUB_API_KEY
        }

        response = requests.get(f'{FINNHUB_BASE_URL}/company-news', params=params)

        if response.status_code != 200:
            return jsonify({
                'error': f'Failed to fetch news: {response.status_code}'
            }), response.status_code

        data = response.json()

        # Ensure we have a list
        if not isinstance(data, list):
            data = []

        return jsonify({
            'ticker': ticker,
            'days': days,
            'from_date': from_date,
            'to_date': to_date,
            'news': data
        })

    except requests.exceptions.RequestException as e:
        return jsonify({
            'error': f'Network error: {str(e)}'
        }), 500
    except Exception as e:
        return jsonify({
            'error': f'Error fetching news: {str(e)}'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    has_api_key = bool(FINNHUB_API_KEY)
    return jsonify({
        'status': 'ok',
        'api_key_configured': has_api_key
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    print(f"Starting Flask server on http://0.0.0.0:{port}")
    print("API endpoint: /api/stock/{ticker}")
    if FINNHUB_API_KEY:
        print(f"Finnhub API key configured: {FINNHUB_API_KEY[:8]}...")
    app.run(host='0.0.0.0', port=port, debug=False)
