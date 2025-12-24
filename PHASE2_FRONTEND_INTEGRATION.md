# Phase 2: Frontend Integration Guide

This guide shows how the frontend (Phase 3) needs to integrate with the Phase 2 backend endpoints.

## Authentication Flow (Updated)

### Step 1: User Login
```javascript
// Old Flow: POST login → Get portfolio → Show dashboard
// New Flow: POST login → Get portfolio list → Show landing page → Select portfolio → Show dashboard

async function loginUser(username, password) {
    const response = await fetch('/api/portfolio/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'  // Include cookies
        body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
        return { error: 'Invalid username or password' };
    }

    const data = await response.json();

    // Store user data
    currentUser = data.user;  // { id, username }
    availablePortfolios = data.portfolios;  // [{ id, name, positions_count, is_default }, ...]
    activePortfolioId = data.active_portfolio_id;

    // Show portfolio landing page (NEW FLOW)
    showPortfolioLandingPage(availablePortfolios);

    return { success: true };
}
```

### Step 2: Select Portfolio (NEW)
```javascript
async function selectPortfolio(portfolioId) {
    const response = await fetch(`/api/user/portfolios/${portfolioId}/select`, {
        method: 'PUT',
        credentials: 'include'
    });

    if (!response.ok) {
        return { error: 'Failed to select portfolio' };
    }

    const data = await response.json();
    activePortfolioId = data.active_portfolio_id;

    // Load portfolio and show dashboard
    showDashboard(activePortfolioId);

    return { success: true };
}
```

---

## State Management (Updated)

### Old State:
```javascript
let currentUsername = null;
let currentPassword = null;
let portfolio = null;
```

### New State:
```javascript
// User authentication
let currentUser = null;  // { id, username }

// Portfolio management
let activePortfolioId = null;  // UUID of selected portfolio
let availablePortfolios = [];  // [{ id, name, positions_count, is_default }, ...]
let portfolio = null;  // Current portfolio data

// Keep for backward compatibility
let currentUsername = null;
```

---

## API Usage Examples

### 1. Get Portfolio List (NEW)

**When:** After user logs in and sees landing page, or when opening portfolio switcher

```javascript
async function fetchUserPortfolios() {
    const response = await fetch('/api/user/portfolios', {
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        console.error('Failed to fetch portfolios');
        return [];
    }

    const data = await response.json();
    return data.portfolios;  // [{ id, name, positions_count, is_default }, ...]
}
```

---

### 2. Get Portfolio Details

**When:** User selects a portfolio, or manually loading portfolio

```javascript
async function fetchPortfolioDetails(portfolioId) {
    const params = portfolioId ? `?portfolio_id=${portfolioId}` : '';
    const response = await fetch(`/api/portfolio/details${params}`, {
        method: 'GET',
        credentials: 'include'
    });

    if (!response.ok) {
        console.error('Failed to fetch portfolio details');
        return null;
    }

    const data = await response.json();
    return data.portfolio;  // { id, name, positions, created_at, updated_at, is_default }
}
```

---

### 3. Create Portfolio (NEW)

**When:** User clicks "Create Portfolio" button

```javascript
async function createNewPortfolio(portfolioName) {
    const response = await fetch('/api/user/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ portfolio_name: portfolioName })
    });

    if (!response.ok) {
        const error = await response.json();
        return { error: error.error };
    }

    const data = await response.json();

    // Add new portfolio to list
    availablePortfolios.push(data.portfolio);

    return { success: true, portfolio: data.portfolio };
}
```

---

### 4. Rename Portfolio (NEW)

**When:** User clicks "Rename" in portfolio menu

