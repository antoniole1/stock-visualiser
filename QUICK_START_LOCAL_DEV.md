# Quick Start Guide - Local Development

## The Problem You Encountered

You were getting a **405 Method Not Allowed** error because the frontend and backend were on different ports:
- Frontend: `http://127.0.0.1:5500` (your static file server)
- Backend: Should be `http://localhost:5001` (Flask app)

The old code used a relative path `/api` which tried to send requests to port 5500 instead of 5001.

## The Fix (Just Applied ✅)

The code now automatically detects when running locally and points to the correct backend port (5001).

## How to Run Locally

### Step 1: Start the Flask Backend

Open a terminal and run:

```bash
cd /Users/ant/Desktop/StockVisualiser
python3 app.py
```

You should see:
```
✓ Supabase database connected
Starting Flask server on http://0.0.0.0:5001
API endpoint: /api/stock/{ticker}
```

**Leave this terminal open while testing.**

### Step 2: Open the Frontend

Open your browser to one of these URLs:
- `http://localhost:5001` (served by Flask)
- `http://127.0.0.1:5500` (if using a static server)
- `http://localhost:8000` (if using another server)

**The important thing:** The Flask backend MUST be running on port 5001.

### Step 3: Test Registration

1. Click **"Create New Portfolio"**
2. Fill in the form:
   ```
   Username: testuser123
   Portfolio Name: My First Portfolio
   Password: SecurePass123!
   Confirm: SecurePass123!
   ```
3. Click **"Create Portfolio"**

**Expected result:** Dashboard loads with empty portfolio

### Step 4: Verify Backend is Running

While testing, watch the Flask terminal. You should see:
```
POST /api/portfolio/create 201
POST /api/portfolio/details 200
GET /api/company/AAPL 200
...etc
```

If you see 405 errors in the Flask terminal, that means the request didn't reach it.

## Troubleshooting

### Error: "Cannot GET /"
**Problem:** Flask backend isn't running
**Solution:** Make sure `python3 app.py` is running in a terminal

### Error: "405 Method Not Allowed"
**Problem:** Request went to wrong server (port 5500 instead of 5001)
**Solution:**
1. Verify Flask is running: `python3 app.py`
2. Check the terminal shows "Starting Flask server on http://0.0.0.0:5001"
3. Reload the browser page

### Error: "Unexpected end of JSON input"
**Problem:** Backend didn't respond or returned HTML error
**Cause:** Usually means backend isn't running
**Solution:** Start Flask with `python3 app.py`

### Error: "Supabase connection failed"
**Problem:** Database credentials aren't set
**Solution:** Check your `.env` file has:
```
SUPABASE_URL=...
SUPABASE_KEY=...
```

## What Changed (Commit 609852d)

The `API_URL` in `js/app.js` now:
1. Detects if you're on localhost
2. For localhost: points to `http://localhost:5001/api`
3. For production: uses relative path `/api`

This means the frontend works whether the backend is on the same domain or different port.

## Quick Commands

**Start backend:**
```bash
python3 app.py
```

**Open frontend (choose one):**
```bash
# If using Live Server in VS Code
# Just open index.html and click "Go Live"

# Or use Python's built-in server
python3 -m http.server 5500

# Or use any other static server
npx http-server -p 5500
```

**Check if backend is running:**
```bash
curl http://localhost:5001/api
```

## Important Notes

1. **Backend must run on port 5001** (or change the code)
2. **Frontend can run on any port** (5500, 8000, 3000, etc.)
3. **Flask backend must stay running** while you test
4. **Reload browser after starting backend** (the API_URL is detected on page load)

## Testing Flow

```
1. Start Flask: python3 app.py
2. Open browser: http://localhost:5500 (or whatever port)
3. Click "Create New Portfolio"
4. Fill form and submit
5. Watch Flask terminal for POST request
6. Dashboard should load
```

## Success Indicators

When everything works:
- ✅ No 405 errors in browser console
- ✅ Flask terminal shows "POST /api/portfolio/create 201"
- ✅ Dashboard loads after registration
- ✅ You can add positions to portfolio
- ✅ Data appears in Supabase

## Next Steps

After confirming registration works:
1. Test login with your credentials
2. Test adding multiple portfolios
3. Test switching between portfolios
4. Then proceed with Phase 4: Portfolio Switcher UI

---

**Happy developing!** 🚀
