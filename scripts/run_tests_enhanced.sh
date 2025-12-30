#!/bin/bash

# Enhanced Stock Visualiser Test Runner
# Runs all tests with visual HTML report generation and test data cleanup validation

set -e

echo "=================================================="
echo "Stock Visualiser Test Suite (Enhanced)"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Create test results directory
mkdir -p test_results

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo -e "${YELLOW}Installing pytest and plugins...${NC}"
    pip install pytest pytest-cov pytest-html pytest-json-report 2>/dev/null || true
fi

# Function to print section headers
print_section() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}▶ $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Function to print results
print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ $2${NC}"
    else
        echo -e "${RED}✗ $2${NC}"
    fi
}

# Step 1: Backend Unit Tests
print_section "Backend Unit Tests"
python -m pytest tests/test_backend_api.py \
    -v \
    --tb=short \
    --color=yes \
    --html=test_results/test_backend_api.html \
    --self-contained-html \
    2>&1 | tee test_results/backend_unit_tests.log

BACKEND_UNIT_RESULT=$?
print_result $BACKEND_UNIT_RESULT "Backend unit tests"

# Step 2: Integration Tests
print_section "Integration Tests"
python -m pytest tests/test_integration.py \
    -v \
    --tb=short \
    --color=yes \
    --html=test_results/test_integration.html \
    --self-contained-html \
    2>&1 | tee test_results/integration_tests.log

INTEGRATION_RESULT=$?
print_result $INTEGRATION_RESULT "Integration tests"

# Step 3: Coverage Report
print_section "Coverage Analysis"
python -m pytest tests/ \
    -v \
    --cov=app \
    --cov-report=html:test_results/coverage \
    --cov-report=term \
    --color=yes \
    2>&1 | tee test_results/coverage.log

COVERAGE_RESULT=$?

# Step 4: Generate Visual Dashboard
print_section "Generating Test Dashboard"
python -c "
import sys
sys.path.insert(0, 'scripts')
from test_report_generator import TestReportGenerator
from pathlib import Path
import json
from datetime import datetime

# Aggregate test results
total_tests = 0
passed_tests = 0
failed_tests = 0
skipped_tests = 0
total_duration = 0.0

try:
    # Try to parse pytest HTML reports if available
    backend_log = Path('test_results/backend_unit_tests.log').read_text()
    integration_log = Path('test_results/integration_tests.log').read_text()

    # Count results from log files
    import re
    for log in [backend_log, integration_log]:
        passed = len(re.findall(r' PASSED', log))
        failed = len(re.findall(r' FAILED', log))
        skipped = len(re.findall(r' SKIPPED', log))

        passed_tests += passed
        failed_tests += failed
        skipped_tests += skipped
        total_tests += passed + failed + skipped
except:
    pass

# Create aggregated results
results = {
    'timestamp': datetime.now().isoformat(),
    'tests': [],
    'summary': {
        'total': total_tests,
        'passed': passed_tests,
        'failed': failed_tests,
        'skipped': skipped_tests,
        'duration': total_duration
    }
}

# Save results
Path('test_results/test_results.json').write_text(json.dumps(results, indent=2))

# Generate HTML report
generator = TestReportGenerator('test_results/test_results.json')
report_path = generator.generate_report()
print(f'Dashboard generated: {report_path}')
" 2>/dev/null || echo "Note: Dashboard generation requires additional setup"

# Step 5: Summary
print_section "Test Summary"
echo ""

if [ $BACKEND_UNIT_RESULT -eq 0 ] && [ $INTEGRATION_RESULT -eq 0 ]; then
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ ALL TESTS PASSED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo ""
    echo "Reports:"
    echo "  • Backend Unit Tests:    test_results/test_backend_api.html"
    echo "  • Integration Tests:     test_results/test_integration.html"
    echo "  • Coverage Report:       test_results/coverage/index.html"
    echo "  • Test Dashboard:        test_results/test_report.html"
    echo ""
    echo "View coverage:"
    echo -e "  ${CYAN}open test_results/coverage/index.html${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}════════════════════════════════════════════════${NC}"
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo -e "${RED}════════════════════════════════════════════════${NC}"
    echo ""
    echo "Check logs:"
    [ $BACKEND_UNIT_RESULT -ne 0 ] && echo "  • Backend:     test_results/backend_unit_tests.log"
    [ $INTEGRATION_RESULT -ne 0 ] && echo "  • Integration: test_results/integration_tests.log"
    echo ""
    exit 1
fi
