# Phase 2: Backend API Refactoring - Complete API Documentation

## Overview

Phase 2 refactors the backend to support multiple portfolios per user account. All existing endpoints have been updated to work with the new multi-portfolio schema, and 5 new CRUD endpoints have been added.

## Key Changes

### Authentication Model
- **Old**: Authenticate via (username, password) → Load single portfolio
- **New**: Authenticate via (username, password) → Get user ID → Load list of portfolios → Select active portfolio

### Session Storage
Sessions now store:
- `user_id` (UUID) - User identifier
- `username` (string) - Username for display
- `active_portfolio_id` (UUID) - Currently selected portfolio
- `created_at` / `expires_at` - Expiration tracking

## Updated Endpoints

### 1. POST /api/portfolio/login
**Authenticate user and get portfolio list**

**Request:**
```json
{
    "username": "antoniole",
    "password": "MySecurePass123!"
}
```

**Response (200):**
```json
{
    "success": true,
    "user": {
        "id": "c9ce8e85-9fad-4551-b6d6-05a6719fe81d",
        "username": "antoniole"
    },
    "portfolios": [
        {
            "id": "8ba82bd4-adba-4306-996d-3aa5aee63199",
            "name": "Piotroski's F-Score",
            "positions_count": 10,
            "created_at": "2025-12-24T08:00:00Z",
            "is_default": true
        },
        {
            "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "name": "Growth Portfolio",
            "positions_count": 5,
            "created_at": "2025-12-24T09:00:00Z",
            "is_default": false
        }
    ],
    "active_portfolio_id": "8ba82bd4-adba-4306-996d-3aa5aee63199"
}
```

**Response (404):**
```json
{
    "error": "Invalid username or password"
}
```

**Changes from Phase 1:**
- Now returns portfolio list instead of single portfolio data
- Returns user object with ID
- Sets active_portfolio_id in session
- Frontend should show portfolio landing page, not go directly to dashboard

---

### 2. POST /api/portfolio/logout
**Logout and revoke session token**

**Request:**
No body required (uses session cookie)

**Response:**
```json
{
    "success": true
}
```

**No changes from Phase 1**

---

### 3. GET /api/portfolio/details
**Get portfolio details for the active or specified portfolio**

**Request:**
```
GET /api/portfolio/details?portfolio_id=8ba82bd4-adba-4306-996d-3aa5aee63199
```

Query Parameters:
- `portfolio_id` (optional) - UUID of portfolio to fetch. If omitted, uses active portfolio from session.

**Response (200):**
```json
{
    "success": true,
    "portfolio": {
        "id": "8ba82bd4-adba-4306-996d-3aa5aee63199",
        "name": "Piotroski's F-Score",
        "positions": [
            {
                "ticker": "AAPL",
                "companyName": "Apple Inc.",
                "shares": 100,
                "purchasePrice": 150.00,
                "purchaseDate": "2024-12-01",
                "addedAt": "2024-12-01T10:30:00.000Z"
            }
        ],
        "created_at": "2025-12-24T08:00:00Z",
        "updated_at": "2025-12-24T10:00:00Z",
        "is_default": true
    }
}
```

**Response (401):**
```json
{
    "error": "Not authenticated"
}
```

**Response (404):**
```json
{
    "error": "Portfolio not found"
}
```

**Changes from Phase 1:**
- Now uses portfolio_id parameter instead of deriving from username
- Returns full portfolio object including ID and is_default flag
- Validates user owns the requested portfolio

---

### 4. POST /api/portfolio/save
**Save/update portfolio positions**

**Request:**
```json
{
    "positions": [
        {
            "ticker": "AAPL",
            "companyName": "Apple Inc.",
            "shares": 100,
            "purchasePrice": 150.00,
            "purchaseDate": "2024-12-01",
            "addedAt": "2024-12-01T10:30:00.000Z"
        }
    ],
    "portfolio_id": "8ba82bd4-adba-4306-996d-3aa5aee63199"
}
```

**Response (200):**
```json
{
    "success": true,
    "message": "Portfolio saved successfully"
}
```

**Response (401):**
```json
{
    "error": "Unauthorized - invalid or expired session"
}
```

**Response (500):**
```json
{
    "error": "Failed to save portfolio"
}
```

**Changes from Phase 1:**
- Now accepts `portfolio_id` parameter (optional, defaults to active portfolio)
- Validates user owns the portfolio before saving
- Enforces portfolio ownership checks

