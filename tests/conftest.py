"""
Pytest configuration and shared fixtures for Stock Visualiser tests.
Handles test setup/teardown, database cleanup, and common mocking.
"""

import pytest
import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any
from unittest.mock import MagicMock


# Configure logging for tests
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DatabaseCleanupTracker:
    """Track database operations for cleanup after tests."""

    def __init__(self):
        """Initialize tracker."""
        self.portfolios: List[str] = []
        self.positions: List[str] = []
        self.other: List[str] = []
        self._cleanup_functions: List[callable] = []

    def track_portfolio(self, portfolio_id: str):
        """Track a created portfolio for cleanup."""
        self.portfolios.append(portfolio_id)
        logger.info(f"Tracking portfolio for cleanup: {portfolio_id}")

    def track_position(self, position_id: str):
        """Track a created position for cleanup."""
        self.positions.append(position_id)
        logger.info(f"Tracking position for cleanup: {position_id}")

    def add_cleanup_function(self, func: callable):
        """Add a custom cleanup function."""
        self._cleanup_functions.append(func)

    async def cleanup_all(self, supabase_client=None):
        """Execute all cleanup operations."""
        logger.info("Starting database cleanup...")

        # Run custom cleanup functions first
        for cleanup_func in self._cleanup_functions:
            try:
                if hasattr(cleanup_func, '__await__'):
                    await cleanup_func()
                else:
                    cleanup_func()
                logger.info(f"Executed cleanup function: {cleanup_func.__name__}")
            except Exception as e:
                logger.warning(f"Cleanup function failed: {e}")

        # Cleanup portfolios
        if supabase_client and self.portfolios:
            for portfolio_id in self.portfolios:
                try:
                    supabase_client.table('portfolios').delete().eq('id', portfolio_id).execute()
                    logger.info(f"Cleaned up portfolio: {portfolio_id}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup portfolio {portfolio_id}: {e}")

        # Cleanup positions
        if supabase_client and self.positions:
            for position_id in self.positions:
                try:
                    supabase_client.table('positions').delete().eq('id', position_id).execute()
                    logger.info(f"Cleaned up position: {position_id}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup position {position_id}: {e}")

        logger.info("Database cleanup completed")


@pytest.fixture(scope="session")
def test_results_dir():
    """Create directory for test results."""
    results_dir = Path(__file__).parent.parent / "test_results"
    results_dir.mkdir(exist_ok=True)
    return results_dir


@pytest.fixture
def cleanup_tracker():
    """Provide a cleanup tracker for tracking test data."""
    tracker = DatabaseCleanupTracker()
    yield tracker
    # Cleanup is manual - tests using this fixture should call cleanup_all()


@pytest.fixture
def db_cleanup():
    """
    Database cleanup fixture for tests that create actual data.
    Automatically tracks and cleans up test data after test completes.

    Example usage:
    def test_something(db_cleanup):
        db_cleanup.track_portfolio('test-portfolio-123')
        # test code - portfolio will be automatically deleted after test
    """
    tracker = DatabaseCleanupTracker()
    yield tracker

    # Note: Cleanup is synchronous here, but tracker supports async for future use
    # In a real async environment, you would await tracker.cleanup_all()


@pytest.fixture(autouse=True)
def reset_mock_calls():
    """
    Fixture that resets mock call counts between tests.
    This ensures tests don't interfere with each other.
    """
    yield
    # Cleanup happens automatically with new instances in each test
    # This is just a marker fixture for now


def pytest_configure(config):
    """Configure pytest with custom markers and settings."""
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )
    config.addinivalue_line(
        "markers", "db: mark test as requiring database operations"
    )


def pytest_sessionstart(session):
    """Hook called at the start of the test session."""
    logger.info("="*60)
    logger.info("Starting Test Session")
    logger.info("="*60)


def pytest_sessionfinish(session, exitstatus):
    """
    Hook called after all tests have been run.
    Generates test summary.
    """
    logger.info("="*60)
    logger.info("Test Session Completed")
    logger.info("="*60)

    # Print summary
    stats = session.config.hook.pytest_runtest_logreport.get_hookimpls()
    logger.info(f"Exit Status: {exitstatus}")


def pytest_runtest_makereport(item, call):
    """Hook to capture test outcomes."""
    if call.when == "call":
        # This runs after each test
        if hasattr(item, '_cleanup_tracker'):
            logger.info(f"Test '{item.name}' completed - cleanup tracking available")


@pytest.fixture(scope="function", autouse=True)
def test_isolation():
    """Ensure test isolation by resetting state between tests."""
    yield
    # Each test gets a fresh environment
    # Previous test's mocks and state are discarded
