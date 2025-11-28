# Deployment Guide

This guide will help you deploy your Stock Portfolio Tracker online for free.

## Option 1: Render + GitHub Pages (Recommended - Free)

### Step 1: Deploy Backend to Render

1. **Push your code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/StockVisualiser.git
   git push -u origin main
   ```

2. **Deploy to Render:**
   - Go to [render.com](https://render.com) and sign up (free)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Render will auto-detect Python and use `render.yaml`
   - Add environment variable:
     - Key: `ALPHAVANTAGE_API_KEY`
     - Value: `KPG0AN3RSJQHFDQ4`
   - Click "Create Web Service"
   - Wait for deployment (takes 2-3 minutes)
   - Copy your service URL: `https://stockvisualiser.onrender.com`

### Step 2: Update Frontend for Production

1. **Update `index.html` (line 816):**
   ```javascript
   // Change from:
   const API_URL = 'http://127.0.0.1:5001/api';

   // To:
   const API_URL = 'https://your-render-url.onrender.com/api';
   ```

2. **Update CORS in `app.py`:**
   ```python
   # Change from:
   CORS(app)

   # To:
   CORS(app, origins=['https://yourusername.github.io'])
   ```

3. **Commit and push:**
   ```bash
   git add .
   git commit -m "Update API URL for production"
   git push
   ```

### Step 3: Deploy Frontend to GitHub Pages

1. Go to your GitHub repository
2. Settings → Pages
3. Source: Deploy from a branch
4. Branch: main, folder: / (root)
5. Save
6. Your site will be live at: `https://yourusername.github.io/StockVisualiser`

---

## Option 2: Vercel (All-in-One)

Vercel can host both frontend and backend in one place.

### Setup:

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Create `vercel.json`:**
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "app.py",
         "use": "@vercel/python"
       },
       {
         "src": "index.html",
         "use": "@vercel/static"
       }
     ],
     "routes": [
       {
         "src": "/api/(.*)",
         "dest": "app.py"
       },
       {
         "src": "/(.*)",
         "dest": "/$1"
       }
     ],
     "env": {
       "ALPHAVANTAGE_API_KEY": "KPG0AN3RSJQHFDQ4"
     }
   }
   ```

3. **Deploy:**
   ```bash
   vercel deploy --prod
   ```

4. **Update `index.html`:**
   ```javascript
   const API_URL = '/api';  // Vercel handles routing
   ```

---

## Option 3: Railway (Easiest)

Railway provides a simple one-click deployment.

1. Go to [railway.app](https://railway.app)
2. Click "Deploy from GitHub repo"
3. Connect your repository
4. Add environment variable: `ALPHAVANTAGE_API_KEY=KPG0AN3RSJQHFDQ4`
5. Railway auto-detects Python and deploys
6. Get your URL and update `index.html`

---

## Important Notes

### AlphaVantage API Limits:
- **Free tier:** 25 API calls/day, 5 calls/minute
- The app caches data in localStorage to minimize API usage
- First load uses ~1 call per stock, subsequent loads use 1 call total

### Security:
- Never commit API keys to GitHub (use environment variables)
- The backend protects your API key from being exposed to users
- CORS is configured to only allow requests from your frontend domain

### Free Tier Considerations:
- **Render:** Backend sleeps after 15 mins of inactivity (takes ~30s to wake up)
- **Vercel:** Generous free tier with automatic HTTPS
- **Railway:** $5 free credit per month (enough for light usage)

---

## Testing Deployment

After deployment, test these endpoints:

1. **Backend health check:**
   ```
   https://your-backend-url.onrender.com/api/health
   ```

2. **Stock data:**
   ```
   https://your-backend-url.onrender.com/api/stock/AAPL
   ```

3. **Frontend:** Open your GitHub Pages URL and create a test portfolio

---

## Troubleshooting

**"API key not configured" error:**
- Check environment variables in your hosting platform
- Make sure `ALPHAVANTAGE_API_KEY` is set correctly

**CORS errors:**
- Update `app.py` CORS configuration with your frontend URL
- Redeploy backend after CORS changes

**Backend sleeping (Render free tier):**
- First request after 15 mins of inactivity takes longer
- Consider upgrading to paid tier ($7/month) for always-on

**API rate limits:**
- Clear localStorage to reset cache if needed
- Wait 24 hours if you hit the 25 calls/day limit