---

## New Endpoints

### 5. GET /api/user/portfolios
**List all portfolios for authenticated user**

**Request:**
No body required (uses session cookie)

**Response (200):**
```json
{
    "success": true,
    "portfolios": [
        {
            "id": "8ba82bd4-adba-4306-996d-3aa5aee63199",
            "name": "Piotroski's F-Score",
            "positions_count": 10,
            "created_at": "2025-12-24T08:00:00Z",
            "updated_at": "2025-12-24T10:00:00Z",
            "is_default": true
        },
        {
            "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "name": "Growth Portfolio",
            "positions_count": 5,
            "created_at": "2025-12-24T09:00:00Z",
            "updated_at": "2025-12-24T09:30:00Z",
            "is_default": false
        }
    ]
}
```

**Response (401):**
```json
{
    "error": "Not authenticated"
}
```

**Frontend Usage:**
- Call after login to get portfolio list
- Display portfolios in landing page
- Allow user to select a portfolio

---

### 6. POST /api/user/portfolios
**Create a new portfolio for authenticated user**

**Request:**
```json
{
    "portfolio_name": "Tech Stocks 2025"
}
```

**Response (200):**
```json
{
    "success": true,
    "portfolio": {
        "id": "b3c4d5e6-f7a8-9012-bcde-f3456789abcd",
        "name": "Tech Stocks 2025",
        "positions_count": 0,
        "created_at": "2025-12-24T11:00:00Z",
        "is_default": false
    }
}
```

**Response (400):**
```json
{
    "error": "Portfolio name is required"
}
```

**Response (400):**
```json
{
    "error": "Failed to create portfolio (limit may be reached)"
}
```

**Validation:**
- Portfolio name: 1-50 characters required
- Limit: Max 5 portfolios per user
- First portfolio created is automatically set as default

**Frontend Usage:**
- Call from "Create Portfolio" button
- Show form with portfolio name input
- Enforce 5 portfolio limit
- Refresh portfolio list after creation

---

### 7. PUT /api/user/portfolios/:portfolio_id/select
**Set a portfolio as active/default**

**Request:**
```
PUT /api/user/portfolios/8ba82bd4-adba-4306-996d-3aa5aee63199/select
```

No body required

**Response (200):**
```json
{
    "success": true,
    "active_portfolio_id": "8ba82bd4-adba-4306-996d-3aa5aee63199"
}
```

**Response (400):**
```json
{
    "error": "Failed to select portfolio"
}
```

**What Happens:**
- Sets `is_default = true` for selected portfolio
- Sets `is_default = false` for all other user portfolios
- Updates session's `active_portfolio_id`

**Frontend Usage:**
- Call when user clicks on portfolio in portfolio list
- Call when switching portfolios from dropdown
- Redirect to dashboard after selection

---

### 8. PUT /api/user/portfolios/:portfolio_id
**Rename a portfolio**

**Request:**
```
PUT /api/user/portfolios/8ba82bd4-adba-4306-996d-3aa5aee63199
{
    "new_name": "Value Stocks 2025"
}
```

**Response (200):**
```json
{
    "success": true,
    "portfolio": {
        "id": "8ba82bd4-adba-4306-996d-3aa5aee63199",
        "name": "Value Stocks 2025",
        "is_default": true
    }
}
```

**Response (400):**
```json
{
    "error": "New name is required"
}
```

**Validation:**
- Portfolio name: 1-50 characters required

**Frontend Usage:**
- Call from rename portfolio modal/form
- Show confirmation after successful rename
- Update portfolio list display

---

### 9. DELETE /api/user/portfolios/:portfolio_id
**Delete a portfolio**

