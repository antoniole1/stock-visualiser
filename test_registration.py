#!/usr/bin/env python3
"""Test the registration endpoint"""

import requests
import json
import time

API_URL = "http://localhost:5001/api/portfolio/create"

# Use timestamp to ensure unique username
unique_suffix = str(int(time.time()))

test_data = {
    "username": f"testuser{unique_suffix}",
    "name": "New Test Portfolio",
    "password": "TestPass123!"
}

print("Testing registration endpoint...")
print(f"URL: {API_URL}")
print(f"Payload: {json.dumps(test_data, indent=2)}")
print("\nResponse:")

try:
    response = requests.post(API_URL, json=test_data, timeout=5)
    print(f"Status Code: {response.status_code}")
    print(f"Response Body:")
    resp_json = response.json()
    print(json.dumps(resp_json, indent=2))

    # Check if registration was successful
    if response.status_code == 201 and resp_json.get('success'):
        print("\n✓ Registration successful!")
        print(f"User ID: {resp_json.get('user', {}).get('id')}")
        print(f"Portfolio ID: {resp_json.get('active_portfolio_id')}")
    else:
        print(f"\n✗ Registration failed with status {response.status_code}")
except Exception as e:
    print(f"Error: {e}")
