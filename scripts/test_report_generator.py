"""
Enhanced test report generator with visual HTML output.
Parses pytest JSON output and creates a beautiful HTML dashboard.
"""

import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any


class TestReportGenerator:
    """Generate beautiful HTML test reports."""

    def __init__(self, test_results_file: str):
        """Initialize the report generator."""
        self.test_results_file = Path(test_results_file)
        self.report_dir = Path(__file__).parent / "test_results"
        self.report_dir.mkdir(exist_ok=True)

    def generate_report(self) -> str:
        """Generate HTML report and return its path."""
        report_path = self.report_dir / "test_report.html"

        # Read test results if file exists
        test_data = self._parse_test_results()

        # Generate HTML
        html_content = self._create_html(test_data)

        # Write report
        with open(report_path, 'w') as f:
            f.write(html_content)

        return str(report_path)

    def _parse_test_results(self) -> Dict[str, Any]:
        """Parse pytest JSON output or create default structure."""
        if self.test_results_file.exists():
            try:
                with open(self.test_results_file) as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass

        # Return default structure if file doesn't exist
        return {
            "timestamp": datetime.now().isoformat(),
            "tests": [],
            "summary": {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "duration": 0
            }
        }

    def _create_html(self, data: Dict[str, Any]) -> str:
        """Create HTML report content."""
        summary = data.get("summary", {})
        tests = data.get("tests", [])

        total = summary.get("total", 0)
        passed = summary.get("passed", 0)
        failed = summary.get("failed", 0)
        skipped = summary.get("skipped", 0)
        duration = summary.get("duration", 0)

        # Calculate pass rate
        pass_rate = (passed / total * 100) if total > 0 else 0
        status_color = "success" if failed == 0 else "danger"
        status_text = "✓ PASSED" if failed == 0 else "✗ FAILED"

        # Build test rows
        test_rows = ""
        for test in tests:
            outcome = test.get("outcome", "unknown")
            test_name = test.get("name", "Unknown")
            duration_ms = test.get("duration", 0)
            error_msg = test.get("error", "")

            outcome_class = self._get_outcome_class(outcome)
            outcome_icon = self._get_outcome_icon(outcome)

            test_rows += f"""
            <tr>
                <td><span class="outcome-badge outcome-{outcome_class}">{outcome_icon} {outcome.upper()}</span></td>
                <td><code>{test_name}</code></td>
                <td>{duration_ms:.3f}s</td>
                <td class="error-msg">{error_msg if error_msg else '—'}</td>
            </tr>
            """

        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report - Stock Visualiser</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
            color: #333;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }}

        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }}

        .header h1 {{
            font-size: 2.5em;
            margin-bottom: 10px;
        }}

        .header p {{
            font-size: 1.1em;
            opacity: 0.9;
        }}

        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 40px;
            background: #f8f9fa;
            border-bottom: 2px solid #e9ecef;
        }}

        .summary-card {{
            text-align: center;
            padding: 20px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}

        .summary-card .number {{
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 10px;
        }}

        .summary-card .label {{
            font-size: 0.95em;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}

        .summary-card.passed .number {{
            color: #28a745;
        }}

        .summary-card.failed .number {{
            color: #dc3545;
        }}

        .summary-card.skipped .number {{
            color: #ffc107;
        }}

        .summary-card.total .number {{
            color: #667eea;
        }}

        .status-banner {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
            font-size: 1.3em;
            font-weight: bold;
        }}

        .status-banner.success {{
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
        }}

        .status-banner.failure {{
            background: linear-gradient(135deg, #dc3545 0%, #fd7e14 100%);
        }}

        .tests-section {{
            padding: 40px;
        }}

        .tests-section h2 {{
            margin-bottom: 20px;
            color: #333;
            font-size: 1.8em;
        }}

        .tests-table {{
            width: 100%;
            border-collapse: collapse;
            background: white;
        }}

        .tests-table thead {{
            background: #f8f9fa;
            border-bottom: 2px solid #dee2e6;
        }}

        .tests-table th {{
            padding: 15px;
            text-align: left;
            font-weight: 600;
            color: #495057;
            text-transform: uppercase;
            font-size: 0.85em;
            letter-spacing: 0.5px;
        }}

        .tests-table td {{
            padding: 15px;
            border-bottom: 1px solid #dee2e6;
        }}

        .tests-table tbody tr:hover {{
            background: #f8f9fa;
        }}

        .outcome-badge {{
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.85em;
        }}

        .outcome-passed {{
            background: #d4edda;
            color: #155724;
        }}

        .outcome-failed {{
            background: #f8d7da;
            color: #721c24;
        }}

        .outcome-skipped {{
            background: #fff3cd;
            color: #856404;
        }}

        code {{
            background: #f5f5f5;
            padding: 4px 8px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }}

        .error-msg {{
            color: #666;
            font-size: 0.9em;
            max-width: 400px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }}

        .footer {{
            background: #f8f9fa;
            padding: 20px;
            text-align: center;
            color: #666;
            border-top: 1px solid #dee2e6;
            font-size: 0.9em;
        }}

        .progress-bar {{
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 10px;
        }}

        .progress-fill {{
            height: 100%;
            background: linear-gradient(90deg, #28a745 0%, #20c997 100%);
            transition: width 0.3s ease;
        }}

        .no-tests {{
            text-align: center;
            padding: 40px;
            color: #999;
        }}

        @media (max-width: 768px) {{
            .header h1 {{
                font-size: 1.8em;
            }}

            .summary {{
                grid-template-columns: repeat(2, 1fr);
            }}

            .tests-table {{
                font-size: 0.9em;
            }}

            .tests-table th,
            .tests-table td {{
                padding: 10px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Stock Visualiser Test Report</h1>
            <p>Test Execution Dashboard</p>
        </div>

        <div class="status-banner {status_color}">
            {status_text} — {pass_rate:.1f}% Pass Rate
        </div>

        <div class="summary">
            <div class="summary-card total">
                <div class="number">{total}</div>
                <div class="label">Total Tests</div>
            </div>
            <div class="summary-card passed">
                <div class="number">{passed}</div>
                <div class="label">Passed</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: {(passed/total*100) if total > 0 else 0}%"></div>
                </div>
            </div>
            <div class="summary-card failed">
                <div class="number">{failed}</div>
                <div class="label">Failed</div>
            </div>
            <div class="summary-card skipped">
                <div class="number">{skipped}</div>
                <div class="label">Skipped</div>
            </div>
            <div class="summary-card">
                <div class="number">{duration:.2f}s</div>
                <div class="label">Duration</div>
            </div>
        </div>

        <div class="tests-section">
            <h2>Test Results</h2>
            {f'''<table class="tests-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Test Name</th>
                        <th>Duration</th>
                        <th>Error Message</th>
                    </tr>
                </thead>
                <tbody>
                    {test_rows if test_rows else '<tr><td colspan="4" class="no-tests">No tests found</td></tr>'}
                </tbody>
            </table>''' if tests else '<div class="no-tests">No test results available. Run tests with `--json-report` flag.</div>'}
        </div>

        <div class="footer">
            <p>Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            <p>Stock Visualiser Test Suite</p>
        </div>
    </div>
</body>
</html>
        """

        return html

    @staticmethod
    def _get_outcome_class(outcome: str) -> str:
        """Get CSS class for outcome."""
        if outcome == "passed":
            return "passed"
        elif outcome == "failed":
            return "failed"
        else:
            return "skipped"

    @staticmethod
    def _get_outcome_icon(outcome: str) -> str:
        """Get emoji icon for outcome."""
        if outcome == "passed":
            return "✓"
        elif outcome == "failed":
            return "✗"
        else:
            return "⊘"


if __name__ == "__main__":
    # Example usage
    results_file = "test_results/test_results.json"
    generator = TestReportGenerator(results_file)
    report_path = generator.generate_report()
    print(f"Report generated: {report_path}")
