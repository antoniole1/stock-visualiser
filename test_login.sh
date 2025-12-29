#!/bin/bash

# Test the login endpoint to see what it returns
curl -X POST http://localhost:5000/api/portfolio/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test1",
    "password": "Test123456!"
  }' \
  -s | python3 -m json.tool | head -100