```javascript
async function renamePortfolio(portfolioId, newName) {
    const response = await fetch(`/api/user/portfolios/${portfolioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ new_name: newName })
    });

    if (!response.ok) {
        const error = await response.json();
        return { error: error.error };
    }

    const data = await response.json();

    // Update portfolio in list
    const index = availablePortfolios.findIndex(p => p.id === portfolioId);
    if (index !== -1) {
        availablePortfolios[index].name = data.portfolio.name;
    }

    return { success: true };
}
```

---

### 5. Delete Portfolio (NEW)

**When:** User clicks "Delete" in portfolio menu (with confirmation)

```javascript
async function deletePortfolio(portfolioId) {
    // Prevent deletion if only one portfolio
    if (availablePortfolios.length <= 1) {
        return { error: 'Cannot delete your only portfolio' };
    }

    const response = await fetch(`/api/user/portfolios/${portfolioId}`, {
        method: 'DELETE',
        credentials: 'include'
    });

    if (!response.ok) {
        const error = await response.json();
        return { error: error.error };
    }

    // Remove portfolio from list
    availablePortfolios = availablePortfolios.filter(p => p.id !== portfolioId);

    // If deleted portfolio was active, switch to another
    if (activePortfolioId === portfolioId) {
        const newActive = availablePortfolios[0];
        await selectPortfolio(newActive.id);
    }

    return { success: true };
}
```

---

### 6. Save Portfolio Positions

**When:** User adds/removes position or saves changes

```javascript
async function savePortfolioPositions(positions, portfolioId = null) {
    const portfolio_id = portfolioId || activePortfolioId;

    const response = await fetch('/api/portfolio/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            positions: positions,
            portfolio_id: portfolio_id  // Optional if using active portfolio
        })
    });

    if (!response.ok) {
        console.error('Failed to save portfolio');
        return false;
    }

    return true;
}
```

---

## UI Components Needed (Phase 3)

### 1. Portfolio Landing Page View
Shows when user logs in (if multiple portfolios available).

```html
<div id="portfolioLandingView" class="hidden">
    <h1>Your Portfolios</h1>
    <div class="portfolios-grid">
        <!-- Portfolio cards generated here -->
    </div>
    <button id="createPortfolioBtn" class="btn-primary">
        + Create New Portfolio
    </button>
</div>
```

Features:
- Display list of user portfolios
- Show portfolio name, position count, creation date
- Mark default portfolio with badge
- Click to select/view portfolio
- Each card has action buttons (rename, delete)

### 2. Create Portfolio Modal
Modal for creating new portfolio.

```html
<div id="createPortfolioModal" class="modal hidden">
    <div class="modal-content">
        <h2>Create New Portfolio</h2>
        <input id="portfolioNameInput" type="text"
            placeholder="Portfolio name" maxlength="50">
        <div class="char-counter">
            <span id="charCount">0</span>/50
        </div>
        <button id="createBtn" class="btn-primary">Create</button>
        <button id="cancelBtn" class="btn-secondary">Cancel</button>
    </div>
</div>
```

### 3. Rename Portfolio Modal
Modal for renaming portfolio.

```html
<div id="renamePortfolioModal" class="modal hidden">
    <div class="modal-content">
        <h2>Rename Portfolio</h2>
        <input id="renameInput" type="text"
            placeholder="New name" maxlength="50">
        <div class="char-counter">
            <span id="charCount">0</span>/50
        </div>
        <button id="renameBtn" class="btn-primary">Rename</button>
        <button id="cancelBtn" class="btn-secondary">Cancel</button>
    </div>
</div>
```

### 4. Portfolio Switcher Dropdown
Dropdown in top-right (user profile button).

```html
<div id="portfolioDropdown" class="dropdown hidden">
    <div class="dropdown-header">Portfolios</div>
    <div class="portfolios-list">
        <!-- Portfolio items with radio buttons -->
        <div class="portfolio-item" data-id="uuid">
            <input type="radio" name="portfolio" value="uuid">
            <span>Portfolio Name</span>
            <span class="badge">5 positions</span>
            <div class="actions">
                <button class="btn-rename">✎</button>
                <button class="btn-delete">✕</button>
            </div>
        </div>
    </div>
    <hr>
    <button id="createPortfolioFromMenu" class="btn-link">
        + Create Portfolio
    </button>
    <hr>
    <button id="logoutBtn" class="btn-link">Logout</button>
