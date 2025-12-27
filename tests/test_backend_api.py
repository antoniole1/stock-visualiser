"""
Unit tests for Stock Visualiser backend API endpoints.
Tests critical functionality including float conversion fixes.
"""

import pytest
import json
from unittest.mock import patch, MagicMock
import sys
import os

# Add parent directory to path to import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app


@pytest.fixture
def client():
    """Create a test client for the Flask app."""
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def mock_supabase():
    """Mock Supabase for testing without database."""
    with patch('app.supabase') as mock:
        yield mock


class TestStockPriceEndpoints:
    """Test suite for stock price endpoints."""

    @patch('app.requests.get')
    def test_stock_quote_with_valid_price(self, mock_get, client, mock_supabase):
        """Test /api/stock/<ticker> with valid Finnhub response."""
        # Mock Finnhub quote response
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 150.50,  # Current price
            'pc': 149.00,  # Previous close
            'd': 1.50,    # Change amount
            'dp': 1.01    # Change percent
        }

        # Mock profile response
        mock_profile = MagicMock()
        mock_profile.status_code = 200
        mock_profile.json.return_value = {
            'name': 'Apple Inc.',
            'marketCapitalization': 3000000
        }

        mock_get.side_effect = [mock_quote, mock_profile]

        response = client.get('/api/stock/AAPL')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['ticker'] == 'AAPL'
        assert data['current_price'] == 150.50
        assert data['company_name'] == 'Apple Inc.'
        assert data['change_amount'] == 1.50
        assert data['change_percent'] == 1.01

    @patch('app.requests.get')
    def test_stock_quote_with_none_price(self, mock_get, client, mock_supabase):
        """Test /api/stock/<ticker> handles None price (invalid ticker)."""
        # Mock Finnhub response with None price
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': None,  # No price data
            'pc': None,
            'd': None,
            'dp': None
        }

        mock_get.return_value = mock_quote

        response = client.get('/api/stock/INVALID')
        assert response.status_code == 404

        data = json.loads(response.data)
        assert 'error' in data

    @patch('app.requests.get')
    def test_stock_quote_with_missing_optional_fields(self, mock_get, client, mock_supabase):
        """Test /api/stock/<ticker> handles missing optional fields gracefully."""
        # Mock Finnhub response with only required field
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 150.50,  # Required
            'pc': None,   # Optional - should use current_price as fallback
            'd': None,    # Optional - should default to 0
            'dp': None    # Optional - should default to 0
        }

        # Mock profile response
        mock_profile = MagicMock()
        mock_profile.status_code = 200
        mock_profile.json.return_value = {'name': 'Test Company'}

        mock_get.side_effect = [mock_quote, mock_profile]

        response = client.get('/api/stock/TEST')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['current_price'] == 150.50
        assert data['previous_close'] == 150.50  # Fallback to current price
        assert data['change_amount'] == 0.0      # Default fallback
        assert data['change_percent'] == 0.0     # Default fallback

    @patch('app.requests.get')
    def test_stock_instant_with_valid_response(self, mock_get, client, mock_supabase):
        """Test /api/stock/<ticker>/instant with valid response."""
        # Mock Finnhub quote response
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 200.75,
            'pc': 200.00,
            'd': 0.75,
            'dp': 0.375
        }

        # Mock profile response
        mock_profile = MagicMock()
        mock_profile.status_code = 200
        mock_profile.json.return_value = {'name': 'Test Stock'}

        mock_get.side_effect = [mock_quote, mock_profile]

        response = client.get('/api/stock/TEST/instant')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['current_price'] == 200.75
        assert data['company_name'] == 'Test Stock'

    @patch('app.requests.get')
    def test_stock_instant_with_none_price(self, mock_get, client, mock_supabase):
        """Test /api/stock/<ticker>/instant handles None price."""
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': None,
            'pc': None,
            'd': None,
            'dp': None
        }

        mock_get.return_value = mock_quote

        response = client.get('/api/stock/INVALID/instant')
        assert response.status_code == 200

        data = json.loads(response.data)
        # Should still return response but current_price should be None
        assert data['current_price'] is None


class TestFloatConversionSafety:
    """Test suite for float conversion error handling."""

    @patch('app.requests.get')
    def test_no_float_conversion_error_on_none_values(self, mock_get, client, mock_supabase):
        """Test that None values don't cause 'float() argument must be a string or a number' errors."""
        # This tests the fix for the SDR ticker issue
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 45.00,   # Valid price
            'pc': None,   # None value that previously caused error
            'd': None,
            'dp': None
        }

        mock_profile = MagicMock()
        mock_profile.status_code = 200
        mock_profile.json.return_value = {'name': 'Test'}

        mock_get.side_effect = [mock_quote, mock_profile]

        # Should not raise an error
        response = client.get('/api/stock/SDR')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['current_price'] == 45.00
        assert data['previous_close'] == 45.00  # Fallback applied
        assert data['change_amount'] == 0.0
        assert data['change_percent'] == 0.0

    @patch('app.requests.get')
    def test_invalid_numeric_string_handled(self, mock_get, client, mock_supabase):
        """Test that invalid numeric strings are handled gracefully."""
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 'invalid',  # Invalid value
            'pc': None,
            'd': None,
            'dp': None
        }

        mock_get.return_value = mock_quote

        response = client.get('/api/stock/BAD')
        # Should return error, not crash
        assert response.status_code in [400, 404]

        data = json.loads(response.data)
        assert 'error' in data


class TestPortfolioEndpoints:
    """Test suite for portfolio management endpoints."""

    @patch('app.supabase')
    def test_portfolio_save_with_positions(self, mock_supabase, client):
        """Test saving portfolio with positions."""
        # Mock successful save
        mock_supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock()

        response = client.post(
            '/api/portfolio/save',
            json={
                'positions': [
                    {
                        'ticker': 'AAPL',
                        'shares': 10,
                        'purchasePrice': 150.00,
                        'purchaseDate': '2024-01-01'
                    }
                ],
                'portfolio_id': 'test-portfolio-id',
                'cached_return_percentage': 5.5
            },
            headers={'Content-Type': 'application/json'}
        )

        # Endpoint should handle the request (actual DB behavior depends on auth)
        assert response.status_code in [200, 401]  # 200 if authed, 401 if not


class TestErrorHandling:
    """Test suite for error handling and edge cases."""

    def test_invalid_json_request(self, client):
        """Test API handles invalid JSON gracefully."""
        response = client.post(
            '/api/portfolio/save',
            data='invalid json',
            headers={'Content-Type': 'application/json'}
        )

        # Should handle gracefully
        assert response.status_code in [400, 401, 500]

    @patch('app.requests.get')
    def test_network_timeout_handling(self, mock_get, client, mock_supabase):
        """Test handling of network timeouts."""
        import requests
        mock_get.side_effect = requests.exceptions.Timeout('Request timeout')

        response = client.get('/api/stock/AAPL')
        # Should handle gracefully
        assert response.status_code == 500

        data = json.loads(response.data)
        assert 'error' in data


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