**Request:**
```
DELETE /api/user/portfolios/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

No body required

**Response (200):**
```json
{
    "success": true,
    "message": "Portfolio deleted"
}
```

**Response (400):**
```json
{
    "error": "Failed to delete portfolio (may be last portfolio)"
}
```

**Validation:**
- Cannot delete user's only portfolio
- If deleted portfolio is default, another is automatically set as default

**Frontend Usage:**
- Call with confirmation dialog ("Are you sure you want to delete this portfolio?")
- Remove portfolio from list after deletion
- If deleted portfolio was active, switch to another portfolio

---

## Helper Functions Added

These functions power the new endpoints:

### authenticate_user(username, password)
Authenticates user against the `users` table. Returns `{user_id, username}` or `None`.

### get_user_portfolios(user_id)
Gets list of all portfolios for a user. Returns list of portfolio dicts.

### get_default_portfolio(user_id)
Gets the portfolio marked as `is_default = true`. Returns portfolio dict or `None`.

### get_portfolio_by_id(user_id, portfolio_id)
Gets a specific portfolio, verifying user owns it. Returns portfolio dict or `None`.

### create_portfolio_for_user(user_id, portfolio_name)
Creates new portfolio for user. Enforces 5 portfolio limit. Returns portfolio dict or `None`.

### update_portfolio_name(user_id, portfolio_id, new_name)
Updates portfolio name. Verifies ownership. Returns `True`/`False`.

### delete_portfolio(user_id, portfolio_id)
Deletes portfolio. Prevents deleting only portfolio. Auto-assigns new default if needed. Returns `True`/`False`.

### set_active_portfolio(user_id, portfolio_id)
Sets portfolio as default. Verifies ownership. Returns `True`/`False`.

---

## Session Management Updates

### create_session_token(user_id, username, active_portfolio_id=None)
**Old signature:** `create_session_token(username)`
**New signature:** `create_session_token(user_id, username, active_portfolio_id=None)`

Now stores user_id and active_portfolio_id in session.

### validate_session_token(token)
**Old return:** `username` (string) or `None`
**New return:** `{user_id, username, active_portfolio_id, ...}` (dict) or `None`

Now returns full session object for access to user_id and active_portfolio_id.

### Helper functions added:
- `get_session_user_id(token)` - Extract user_id from session
- `get_session_active_portfolio_id(token)` - Extract active_portfolio_id from session

---

## Backward Compatibility Notes

### Old Endpoints Still Working (Partially)
- `/api/portfolio/create` - Still works but needs refactoring for Phase 3
- `/api/portfolio/last-sync` - Still works with old authentication

### Migration Path
1. **Phase 2** (backend) - All endpoints refactored, old endpoints fallback supported
2. **Phase 3** (frontend) - Frontend updated to use new endpoints, new UI added
3. **Old UI** - Will continue to work with new endpoints during transition

### Fallback Behavior
- If `portfolio_id` not provided, uses `active_portfolio_id` from session
- If `active_portfolio_id` not set, returns error (prompts user to select portfolio)

---

## Error Handling

All endpoints follow consistent error response format:

```json
{
    "error": "Detailed error message"
}
```

Common HTTP Status Codes:
- `200` - Success
- `400` - Bad request (validation error)
- `401` - Unauthorized (not authenticated or session expired)
- `404` - Not found (portfolio doesn't exist)
- `500` - Server error

---

## Testing Checklist

### Authentication
- [ ] Login with valid credentials returns portfolios list
- [ ] Login with invalid credentials returns error
- [ ] Session token is created and stored as HTTP-only cookie

### Portfolio CRUD
- [ ] GET /api/user/portfolios returns all user portfolios
- [ ] POST /api/user/portfolios creates new portfolio
- [ ] PUT /api/user/portfolios/:id/select switches active portfolio
- [ ] PUT /api/user/portfolios/:id renames portfolio
- [ ] DELETE /api/user/portfolios/:id deletes portfolio (except last)

### Portfolio Operations
- [ ] GET /api/portfolio/details returns active portfolio by default
- [ ] GET /api/portfolio/details?portfolio_id=... returns specific portfolio
- [ ] POST /api/portfolio/save updates positions for active portfolio
- [ ] POST /api/portfolio/save with portfolio_id updates specific portfolio

### Validation
- [ ] Portfolio name length validation (1-50 chars)
- [ ] Portfolio limit enforcement (max 5)
- [ ] Cannot delete last portfolio
- [ ] Prevent accessing other users' portfolios

### Session Management
- [ ] Session token expires after 7 days
- [ ] Session token is invalidated on logout
- [ ] Active portfolio persists across requests
- [ ] Switching portfolios updates session

---

## Frontend Integration Guide

See `PHASE2_FRONTEND_INTEGRATION.md` for detailed frontend integration instructions.

---

## Files Modified

- `app.py` - All changes in Phase 2

## Files Created

- `PHASE2_API_DOCS.md` - This file
- `PHASE2_FRONTEND_INTEGRATION.md` - Frontend integration guide (TBD)

## Next Steps

Phase 3: Update frontend to:
1. Show portfolio landing page after login
2. Implement portfolio switcher dropdown
3. Add portfolio CRUD UI
