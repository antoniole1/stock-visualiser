#!/bin/bash

# Stock Visualiser - Development Server Launcher
# Starts the Flask backend from the correct directory

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to backend directory and run Flask app
cd "$SCRIPT_DIR/backend"

echo "Starting Stock Visualiser..."
echo "Frontend: http://localhost:5001"
echo "Backend API: http://localhost:5001/api"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

python3 app.py "$@"
