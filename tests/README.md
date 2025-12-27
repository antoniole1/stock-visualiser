# Stock Visualiser Test Suite

Comprehensive unit tests, integration tests, and CI/CD pipeline for the Stock Visualiser application.

## Overview

This test suite ensures that all critical functionality works correctly, including:
- Backend API endpoints (stock prices, portfolios, float conversion safety)
- Frontend logic (portfolio management, calculations, validation)
- Integration workflows (end-to-end portfolio creation and position management)

## Test Files

### Backend Tests

#### `test_backend_api.py`
Tests for Flask API endpoints covering:
- **Stock Price Endpoints**: `/api/stock/<ticker>` and `/api/stock/<ticker>/instant`
  - Valid price responses
  - None/invalid price handling (critical for SDR ticker fix)
  - Missing optional fields handling
  - Fallback values for missing data
- **Float Conversion Safety** (key fix)
  - Tests that None values don't cause `float() argument must be a string or a number` errors
  - Tests invalid numeric string handling
  - Validates fallback values (previous_close → current_price, change_amount → 0, etc.)
- **Portfolio Endpoints**: `/api/portfolio/save`
- **Error Handling**: Graceful handling of invalid requests, timeouts, network errors

#### `test_integration.py`
End-to-end workflow tests:
- **Portfolio Creation Flow**: Create portfolio → Add position → Verify data
- **Portfolio Landing Page**: Position count updates, metrics calculation, deletion
- **Data Validation**: Complete position validation with multiple test cases
- **Float Conversion Robustness**: Specific test for SDR ticker edge cases

#### `test_frontend.js`
Frontend unit tests (Jest):
- **Portfolio Management**: Creation, position adding, deletion
- **Position Validation**: Ticker, shares, price, date validation
- **Portfolio Landing Page**: Position count updates, metrics display
- **Calculations**: Position value, gain/loss, percentages
- **Error Handling**: Invalid inputs, API errors

## Running Tests

### Install Test Dependencies

```bash
pip install -r requirements.txt
```

### Run All Tests

```bash
./run_tests.sh
```

Or manually:

```bash
# Backend tests only
python -m pytest tests/test_backend_api.py -v

# Integration tests only
python -m pytest tests/test_integration.py -v

# Frontend tests (requires Node.js)
npm test -- tests/test_frontend.js

# All tests with coverage
python -m pytest tests/ -v --cov=app --cov-report=html
```

### View Coverage Report

After running tests with coverage:

```bash
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
start htmlcov/index.html  # Windows
```

## Continuous Integration

Tests automatically run on:
- Every push to `main` or `develop` branches
- Every pull request
- GitHub Actions workflow defined in `.github/workflows/tests.yml`

### GitHub Actions

The CI/CD pipeline:
1. Runs backend unit tests (pytest)
2. Runs integration tests (pytest)
3. Runs frontend tests (Jest)
4. Generates coverage report
5. Uploads coverage to Codecov
6. Verifies Flask app loads successfully

## Key Test Cases

### Critical: Float Conversion Error Fix

**Problem Fixed**: `float() argument must be a string or a number, not 'NoneType'`
- Occurred when adding stocks with missing optional price fields (e.g., SDR ticker)

**Tests Covering Fix**:
- `test_stock_quote_with_none_price()`
- `test_stock_quote_with_missing_optional_fields()`
- `test_handle_problematic_ticker_sdr()`
- `test_no_float_conversion_error_on_none_values()`

### Critical: Portfolio Position Count Display

**Problem Fixed**: Portfolio landing page showed 0 shares even after adding positions

**Tests Covering Fix**:
- `test_portfolio_positions_count_update()`
- Tests that `availablePortfolios` is updated after save

## Adding New Tests

When adding new features:

1. **Write tests first** (TDD approach)
2. **Update test files**:
   - Backend logic → add to `test_backend_api.py` or `test_integration.py`
   - Frontend logic → add to `test_frontend.js`
3. **Run full test suite**: `./run_tests.sh`
4. **Ensure coverage** doesn't decrease
5. **Commit with tests**: `git add tests/ && git commit`

## Test Coverage Goals

- **Backend**: Aim for 80%+ coverage of critical paths
- **API Endpoints**: 100% coverage of endpoints
- **Error Handling**: 100% of error paths tested
- **Frontend**: Core validation and calculation logic

## Troubleshooting

### pytest not found
```bash
pip install pytest pytest-cov pytest-mock
```

### Module import errors
```bash
# Ensure you're running from project root
cd /Users/ant/Desktop/StockVisualiser
python -m pytest tests/
```

### Coverage report not generated
```bash
pip install pytest-cov
python -m pytest tests/ --cov=app --cov-report=html
```

### Frontend tests not running
```bash
npm install --save-dev jest @babel/preset-env babel-jest
npm test
```

## Best Practices

1. **Keep tests focused**: One test = one behavior
2. **Use descriptive names**: `test_stock_quote_with_none_price` is better than `test_1`
3. **Mock external APIs**: Don't call real Finnhub API in tests
4. **Test edge cases**: Empty values, None, negative, very large numbers
5. **Run before committing**: `./run_tests.sh` before `git commit`

## CI/CD Pipeline Status

Check status in GitHub Actions:
1. Go to your GitHub repository
2. Click "Actions" tab
3. View test results for each commit
4. Coverage reports available in Codecov

---

For more information, see:
- [pytest documentation](https://docs.pytest.org/)
- [Jest documentation](https://jestjs.io/)
- [GitHub Actions documentation](https://docs.github.com/en/actions)
