# Testing Guide: Registration Fix

**Commit:** ce26c1f, ad13936
**Date:** 2025-12-24

## What Was Fixed

The `/api/portfolio/create` endpoint (registration) was broken - it wasn't creating users in the `users` table. This has been fixed.

## How to Test Locally

### Step 1: Restart Your Backend
Make sure the backend is running with the latest changes:
```bash
python3 app.py
# You should see: ✓ Supabase database connected
```

### Step 2: Test Registration (Create New Portfolio)

1. Open browser and go to `http://localhost:8000`
2. Click **"Create New Portfolio"** button
3. Fill in the form:
   - **Username:** `testuser123`
   - **Portfolio Name:** `My Test Portfolio`
   - **Password:** `SecurePass123!` (must have uppercase, lowercase, number, special char)
   - **Confirm Password:** `SecurePass123!`
4. Click **"Create Portfolio"** button

### Step 3: Verify the User Was Created

After clicking "Create Portfolio", you should see:

1. **In Browser Console:**
   - No 405 error
   - Dashboard loads successfully
   - You can see your portfolio

2. **In Supabase (users table):**
   - Open Supabase dashboard
   - Go to SQL Editor
   - Run: `SELECT * FROM users WHERE username = 'testuser123';`
   - You should see your new user with id and password_hash

3. **In Supabase (portfolios table):**
   - Run: `SELECT * FROM portfolios WHERE portfolio_name = 'My Test Portfolio';`
   - Verify:
     - `user_id` matches the user you created
     - `is_default = true` (first portfolio is always default)
     - `positions = []` (empty array)

### Step 4: Test Adding a Position

1. After registration, dashboard should load
2. Click **"Add Position"** button
3. Add a stock:
   - **Ticker:** `AAPL`
   - **Shares:** `10`
   - **Purchase Price:** `150`
   - **Purchase Date:** Today's date
4. Click **"Add Position"** button
5. You should see the position added to your portfolio

### Step 5: Test Logout and Login

1. Click your profile button (top-right)
2. Click **"Logout"**
3. Click **"Find My Portfolio"** button
4. Login with the credentials you just created:
   - **Username:** `testuser123`
   - **Password:** `SecurePass123!`
5. You should see your portfolio with the AAPL position you added

## Expected Results

After the fix, the flow should be:

```
User clicks "Create New Portfolio"
    ↓
Form appears with fields
    ↓
User fills form and submits
    ↓
✅ New user created in users table
✅ New portfolio created in portfolios table
✅ Portfolio linked to user (user_id foreign key)
✅ Session token created
✅ Dashboard loads with empty portfolio
    ↓
User can add positions
    ↓
Positions are saved to correct portfolio
```

## Troubleshooting

### Issue: Still getting 405 error
**Solution:** Make sure you restarted the Python backend after the fix

### Issue: User created but not appearing in dashboard
**Solution:** Check browser console for errors. Common issues:
- Database connection failed
- Session token not being stored
- activePortfolioId not set

### Issue: Portfolio not appearing in database
**Solution:** Check if:
1. User was created (look in users table)
2. Supabase credentials are correct
3. portfolios table has correct columns (user_id, portfolio_name, positions, is_default, etc.)

### Issue: Login fails after registration
**Solution:**
- Check that username and password are exactly as you entered
- Verify user exists in users table
- Check browser console for error message

## Success Criteria

Registration is working correctly when:

✅ New user appears in `users` table with username and password_hash
✅ New portfolio appears in `portfolios` table with user_id foreign key
✅ Portfolio is_default = true for first portfolio
✅ Dashboard loads after registration
✅ Positions can be added to portfolio
✅ Login works with registered credentials
✅ Portfolio persists after logout/login cycle

## Additional Testing (Optional)

### Test Portfolio Limit
1. Try creating 6 portfolios (limit is 5)
2. The 6th should fail with error message

### Test Password Validation
1. Try registration with weak passwords
2. Should see validation errors:
   - Less than 8 characters
   - No uppercase letter
   - No lowercase letter
   - No number
   - No special character

### Test Username Validation
1. Try username shorter than 3 characters
2. Should fail with error message
3. Try registering with same username twice
4. Should fail with "Username already exists"

## Files Changed in This Fix

### Backend (app.py)
- `/api/portfolio/create` endpoint (lines 873-992)
- Now creates user in users table before creating portfolio
- Returns proper multi-portfolio response format
- Creates session token automatically

### Frontend (js/app.js)
- `createPortfolio()` function (lines 533-571)
- Portfolio setup form handler (lines 2232-2280)
- Both updated to handle new multi-portfolio response format

## Commit Details

**Commit:** `ce26c1f` - "Fix: Update /api/portfolio/create endpoint to work with multi-user architecture"

**Key changes:**
- 108 insertions (+), 28 deletions (-)
- app.py: Registration endpoint complete rewrite
- js/app.js: Updated createPortfolio() and form handler

## Next Steps

After confirming this fix works:

1. Test the login flow with multiple portfolios
2. Test switching between portfolios
3. Test creating additional portfolios
4. Then proceed with Phase 4: Portfolio Switcher UI

## Questions?

If you encounter any issues:
1. Check browser console for JavaScript errors
2. Check Python console for backend errors
3. Review REGISTRATION_FIX.md for detailed implementation info
4. Verify database connection is working

---

**Happy testing!** 🚀
