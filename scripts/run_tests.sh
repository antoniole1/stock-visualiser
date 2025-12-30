#!/bin/bash

# Stock Visualiser Test Runner
# Runs all unit tests, integration tests, and generates coverage report

set -e

echo "=================================================="
echo "Stock Visualiser Test Suite"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo -e "${YELLOW}Installing pytest...${NC}"
    pip install pytest pytest-cov
fi

echo -e "${YELLOW}Running Backend Unit Tests...${NC}"
python -m pytest tests/test_backend_api.py -v --tb=short

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Backend unit tests passed${NC}"
else
    echo -e "${RED}✗ Backend unit tests failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Running Integration Tests...${NC}"
python -m pytest tests/test_integration.py -v --tb=short

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
else
    echo -e "${RED}✗ Integration tests failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Running Tests with Coverage Report...${NC}"
python -m pytest tests/ -v --cov=app --cov-report=html --cov-report=term

echo ""
echo "=================================================="
echo -e "${GREEN}✓ All tests passed successfully!${NC}"
echo "=================================================="
echo ""
echo "Coverage report generated in: htmlcov/index.html"
echo "Run 'open htmlcov/index.html' to view detailed coverage"
