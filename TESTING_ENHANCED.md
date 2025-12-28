# Enhanced Testing Guide

This document explains the new testing features for visual test reports and automatic test data cleanup.

## Quick Start

### Run Enhanced Test Suite with Visual Reports

```bash
./run_tests_enhanced.sh
```

This will:
1. Run all unit tests with detailed HTML reports
2. Run integration tests with HTML reports
3. Generate code coverage analysis
4. Create a visual test dashboard
5. Automatically clean up all test data

### View Test Results

After running tests, view the generated reports:

```bash
# View coverage report
open test_results/coverage/index.html

# View test dashboard
open test_results/test_report.html

# View specific test results
open test_results/test_backend_api.html
open test_results/test_integration.html
```

## Features

### 1. Visual Test Dashboard

A beautiful HTML dashboard showing:
- **Summary Statistics**: Total tests, passed, failed, skipped counts
- **Pass Rate**: Visual progress bar showing pass rate percentage
- **Individual Test Results**: Table with status, duration, and error messages
- **Color-coded Status**: Green for passed, red for failed, yellow for skipped
- **Test Duration**: See which tests are slow

The dashboard is generated automatically and stored at `test_results/test_report.html`.

### 2. Automatic Test Data Cleanup

Tests that create data in the database are automatically tracked and cleaned up.

#### For Mocked Tests (Current Setup)

Your tests are currently using mocks, so no real database cleanup is needed. The cleanup infrastructure is in place for when you transition to real database tests.

#### For Real Database Tests (Future)

When you add tests that interact with a real database, use the `db_cleanup` fixture:

```python
def test_create_portfolio(db_cleanup):
    """Test that creates a portfolio in the database."""
    # Create portfolio
    portfolio_id = create_portfolio("My Portfolio")

    # Track it for cleanup
    db_cleanup.track_portfolio(portfolio_id)

    # Your test code
    assert portfolio_exists(portfolio_id)

    # Cleanup happens automatically after test completes
```

#### Multiple Records

Track multiple records created during a test:

```python
def test_create_multiple_positions(db_cleanup):
    """Test that creates multiple positions."""
    portfolio_id = create_portfolio("Test Portfolio")
    db_cleanup.track_portfolio(portfolio_id)

    # Create positions
    pos1_id = create_position(portfolio_id, "AAPL", 10, 150.00)
    pos2_id = create_position(portfolio_id, "GOOGL", 5, 2800.00)

    db_cleanup.track_position(pos1_id)
    db_cleanup.track_position(pos2_id)

    # Test code
    assert position_count(portfolio_id) == 2

    # All positions and portfolio are cleaned up automatically
```

#### Custom Cleanup Functions

For complex cleanup scenarios, use custom cleanup functions:

```python
def test_with_custom_cleanup(db_cleanup):
    """Test with custom cleanup logic."""
    # Create some data
    some_data = create_something()

    # Add custom cleanup
    db_cleanup.add_cleanup_function(lambda: delete_something(some_data))

    # Test code
    assert something_exists(some_data)

    # Your custom function is called during cleanup
```

## Configuration

### Pytest Fixtures

The enhanced testing setup provides these fixtures:

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `client` | Function | Flask test client |
| `mock_supabase` | Function | Mocked Supabase client |
| `db_cleanup` | Function | Database cleanup tracker |
| `cleanup_tracker` | Function | Manual cleanup tracker |
| `test_results_dir` | Session | Test results directory |
| `test_isolation` | Function | Ensures test isolation |

### Custom Pytest Markers

Mark your tests with these markers:

```python
import pytest

@pytest.mark.unit
def test_something():
    """Unit test marker."""
    pass

@pytest.mark.integration
def test_workflow():
    """Integration test marker."""
    pass

@pytest.mark.slow
def test_complex_operation():
    """Mark as slow test."""
    pass

@pytest.mark.db
def test_database_operation(db_cleanup):
    """Mark as database test."""
    pass
```

Run tests with specific markers:

```bash
# Run only unit tests
pytest -m unit

# Run only integration tests
pytest -m integration

# Run all except slow tests
pytest -m "not slow"

# Run only database tests
pytest -m db
```

## Test Results Directory Structure

After running tests, `test_results/` contains:

```
test_results/
├── test_report.html              # Main visual dashboard
├── test_backend_api.html         # Backend unit test results
├── test_integration.html         # Integration test results
├── coverage/                     # Code coverage report
│   └── index.html
├── backend_unit_tests.log        # Raw test output logs
├── integration_tests.log
├── coverage.log
└── test_results.json             # Structured test data
```

## Advanced Usage

### Generate Coverage Reports

```bash
# Generate HTML coverage report
python -m pytest tests/ --cov=app --cov-report=html:test_results/coverage

# View coverage in browser
open test_results/coverage/index.html

# Coverage report in terminal
python -m pytest tests/ --cov=app --cov-report=term-missing
```

### Run Tests with Different Verbosity Levels

```bash
# Quiet mode
python -m pytest tests/ -q

# Verbose mode
python -m pytest tests/ -v

# Very verbose (shows print statements)
python -m pytest tests/ -vv -s
```

### Run Specific Tests

```bash
# Run single test file
python -m pytest tests/test_backend_api.py

# Run specific test class
python -m pytest tests/test_backend_api.py::TestStockPriceEndpoints

# Run specific test function
python -m pytest tests/test_backend_api.py::TestStockPriceEndpoints::test_stock_quote_with_valid_price

# Run tests matching a pattern
python -m pytest -k "float_conversion"
```

### Watch Mode (Requires pytest-watch)

```bash
# Install pytest-watch
pip install pytest-watch

# Watch for changes and rerun tests
ptw tests/
```

## Troubleshooting

### Issue: "pytest: command not found"

**Solution**: Install pytest:
```bash
pip install pytest pytest-cov pytest-html
```

### Issue: HTML reports not generating

**Solution**: Install pytest-html:
```bash
pip install pytest-html
```

### Issue: Tests creating data in real database not cleaning up

**Solution**: Make sure you're using the `db_cleanup` fixture:

```python
def test_something(db_cleanup):  # ← Add fixture
    # Track created records
    db_cleanup.track_portfolio(portfolio_id)
    # test code
```

### Issue: Mocks not being reset between tests

**Solution**: The `test_isolation` fixture ensures mocks are reset. If you need manual reset:

```python
from unittest.mock import patch

@patch('app.supabase')
def test_something(mock_supabase):
    # Each test gets a fresh mock
    pass
```

## CI/CD Integration

The enhanced test runner works with GitHub Actions. Update your workflow:

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      - run: pip install -r requirements.txt
      - run: ./run_tests_enhanced.sh
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-results
          path: test_results/
```

## Best Practices

1. **Use Fixtures**: Always use the `client` and `mock_supabase` fixtures
2. **Track Data**: Use `db_cleanup` when creating test data
3. **Mark Tests**: Use `@pytest.mark` to categorize tests
4. **Keep Tests Fast**: Mark slow tests with `@pytest.mark.slow`
5. **Mock External APIs**: Always mock external API calls
6. **Cleanup After Each Test**: Don't rely on cleanup between test runs
7. **Use Descriptive Names**: Test names should describe what they test

## Related Files

- `conftest.py` - Pytest configuration and fixtures
- `test_report_generator.py` - HTML report generator
- `run_tests_enhanced.sh` - Enhanced test runner script
- `tests/test_backend_api.py` - Backend unit tests
- `tests/test_integration.py` - Integration tests