</div>
```

---

## Event Handlers (Phase 3)

```javascript
// Portfolio selection
document.addEventListener('click', (e) => {
    if (e.target.matches('.portfolio-item')) {
        const portfolioId = e.target.dataset.id;
        selectPortfolio(portfolioId);
    }
});

// Create portfolio
document.getElementById('createPortfolioBtn').addEventListener('click', () => {
    showCreatePortfolioModal();
});

document.getElementById('createBtn').addEventListener('click', async () => {
    const name = document.getElementById('portfolioNameInput').value;
    const result = await createNewPortfolio(name);
    if (result.success) {
        hideCreatePortfolioModal();
        refreshPortfolioList();
    } else {
        showError(result.error);
    }
});

// Rename portfolio
document.addEventListener('click', (e) => {
    if (e.target.matches('.btn-rename')) {
        const portfolioId = e.target.closest('.portfolio-item').dataset.id;
        const name = e.target.closest('.portfolio-item')
            .querySelector('span').textContent;
        showRenameModal(portfolioId, name);
    }
});

document.getElementById('renameBtn').addEventListener('click', async () => {
    const portfolioId = currentRenamingPortfolioId;
    const newName = document.getElementById('renameInput').value;
    const result = await renamePortfolio(portfolioId, newName);
    if (result.success) {
        hideRenameModal();
        refreshPortfolioList();
    } else {
        showError(result.error);
    }
});

// Delete portfolio
document.addEventListener('click', (e) => {
    if (e.target.matches('.btn-delete')) {
        const portfolioId = e.target.closest('.portfolio-item').dataset.id;
        if (confirm('Delete this portfolio? This cannot be undone.')) {
            deletePortfolio(portfolioId);
        }
    }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/portfolio/logout', {
        method: 'POST',
        credentials: 'include'
    });
    // Clear state and show login view
    location.reload();
});
```

---

## Application Flow (Phase 3)

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOGIN PAGE (landingView)                     │
│            [Username] [Password] [Login] [Register]             │
└─────────────────────┬───────────────────────────────────────────┘
                      │ POST /api/portfolio/login
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              PORTFOLIO LANDING PAGE (portfolioLandingView)       │
│                    Your Portfolios                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Portfolio 1  │  Portfolio 2  │  Portfolio 3  │ + Create│   │
│  └─────────────────────────────────────────────────────────┘   │
│                 Click to select portfolio                       │
└────────────────┬────────────────────────────────────────────────┘
                 │ PUT /api/user/portfolios/{id}/select
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DASHBOARD (portfolioView)                    │
│  [Portfolio Name ▼]  [Total Value] [Positions] [Performance]   │
│                                                                 │
│  [Stock] [Shares] [Price] [Gain/Loss] [Remove]                 │
│  ─────────────────────────────────────────────────────────────  │
│  AAPL    100      $150    +$2,500    [Remove]                   │
│  MSFT    50       $300    -$1,000    [Remove]                   │
│  ...                                                             │
│  [+ Add Position]                                               │
│                                                                 │
│  Profile Icon ▼                                                 │
│    ├─ Piotroski's F-Score (default) ⦿                          │
│    ├─ Growth Portfolio           ○ [rename] [delete]           │
│    ├─ [+ Create Portfolio]                                      │
│    └─ [Logout]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram

```
Frontend                           Backend                       Database
┌────────────┐
│  Login UI  │ ─ POST /api/portfolio/login ─▶ ┌─────────────┐
└────────────┘                                 │ Supabase    │
                                              │ users table │
                                              └──────┬──────┘
                                                     │
                                                     ▼
┌──────────────────────┐                     ┌─────────────┐
│ Portfolio Landing    │◀─ JSON response ─── │ Return user │
│ (list portfolios)    │                     │ + portfolio │
└──────────┬───────────┘                     │ list        │
           │                                 └─────────────┘
           │ PUT /api/user/portfolios/:id/select
           │
           ▼
