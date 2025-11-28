# Stock Price Viewer

A simple web application to view real-time stock prices, daily changes, and 30-day price history charts. Built with Flask (Python backend) and vanilla HTML/CSS/JavaScript (frontend) to demonstrate API integration.

## Features

- Search stocks by ticker symbol (e.g., AAPL, GOOGL, MSFT)
- Display current stock price and daily change
- Show market cap and previous close
- Interactive 30-day price history chart
- Clean, modern UI with loading states and error handling
- Real-time data from Yahoo Finance API

## Project Structure

```
StockVisualiser/
├── app.py              # Flask backend API server
├── index.html          # Frontend HTML page
├── requirements.txt    # Python dependencies
└── README.md          # This file
```

## Setup Instructions

### Prerequisites

- Python 3.7 or higher
- pip (Python package manager)
- A modern web browser (Chrome, Firefox, Safari, or Edge)

### Step 1: Install Python Dependencies

Open a terminal in the project directory and run:

```bash
pip install -r requirements.txt
```

This will install:
- Flask (web framework)
- flask-cors (for handling Cross-Origin Resource Sharing)
- yfinance (for fetching stock data from Yahoo Finance)

### Step 2: Start the Backend Server

Run the Flask server:

```bash
python app.py
```

You should see:
```
Starting Flask server on http://localhost:5000
API endpoint: http://localhost:5000/api/stock/{ticker}
 * Running on http://127.0.0.1:5000
```

Keep this terminal window open - the server needs to stay running.

### Step 3: Open the Frontend

Open the `index.html` file in your web browser:

**Option 1 - Double-click:**
- Simply double-click `index.html` in your file explorer

**Option 2 - Command line (macOS):**
```bash
open index.html
```

**Option 3 - Command line (Linux):**
```bash
xdg-open index.html
```

**Option 4 - Command line (Windows):**
```bash
start index.html
```

## How to Use

1. Enter a stock ticker symbol in the search box (e.g., "AAPL" for Apple, "MSFT" for Microsoft)
2. Click the "Search" button or press Enter
3. Wait for the data to load (usually takes 1-3 seconds)
4. View the results:
   - Company name and ticker
   - Current stock price
   - Daily change (amount and percentage)
   - Previous closing price
   - Market capitalization
   - 30-day price history chart

## Popular Stock Tickers to Try

- **AAPL** - Apple Inc.
- **GOOGL** - Alphabet Inc. (Google)
- **MSFT** - Microsoft Corporation
- **AMZN** - Amazon.com Inc.
- **TSLA** - Tesla Inc.
- **META** - Meta Platforms Inc. (Facebook)
- **NVDA** - NVIDIA Corporation
- **NFLX** - Netflix Inc.

## API Documentation

### Backend Endpoint

**GET** `/api/stock/{ticker}`

**Parameters:**
- `ticker` (string): Stock ticker symbol (e.g., "AAPL")

**Response (Success - 200):**
```json
{
  "ticker": "AAPL",
  "company_name": "Apple Inc.",
  "current_price": 178.50,
  "change_amount": 2.35,
  "change_percent": 1.33,
  "previous_close": 176.15,
  "market_cap": 2750000000000,
  "chart_data": [
    {
      "date": "2025-10-22",
      "price": 175.50
    },
    ...
  ]
}
```

**Response (Error - 404/500):**
```json
{
  "error": "Invalid ticker symbol or data not available"
}
```

## Troubleshooting

### Backend Issues

**"ModuleNotFoundError: No module named 'flask'"**
- Run: `pip install -r requirements.txt`

**"Address already in use" or port 5000 is busy**
- Edit `app.py` and change the port number:
  ```python
  app.run(debug=True, port=5001)  # Change to different port
  ```
- Also update the API_URL in `index.html`:
  ```javascript
  const API_URL = 'http://localhost:5001/api/stock';
  ```

### Frontend Issues

**"Failed to fetch stock data"**
- Make sure the backend server is running (check terminal)
- Verify the backend is accessible at http://localhost:5000
- Check browser console (F12) for detailed error messages

**Invalid ticker symbol error**
- Make sure you're using valid stock ticker symbols
- Try well-known stocks like AAPL, GOOGL, or MSFT first

**No data loading or blank chart**
- Some stocks may have limited historical data
- Try a different, more actively traded stock
- Check if the market is open (data is delayed for closed markets)

## Learning Points

This project demonstrates:

1. **Backend API Development**
   - Creating REST API endpoints with Flask
   - Handling CORS for cross-origin requests
   - Integrating third-party APIs (yfinance)
   - Error handling and validation
   - JSON response formatting

2. **Frontend Development**
   - Asynchronous JavaScript (async/await, fetch API)
   - DOM manipulation
   - Canvas API for drawing charts
   - Responsive design with CSS Grid and Flexbox
   - Loading states and error handling

3. **API Integration**
   - Making HTTP requests from frontend to backend
   - Parsing and displaying JSON data
   - Handling API errors gracefully
   - Working with real-time financial data

## Next Steps to Enhance

- Add more stock metrics (52-week high/low, P/E ratio, volume)
- Implement stock comparison feature
- Add watchlist functionality with local storage
- Create different time range options (7 days, 90 days, 1 year)
- Add stock search with autocomplete
- Implement real-time price updates using WebSockets
- Add dark mode toggle
- Deploy to a cloud platform (Heroku, AWS, etc.)

## License

Free to use for learning purposes.
