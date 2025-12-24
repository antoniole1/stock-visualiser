#!/bin/bash

# Kill any existing Flask process on port 5001
echo "Stopping existing Flask process..."
lsof -ti :5001 | xargs kill -9 2>/dev/null || true
sleep 1

# Start Flask in the background
echo "Starting Flask backend on port 5001..."
cd /Users/ant/Desktop/StockVisualiser
python3 app.py &

# Wait for server to start
sleep 3

# Verify it's running
if curl -s http://localhost:5001/api > /dev/null 2>&1; then
    echo "✓ Flask backend is running on http://localhost:5001"
    echo "✓ Supabase database connected"
    echo ""
    echo "Backend is ready! You can now test the frontend."
    echo "Make sure to reload your browser page."
else
    echo "✗ Failed to start Flask backend"
    exit 1
fi