┌──────────────────────┐                     ┌─────────────┐
│ Dashboard            │◀─ GET /api/portfolio/details ───│ Query      │
│ (show portfolio)     │                     │ portfolio  │
└──────────┬───────────┘                     │ data       │
           │                                 └─────────────┘
           │ POST /api/portfolio/save
           │
           ▼
        [Saved ✓]
```

---

## API Error Handling (Phase 3)

```javascript
async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, {
            ...options,
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Session expired or not authenticated
                showLoginPage();
                return { error: 'Session expired. Please login again.' };
            }

            const error = await response.json();
            return { error: error.error || 'Unknown error' };
        }

        const data = await response.json();
        return data;

    } catch (err) {
        console.error('API Error:', err);
        return { error: 'Network error. Please try again.' };
    }
}
```

---

## Validation Rules (Frontend should enforce)

### Portfolio Name:
- Required
- 1-50 characters
- No validation (all characters allowed)

### Portfolio Limit:
- Max 5 portfolios per user
- Show warning when approaching limit
- Disable "Create" button when at limit

### Position Operations:
- Still saved to active portfolio
- Can be saved to specific portfolio via `portfolio_id` parameter

---

## Breaking Changes from Old Frontend

| Old Flow | New Flow |
|----------|----------|
| Login → Dashboard | Login → Landing → Dashboard |
| Single portfolio view | Multiple portfolio view |
| No portfolio list | Portfolio list with selector |
| No create portfolio | Create/rename/delete portfolio UI |
| No portfolio switcher | Dropdown switcher in profile |

---

## Backward Compatibility Notes

### Old API Still Works:
- `POST /api/portfolio/login` (returns new format, but still works)
- `GET /api/portfolio/details` (now with optional portfolio_id)
- `POST /api/portfolio/save` (now with optional portfolio_id)
- `POST /api/portfolio/logout` (unchanged)

### Migration Path:
1. Deploy Phase 2 backend (old frontend still works)
2. Update frontend to Phase 3
3. Old frontend will show portfolio landing page automatically

---

## Testing Scenarios (Phase 3)

### Scenario 1: New User with One Portfolio
1. Login with credentials
2. See portfolio landing page with one portfolio
3. Click portfolio → Dashboard
4. See portfolio data loaded
5. Can create new portfolio (limit 5)

### Scenario 2: Existing User with Multiple Portfolios
1. Login with credentials
2. See portfolio landing page with 2+ portfolios
3. Can click between portfolios
4. Can rename portfolio
5. Can delete non-default portfolio
6. Can create new portfolio (up to limit)

### Scenario 3: Portfolio Switcher
1. On dashboard with Portfolio A active
2. Click profile icon (top-right)
3. See portfolio dropdown with radio buttons
4. Click Portfolio B → Dashboard reloads with Portfolio B data
5. All operations now on Portfolio B

### Scenario 4: Add Position with Multiple Portfolios
1. On dashboard with Portfolio A active
2. Add new position
3. Position saved to Portfolio A
4. Switch to Portfolio B
5. Position not visible in Portfolio B
6. Switch back to Portfolio A
7. Position still there ✓

---

## Performance Considerations

### Caching:
- Cache `availablePortfolios` array in-memory
- Refresh after create/delete/rename operations
- Don't fetch on every portfolio switcher open

### Lazy Loading:
- Load portfolio positions on-demand (GET /api/portfolio/details)
- Don't load all portfolio data when showing landing page
- Load price data async (doesn't block UI)

### Optimization:
- Batch portfolio updates if possible
- Don't refresh entire list if only renaming
- Debounce rapid portfolio switches

---

## Summary

Phase 3 Frontend Requirements:
1. ✅ Update login flow to show landing page
2. ✅ Create portfolio landing page view
3. ✅ Add portfolio CRUD modals
4. ✅ Implement portfolio switcher dropdown
5. ✅ Update state management for multi-portfolio
6. ✅ Update all API calls to use new endpoints
7. ✅ Implement proper error handling
8. ✅ Add validation and user feedback

**Backend is ready!** All Phase 2 endpoints are working and tested.

Proceed to Phase 3 when ready to implement the frontend.
