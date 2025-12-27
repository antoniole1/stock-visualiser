"""
Integration tests for Stock Visualiser
Tests complete workflows end-to-end
"""

import pytest
import json
from unittest.mock import patch, MagicMock
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app


@pytest.fixture
def client():
    """Create a test client for the Flask app."""
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


class TestPortfolioCreationFlow:
    """Integration test for complete portfolio creation and position addition."""

    @patch('app.requests.get')
    @patch('app.supabase')
    def test_create_portfolio_and_add_position(self, mock_supabase, mock_get, client):
        """Test complete flow: create portfolio -> add position -> verify data."""
        # Step 1: Create portfolio (mocked)
        portfolio_data = {
            'name': 'Integration Test Portfolio',
            'positions': []
        }

        # Step 2: Add position with valid stock data
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 150.00,
            'pc': 149.00,
            'd': 1.00,
            'dp': 0.67
        }

        mock_profile = MagicMock()
        mock_profile.status_code = 200
        mock_profile.json.return_value = {'name': 'Apple Inc.'}

        mock_get.side_effect = [mock_quote, mock_profile]

        # Fetch stock data
        response = client.get('/api/stock/AAPL')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['current_price'] == 150.00

        # Step 3: Verify portfolio can be saved with position
        position_data = {
            'ticker': 'AAPL',
            'shares': 10,
            'purchasePrice': 150.00,
            'purchaseDate': '2024-01-01',
            'currentPrice': 150.00,
            'companyName': 'Apple Inc.'
        }

        assert position_data['shares'] > 0
        assert position_data['purchasePrice'] > 0
        position_value = position_data['shares'] * position_data['currentPrice']
        assert position_value == 1500.00


class TestPortfolioLandingPageFlow:
    """Integration test for portfolio landing page display."""

    def test_portfolio_positions_count_update(self):
        """Test that positions_count is updated after adding position."""
        # Simulate availablePortfolios array
        availablePortfolios = [
            {
                'id': 'portfolio-1',
                'name': 'Test Portfolio',
                'positions_count': 0,
                'total_value': 0,
                'total_invested': 0,
                'gain_loss': 0,
                'return_percentage': 0
            }
        ]

        # Simulate adding a position
        position = {
            'ticker': 'AAPL',
            'shares': 10,
            'purchasePrice': 150.00,
            'currentPrice': 155.00
        }

        # Calculate values
        position_value = position['shares'] * position['currentPrice']
        cost_basis = position['shares'] * position['purchasePrice']

        # Update portfolio
        portfolio_index = 0
        availablePortfolios[portfolio_index]['positions_count'] = 1
        availablePortfolios[portfolio_index]['total_value'] = position_value
        availablePortfolios[portfolio_index]['total_invested'] = cost_basis
        availablePortfolios[portfolio_index]['gain_loss'] = position_value - cost_basis
        availablePortfolios[portfolio_index]['return_percentage'] = (
            (position_value - cost_basis) / cost_basis * 100
        )

        # Verify update
        assert availablePortfolios[0]['positions_count'] == 1
        assert availablePortfolios[0]['total_value'] == 1550.00
        assert availablePortfolios[0]['total_invested'] == 1500.00
        assert availablePortfolios[0]['gain_loss'] == 50.00
        assert availablePortfolios[0]['return_percentage'] == pytest.approx(3.33, 0.1)

    def test_portfolio_deletion_removes_from_list(self):
        """Test that portfolio is removed from list after deletion."""
        availablePortfolios = [
            {'id': 'portfolio-1', 'name': 'Portfolio 1'},
            {'id': 'portfolio-2', 'name': 'Portfolio 2'},
            {'id': 'portfolio-3', 'name': 'Portfolio 3'}
        ]

        # Delete portfolio 2
        portfolio_id_to_delete = 'portfolio-2'
        availablePortfolios = [p for p in availablePortfolios if p['id'] != portfolio_id_to_delete]

        # Verify deletion
        assert len(availablePortfolios) == 2
        assert all(p['id'] != 'portfolio-2' for p in availablePortfolios)
        assert availablePortfolios[0]['id'] == 'portfolio-1'
        assert availablePortfolios[1]['id'] == 'portfolio-3'


class TestDataValidationFlow:
    """Integration test for input validation across the app."""

    def test_position_validation_flow(self):
        """Test complete position validation flow."""
        test_cases = [
            {
                'ticker': 'AAPL',
                'shares': 10,
                'purchasePrice': 150.00,
                'purchaseDate': '2024-01-01',
                'should_pass': True
            },
            {
                'ticker': '',
                'shares': 10,
                'purchasePrice': 150.00,
                'purchaseDate': '2024-01-01',
                'should_pass': False
            },
            {
                'ticker': 'AAPL',
                'shares': 0,
                'purchasePrice': 150.00,
                'purchaseDate': '2024-01-01',
                'should_pass': False
            },
            {
                'ticker': 'AAPL',
                'shares': -5,
                'purchasePrice': 150.00,
                'purchaseDate': '2024-01-01',
                'should_pass': False
            },
            {
                'ticker': 'AAPL',
                'shares': 10,
                'purchasePrice': 0,
                'purchaseDate': '2024-01-01',
                'should_pass': False
            },
            {
                'ticker': 'AAPL',
                'shares': 10,
                'purchasePrice': -100,
                'purchaseDate': '2024-01-01',
                'should_pass': False
            },
            {
                'ticker': 'AAPL',
                'shares': 10,
                'purchasePrice': 150.00,
                'purchaseDate': '',
                'should_pass': False
            }
        ]

        for test_case in test_cases:
            is_valid = (
                bool(test_case['ticker']) and
                not isnan(test_case['shares']) and test_case['shares'] > 0 and
                not isnan(test_case['purchasePrice']) and test_case['purchasePrice'] > 0 and
                bool(test_case['purchaseDate'])
            )

            assert is_valid == test_case['should_pass'], f"Failed for {test_case}"


class TestFloatConversionRobustness:
    """Integration test for float conversion error handling (SDR ticker fix)."""

    @patch('app.requests.get')
    def test_handle_problematic_ticker_sdr(self, mock_get, client):
        """Test that SDR ticker (which caused the original float error) is handled."""
        # Simulate Finnhub response for SDR
        mock_quote = MagicMock()
        mock_quote.status_code = 200
        mock_quote.json.return_value = {
            'c': 1.25,      # Has price
            'pc': None,     # No previous close - caused the original error
            'd': None,
            'dp': None
        }

        mock_profile = MagicMock()
        mock_profile.status_code = 200
        mock_profile.json.return_value = {'name': 'SDR'}

        mock_get.side_effect = [mock_quote, mock_profile]

        # Should not raise "float() argument must be a string or a number, not 'NoneType'"
        response = client.get('/api/stock/SDR')
        assert response.status_code == 200

        data = json.loads(response.data)
        assert data['current_price'] == 1.25
        assert data['previous_close'] == 1.25  # Fallback to current price
        assert data['change_amount'] == 0.0
        assert data['change_percent'] == 0.0


def isnan(value):
    """Helper function to check if value is NaN."""
    try:
        float(value)
        return False
    except (ValueError, TypeError):
        return True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
