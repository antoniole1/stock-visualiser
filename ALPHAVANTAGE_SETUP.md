# AlphaVantage API Setup Instructions

The app now uses AlphaVantage for reliable stock data with generous free tier limits.

## Step 1: Get Your Free AlphaVantage API Key

1. Go to **https://www.alphavantage.co/support/#api-key**
2. Enter your email and organization (optional) - it's completely free
3. Click "GET FREE API KEY"
4. Your API key will be displayed immediately
5. Copy your API key (it looks like: `XXXXXXXXXXXXXXXX`)

## Step 2: Set the API Key as Environment Variable

### On macOS/Linux:

**Option 1 - Temporary (for this session only):**
```bash
export ALPHAVANTAGE_API_KEY='your_api_key_here'
```

**Option 2 - Permanent (recommended):**

Add to your `~/.zshrc` or `~/.bash_profile`:
```bash
echo 'export ALPHAVANTAGE_API_KEY="your_api_key_here"' >> ~/.zshrc
source ~/.zshrc
```

### On Windows:

**Command Prompt:**
```cmd
set ALPHAVANTAGE_API_KEY=your_api_key_here
```

**PowerShell:**
```powershell
$env:ALPHAVANTAGE_API_KEY="your_api_key_here"
```

## Step 3: Verify Setup

Check if the environment variable is set:

**macOS/Linux:**
```bash
echo $ALPHAVANTAGE_API_KEY
```

**Windows (PowerShell):**
```powershell
echo $env:ALPHAVANTAGE_API_KEY
```

You should see your API key printed out.

## Step 4: Start the Server

Now you can start the Flask server:

```bash
python3 app.py
```

You should see a message confirming the API key is configured:
```
Starting Flask server on http://localhost:5000
API endpoint: http://localhost:5000/api/stock/{ticker}
AlphaVantage API key configured: XXXXXXXX...
```

## AlphaVantage Free Tier Limits

The free tier includes:
- 25 API calls per day (500/month)
- 5 API calls per minute
- Real-time stock quotes
- Company profiles
- Full historical daily data (up to 20 years)
- Much more reliable than other free APIs!

**Important**: Since the free tier has daily limits, the app caches historical data in your browser's localStorage. Once you fetch historical data for a stock, it will only need to fetch today's price on subsequent loads.

## Troubleshooting

**If you see "API key not configured" error:**
- Make sure you've set the environment variable correctly
- Restart your terminal and run the export command again
- Make sure there are no extra spaces or quotes in the API key

**If you get "API call limit reached" errors:**
- You've exceeded the 25 calls/day limit (or 5 calls/minute limit)
- Wait 24 hours for the daily limit to reset
- The app caches data to minimize API calls

**If stock data isn't loading:**
- Check that the Flask server is running
- Open browser console (F12) to see any JavaScript errors
- Verify the API key is working by visiting: https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=YOUR_KEY

**Rate Limiting Tips:**
- The app is designed to cache historical data - only the first load for each stock uses API calls
- Clear your browser's localStorage only when necessary (this will force refetching all data)
- Add all your positions first before viewing the portfolio to batch API calls
