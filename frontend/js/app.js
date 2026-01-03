// API URL configuration - supports both development and production
const API_URL = (function() {
    // In development: backend runs on port 5001, frontend on different port
    // In production: frontend and backend on same domain
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // Development: explicitly point to port 5001
        return `${protocol}//localhost:5001/api`;
    } else {
        // Production: use same domain (relative path)
        return '/api';
    }
})();

// Handle any chrome extension runtime messages to prevent async channel errors
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Respond to any message to prevent "message channel closed" error
        sendResponse({ received: true });
        return false; // Don't indicate async response
    });
}

// Session authentication storage
// Credentials are now managed via HTTP-only cookies set by the backend
// Frontend no longer stores passwords - they're only in memory during the current session
let currentUsername = null;
let currentPassword = null;

// PHASE 3: Multi-portfolio support - New state variables
let currentUser = null;  // {id, username}
let activePortfolioId = null;  // UUID of selected portfolio
let availablePortfolios = [];  // [{id, name, positions_count, is_default, created_at}, ...]

// Portfolio data structure
let portfolio = {
    name: '',
    positions: [],
    createdAt: null
};

// Historical data cache structure
let historicalCache = {};

// Store enriched positions globally for use in other functions
let enrichedPositions = [];

// Portfolio landing page sorting state
let portfolioSortColumn = 'name';  // Default sort by portfolio name
let portfolioSortDirection = 'asc';  // 'asc' or 'desc'

// ========================================
// RATE LIMIT BACKOFF WRAPPER
// ========================================
// Wraps fetch() with exponential backoff for 429 (Too Many Requests) errors
async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
    let delay = 1000; // Start with 1 second

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            // If rate limited, wait and retry
            if (response.status === 429) {
                if (attempt < maxRetries) {
                    console.warn(`[RATE LIMIT] 429 on ${url.substring(0, 50)}... Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff: 1s, 2s, 4s, 8s
                    continue;
                } else {
                    console.error(`[RATE LIMIT] 429 on ${url.substring(0, 50)}... Max retries exceeded`);
                    return response; // Return 429 response to caller
                }
            }

            // Success or other error - return immediately
            return response;
        } catch (error) {
            // Network error - retry with backoff
            if (attempt < maxRetries) {
                console.warn(`[NETWORK] Error on ${url.substring(0, 50)}... Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            } else {
                throw error;
            }
        }
    }
}

// ========================================
// PORTFOLIO CACHE CLASS - Unified cache system
// ========================================
// Manages both in-memory and localStorage caches atomically
// Ensures synchronization and validates state on every operation
class PortfolioCache {
    constructor() {
        this.storageKey = 'portfolioHistoricalCache';
        this.inMemory = {};
        this.loadFromStorage();
    }

    // Load from localStorage and initialize in-memory cache
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            this.inMemory = stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.warn('[CACHE] Error loading from storage:', e);
            this.inMemory = {};
        }
    }

    // Save in-memory cache to localStorage
    saveToStorage() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.inMemory));
        } catch (e) {
            console.error('[CACHE] Error saving to storage:', e);
        }
    }

    // Get active ticker set from current portfolio
    getActiveTickers() {
        return new Set(portfolio.positions.map(p => p.ticker));
    }

    // Add or update a ticker in cache (atomic operation)
    set(ticker, data) {
        this.inMemory[ticker] = data;
        this.saveToStorage();
    }

    // Get ticker data from cache
    get(ticker) {
        return this.inMemory[ticker] || null;
    }

    // Remove a ticker from cache (atomic operation)
    remove(ticker) {
        if (this.inMemory[ticker]) {
            delete this.inMemory[ticker];
            this.saveToStorage();
            console.log(`[CACHE] Removed ${ticker} from both in-memory and localStorage`);
        }
    }

    // Get all cache entries
    getAll() {
        return { ...this.inMemory };
    }

    // Validate and clean cache against active portfolio
    // Returns true if cleanup was needed
    validateAndClean() {
        const activeTickers = this.getActiveTickers();
        const cachedTickers = Object.keys(this.inMemory);
        let needsCleanup = false;

        for (const ticker of cachedTickers) {
            if (!activeTickers.has(ticker)) {
                console.log(`[CACHE] Cleaning stale ticker: ${ticker}`);
                delete this.inMemory[ticker];
                needsCleanup = true;
            }
        }

        if (needsCleanup) {
            this.saveToStorage();
        }

        return needsCleanup;
    }

    // Get cache statistics
    getStats() {
        const cachedTickers = Object.keys(this.inMemory).length;
        const activeTickers = this.getActiveTickers().size;
        return {
            cachedTickers,
            activeTickers,
            isValid: cachedTickers === activeTickers,
            staleEntries: cachedTickers - activeTickers
        };
    }

    // Force reset from storage
    resetFromStorage() {
        this.loadFromStorage();
        this.validateAndClean();
    }
}

// Create global cache instance
let portfolioCache = new PortfolioCache();

// Cache configuration
const CACHE_CONFIG = {
    storageKey: 'stock_historical_cache_v1',
    expirationHours: 24,
    maxCacheSize: 5 * 1024 * 1024 // 5MB
};

// Cache management functions
function getCacheStats() {
    try {
        const cacheStr = localStorage.getItem(CACHE_CONFIG.storageKey);
        if (!cacheStr) return { tickers: 0, size: 0, lastUpdate: null };

        const cache = JSON.parse(cacheStr);
        const size = new Blob([cacheStr]).size;
        const tickers = Object.keys(cache.data || {}).length;

        return {
            tickers: tickers,
            size: (size / 1024).toFixed(2) + ' KB',
            lastUpdate: cache.lastUpdate || null,
            entries: cache.data ? Object.keys(cache.data).length : 0
        };
    } catch (error) {
        console.error('Error getting cache stats:', error);
        return { tickers: 0, size: 0, lastUpdate: null, error: true };
    }
}

function loadCacheFromStorage() {
    try {
        const cacheStr = localStorage.getItem(CACHE_CONFIG.storageKey);
        if (!cacheStr) return {};

        const cache = JSON.parse(cacheStr);

        // Check if cache has expired
        if (cache.lastUpdate) {
            const lastUpdateTime = new Date(cache.lastUpdate).getTime();
            const nowTime = new Date().getTime();
            const hoursElapsed = (nowTime - lastUpdateTime) / (1000 * 60 * 60);

            if (hoursElapsed > CACHE_CONFIG.expirationHours) {
                console.log('Cache expired, clearing...');
                clearCache();
                return {};
            }
        }

        return cache.data || {};
    } catch (error) {
        console.error('Error loading cache from storage:', error);
        return {};
    }
}

function saveCacheToStorage(cacheData) {
    try {
        const cacheObj = {
            data: cacheData,
            lastUpdate: new Date().toISOString(),
            version: 1
        };

        const cacheStr = JSON.stringify(cacheObj);
        const size = new Blob([cacheStr]).size;

        if (size > CACHE_CONFIG.maxCacheSize) {
            console.warn('Cache size exceeds limit, clearing old entries...');
            // Remove oldest entries
            const entries = Object.entries(cacheData).sort((a, b) =>
                (a[1].lastUpdated || 0) - (b[1].lastUpdated || 0)
            );
            const newCache = {};
            for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
                newCache[entries[i][0]] = entries[i][1];
            }
            saveCacheToStorage(newCache);
            return;
        }

        localStorage.setItem(CACHE_CONFIG.storageKey, cacheStr);
        console.log('Cache saved. Stats:', getCacheStats());
    } catch (error) {
        console.error('Error saving cache to storage:', error);
    }
}

function getCachedHistoricalPrices(ticker) {
    try {
        const cache = loadCacheFromStorage();
        if (cache[ticker]) {
            return cache[ticker];
        }
        return null;
    } catch (error) {
        console.error('Error getting cached prices for', ticker, error);
        return null;
    }
}

function setCachedHistoricalPrices(ticker, priceData) {
    try {
        // Validate that this ticker is in the active portfolio before caching
        const activeTickers = new Set(portfolio.positions.map(p => p.ticker));
        if (!activeTickers.has(ticker)) {
            console.warn(`[CACHE] Ignoring cache update for ${ticker} - not in active portfolio`);
            return;
        }

        // Use ONLY the unified portfolio cache system
        // This ensures single source of truth
        const cacheData = {
            prices: priceData,
            lastUpdated: Date.now(),
            timestamp: new Date().toISOString()
        };

        // Write to unified cache system ONLY
        portfolioCache.set(ticker, cacheData);

        console.log(`[CACHE] Updated ${ticker} in unified cache system`);
    } catch (error) {
        console.error('Error setting cached prices for', ticker, error);
    }
}

function clearCache() {
    try {
        localStorage.removeItem(CACHE_CONFIG.storageKey);
        localStorage.removeItem('portfolio_dashboard_cache_v1');
        historicalCache = {};
        console.log('Cache cleared successfully');
    } catch (error) {
        console.error('Error clearing cache:', error);
    }
}

// ========================================
// DASHBOARD CACHE FUNCTIONS
// ========================================
// Cache complete dashboard data (enriched positions + chart history) for instant loading

const DASHBOARD_CACHE_KEY = 'portfolio_dashboard_cache_v1';
const DASHBOARD_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

function getDashboardCacheKey(portfolioId) {
    // Create a unique cache key per portfolio to prevent cross-portfolio cache contamination
    return `${DASHBOARD_CACHE_KEY}_${portfolioId}`;
}

function getCachedDashboardData(portfolioId) {
    try {
        if (!portfolioId) {
            console.log('❌ [CACHE] No portfolio ID provided - cannot validate cache');
            return null;
        }

        const cacheKey = getDashboardCacheKey(portfolioId);
        const cached = localStorage.getItem(cacheKey);
        if (!cached) {
            console.log('💾 [CACHE] No cache found for this portfolio');
            return null;
        }

        const data = JSON.parse(cached);
        const cacheAge = Date.now() - data.timestamp;

        // Validate cache has correct number of positions
        if (data.enrichedPositions.length !== data.positionCount) {
            console.log(`❌ [CACHE] Cache invalid: has ${data.enrichedPositions.length} positions but portfolio has ${data.positionCount}`);
            localStorage.removeItem(cacheKey);
            return null;
        }

        // Use cache if less than 24 hours old
        if (cacheAge < DASHBOARD_CACHE_MAX_AGE) {
            const ageMinutes = (cacheAge / 1000 / 60).toFixed(0);
            console.log(`✅ [CACHE] Cache valid: ${ageMinutes}m old, ${data.enrichedPositions.length} positions, ${data.chartHistory.length} chart points`);
            return {
                enrichedPositions: data.enrichedPositions,
                chartHistory: data.chartHistory
            };
        }

        console.log('❌ [CACHE] Cache expired (>24 hours old)');
        return null;
    } catch (error) {
        console.error('Error reading dashboard cache:', error);
        return null;
    }
}

function cacheDashboardData(portfolioId, enrichedPositions, chartHistory) {
    try {
        if (!portfolioId) {
            console.warn('⚠️ [CACHE] Cannot cache without portfolio ID');
            return;
        }

        const cacheData = {
            portfolioId: portfolioId,
            positionCount: enrichedPositions.length,
            enrichedPositions: enrichedPositions,
            chartHistory: chartHistory,
            timestamp: Date.now()
        };
        const cacheStr = JSON.stringify(cacheData);
        const size = new Blob([cacheStr]).size;

        const cacheKey = getDashboardCacheKey(portfolioId);
        localStorage.setItem(cacheKey, cacheStr);
        console.log(`💾 [CACHE] Dashboard cached: ${enrichedPositions.length} positions, ${chartHistory.length} chart points (${(size / 1024).toFixed(1)}KB)`);
    } catch (error) {
        console.error('Error caching dashboard data:', error);
        // If quota exceeded, try clearing old cache
        if (error.name === 'QuotaExceededError') {
            console.warn('⚠️ Storage quota exceeded - clearing old dashboard cache');
            const cacheKey = getDashboardCacheKey(portfolioId);
            localStorage.removeItem(cacheKey);
        }
    }
}

function renderDashboardFromData(enrichedPositions, chartHistory, constantTotalInvested) {
    // Log render timing for cache debugging
    const renderTimestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

    // Ensure chart container is visible and no-data message is hidden
    const chartContainer = document.getElementById('chartContainer');
    const chartNoData = document.getElementById('chartNoData');
    if (chartContainer) {
        chartContainer.style.display = 'block';
    }
    if (chartNoData) {
        chartNoData.style.display = 'none';
    }

    // Render positions table
    const tbody = document.getElementById('positionsTableBody');
    const htmlRows = enrichedPositions.map((enriched, index) => {
        const gainLoss = enriched.gainLoss;
        const gainLossPercent = enriched.gainLossPercent;
        const rowClass = gainLoss >= 0 ? 'gain-positive' : 'gain-negative';

        return `
            <tr data-ticker="${enriched.ticker}">
                <td>
                    <div class="ticker-cell">${enriched.ticker}</div>
                    <div class="company-name-cell">${enriched.companyName}</div>
                </td>
                <td>${(enriched.shares || 0).toLocaleString()}</td>
                <td>${formatCurrency(enriched.purchasePrice)}</td>
                <td>${formatCurrency(enriched.currentPrice)}</td>
                <td>${formatCurrency(enriched.positionValue)}</td>
                <td class="${rowClass}">
                    ${(gainLoss >= 0 ? '+' : '-') + formatCurrency(Math.abs(gainLoss))}
                </td>
                <td class="${rowClass}">
                    ${(gainLossPercent >= 0 ? '+' : '') + gainLossPercent.toFixed(2) + '%'}
                </td>
                <td>${formatDate(enriched.purchaseDate)}</td>
                <td class="actions-cell">
                    <button class="btn-action btn-edit" onclick="editPosition(${index})">Edit</button>
                    <button class="btn-action btn-delete" onclick="deletePosition(${index})">Delete</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = htmlRows;

    // Calculate and display metrics
    const totalValue = enrichedPositions.reduce((sum, pos) => sum + pos.positionValue, 0);
    const totalGainLoss = totalValue - constantTotalInvested;
    const totalReturn = constantTotalInvested > 0 ? (totalGainLoss / constantTotalInvested) * 100 : 0;

    document.getElementById('totalInvestedHeader').textContent = formatCurrency(constantTotalInvested);
    document.getElementById('totalValueHeader').textContent = formatCurrency(totalValue);

    const gainLossClass = totalGainLoss >= 0 ? 'metric-value positive' : 'metric-value negative';
    document.getElementById('totalGainLossHeader').textContent = (totalGainLoss >= 0 ? '+' : '-') + formatCurrency(Math.abs(totalGainLoss));
    document.getElementById('totalGainLossHeader').className = gainLossClass;

    const returnSign = totalReturn >= 0 ? '+' : '';
    document.getElementById('totalReturnHeader').textContent = returnSign + totalReturn.toFixed(2) + '%';
    document.getElementById('totalReturnHeader').className = totalReturn >= 0 ? 'metric-value positive' : 'metric-value negative';

    // Render chart
    renderPortfolioChartWithHistory(chartHistory);

    // Update subtitle
    document.getElementById('portfolioSubtitle').textContent = `${enrichedPositions.length} position${enrichedPositions.length !== 1 ? 's' : ''}`;

    console.log(`[${renderTimestamp}] ✅ Dashboard rendered: ${enrichedPositions.length} positions, ${chartHistory.length} chart points, value=$${totalValue.toFixed(2)}, invested=$${constantTotalInvested.toFixed(2)}, return=${totalReturn.toFixed(2)}%`);
}

// Load cache from storage on startup
const storageCacheData = loadCacheFromStorage();
Object.assign(historicalCache, storageCacheData);

// Track if we're editing a position
let editingPositionIndex = -1;

// Table sorting state
let sortState = {
    column: null,
    direction: 'asc' // 'asc' or 'desc'
};

// Global abort controller for cancellable fetch requests
let globalAbortController = new AbortController();

// Cleanup function for memory leak prevention
function cleanupSession() {
    console.log('Cleaning up session...');

    // Stop real-time polling
    stopRealTimePolling();

    // Clear global state
    portfolio = {
        name: '',
        positions: [],
        createdAt: null
    };
    enrichedPositions = [];
    historicalCache = {};
    editingPositionIndex = -1;

    // Clear in-flight fetch requests
    globalAbortController.abort();
    globalAbortController = new AbortController();

    // Clear current session (credentials are in HTTP-only cookies now, managed by backend)
    currentUsername = null;
    currentPassword = null;

    // Destroy chart if it exists
    if (portfolioChart) {
        portfolioChart.destroy();
        portfolioChart = null;
    }

    console.log('Session cleanup complete');
}

// View navigation functions
function showLanding() {
    cleanupSession();

    // Reset landingView to original state (in case it was modified by showPortfolioLandingPage)
    const landingView = document.getElementById('landingView');
    landingView.innerHTML = `
        <div class="setup-card">
            <div class="setup-title">Portfolio Tracker</div>
            <div class="setup-subtitle">Access your portfolio from anywhere with a 4-digit password</div>

            <!-- replaced full-width stacked buttons with horizontal hero actions -->
            <div class="hero-actions">
                <button id="createPortfolioBtn" class="btn">Create new portfolio</button>
                <button id="findPortfolioBtn" class="btn" style="background:#1e3a8a;">Find my portfolio</button>
            </div>
        </div>
    `;

    showView('landingView');
    updateProfileButtonVisibility();
    attachButtonListeners();
}

function showCreateView() {
    console.log('showCreateView called');
    showView('setupView');
}

function showLoginView() {
    console.log('showLoginView called');
    showView('loginView');
}

// Show/hide user profile button based on authentication state
function updateProfileButtonVisibility() {
    const userProfileBtn = document.getElementById('userProfileBtn');
    if (currentUsername) {
        // User has a portfolio loaded/created
        userProfileBtn.classList.remove('hidden');
    } else {
        // User is not authenticated
        userProfileBtn.classList.add('hidden');
    }
}

// Password validation function
function validatePasswordStrength(password) {
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        lowercase: /[a-z]/.test(password),
        number: /\d/.test(password),
        special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    };

    const met = Object.values(requirements).filter(Boolean).length;
    return {
        isValid: Object.values(requirements).every(Boolean),
        strength: met,
        requirements
    };
}

// PHASE 2: Create portfolio on server (registration endpoint - now creates user and first portfolio)
async function createPortfolio(username, name, password) {
    const response = await fetch(`${API_URL}/portfolio/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',  // Include HTTP-only cookies
        body: JSON.stringify({ username, name, password }),
        signal: globalAbortController.signal
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Failed to create portfolio');
    }

    if (data.success) {
        // PHASE 2: Handle new multi-portfolio response format
        currentUsername = username;
        currentUser = data.user;  // {id, username}
        activePortfolioId = data.active_portfolio_id;
        availablePortfolios = data.portfolios;  // Array of portfolio objects

        // Store session token if provided
        if (data.token) {
            sessionStorage.setItem('session_token', data.token);
        }

        // For backward compatibility, set portfolio object
        portfolio = {
            id: activePortfolioId,
            name: name,
            positions: []
        };

        return true;
    }
    return false;
}

// PHASE 3: Login to portfolio (updated for multi-portfolio support)
async function loginPortfolio(username, password) {
    const response = await fetch(`${API_URL}/portfolio/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',  // Include cookies
        body: JSON.stringify({ username, password }),
        signal: globalAbortController.signal
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Failed to load portfolio');
    }

    if (data.success) {
        // PHASE 3: Store multi-portfolio data
        currentUser = data.user;  // {id, username}
        currentUsername = username;  // Keep for backward compatibility
        currentPassword = null;  // Don't store password
        availablePortfolios = data.portfolios;  // List of all portfolios
        activePortfolioId = data.active_portfolio_id;  // Selected portfolio

        // Debug: Log portfolio data
        console.log('[DEBUG] Received portfolios from login:', availablePortfolios.map(p => ({name: p.name, created_at: p.created_at})));

        // Always show the main dashboard (landing page) after login
        // This displays all portfolios as a summary, regardless of how many exist
        showPortfolioLandingPage();
        return true;
    }
    return false;
}

// PHASE 3: Save portfolio positions to server (updated for multi-portfolio)
async function savePortfolioToServer() {
    if (!currentUsername) {
        console.warn('[SAVE] No active session, cannot save to server');
        return false;
    }

    try {
        // Calculate current return percentage for caching
        const totalValue = enrichedPositions.reduce((sum, pos) => sum + pos.positionValue, 0);
        const constantTotalInvested = portfolio.positions.reduce((sum, pos) => sum + (pos.shares * pos.purchasePrice), 0);
        const totalGainLoss = totalValue - constantTotalInvested;
        const returnPct = constantTotalInvested > 0 ? (totalGainLoss / constantTotalInvested) * 100 : 0;

        console.log(`[SAVE] Sending POST to /api/portfolio/save with ${portfolio.positions.length} positions, return=${returnPct.toFixed(2)}%`);
        const response = await fetch(`${API_URL}/portfolio/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                positions: portfolio.positions,
                portfolio_id: activePortfolioId,  // PHASE 3: Include portfolio ID
                cached_return_percentage: returnPct  // PHASE 4: Cache the latest return for switcher
            }),
            signal: globalAbortController.signal
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[SAVE] Failed to save portfolio:', data.error);
            return false;
        }
        console.log('[SAVE] Portfolio saved successfully on server');

        // After saving positions, fetch fresh prices and update metrics
        console.log('[SAVE] Fetching fresh prices to update metrics...');
        try {
            // Fetch fresh prices for all positions
            const freshEnrichedPositions = [];
            for (const position of portfolio.positions) {
                const ticker = position.ticker;
                const priceResponse = await fetch(`${API_URL}/stock/${ticker}/instant`, {
                    credentials: 'include',
                    signal: globalAbortController.signal
                });

                if (priceResponse.ok) {
                    const priceData = await priceResponse.json();
                    const currentPrice = priceData.price || position.purchasePrice;
                    freshEnrichedPositions.push({
                        ...position,
                        current_price: currentPrice,
                        positionValue: position.shares * currentPrice
                    });
                } else {
                    // Fallback to purchase price if fetch fails
                    freshEnrichedPositions.push({
                        ...position,
                        current_price: position.purchasePrice,
                        positionValue: position.shares * position.purchasePrice
                    });
                }
            }

            // Calculate metrics from fresh prices
            const freshTotalValue = freshEnrichedPositions.reduce((sum, pos) => sum + pos.positionValue, 0);
            const freshTotalInvested = portfolio.positions.reduce((sum, pos) => sum + (pos.shares * pos.purchasePrice), 0);
            const freshGainLoss = freshTotalValue - freshTotalInvested;
            const freshReturnPct = freshTotalInvested > 0 ? (freshGainLoss / freshTotalInvested) * 100 : 0;

            // Save the fresh metrics to backend
            console.log(`[SAVE-METRICS] Saving updated metrics after position change`);
            await fetch(`${API_URL}/portfolio/save-metrics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    portfolio_id: activePortfolioId,
                    total_value: freshTotalValue,
                    total_invested: freshTotalInvested,
                    gain_loss: freshGainLoss,
                    return_percentage: freshReturnPct
                })
            }).catch(err => console.warn('[SAVE-METRICS] Failed to save metrics:', err));

            // Update availablePortfolios with fresh metrics
            const portfolioIndex = availablePortfolios.findIndex(p => p.id === activePortfolioId);
            if (portfolioIndex !== -1) {
                availablePortfolios[portfolioIndex].positions_count = portfolio.positions.length;
                availablePortfolios[portfolioIndex].total_invested = freshTotalInvested;
                availablePortfolios[portfolioIndex].total_value = freshTotalValue;
                availablePortfolios[portfolioIndex].gain_loss = freshGainLoss;
                availablePortfolios[portfolioIndex].return_percentage = freshReturnPct;
            }

            // Recalculate aggregate and save
            const freshAggregate = calculateAggregatedMetrics();
            saveAggregateMetricsToDatabase(freshAggregate);

        } catch (error) {
            console.warn('[SAVE-METRICS] Error fetching fresh prices after save:', error);

            // Fallback: use cached values
            const portfolioIndex = availablePortfolios.findIndex(p => p.id === activePortfolioId);
            if (portfolioIndex !== -1) {
                availablePortfolios[portfolioIndex].positions_count = portfolio.positions.length;
                availablePortfolios[portfolioIndex].total_invested = constantTotalInvested;
                availablePortfolios[portfolioIndex].total_value = totalValue;
                availablePortfolios[portfolioIndex].gain_loss = totalGainLoss;
                availablePortfolios[portfolioIndex].return_percentage = returnPct;
            }
        }

        return data.success;
    } catch (error) {
        console.error('Error saving portfolio:', error);
        return false;
    }
}

// PHASE 3: Select a portfolio and load its data
async function selectPortfolio(portfolioId) {
    try {
        // Fetch portfolio details from backend
        const response = await fetch(`${API_URL}/portfolio/details?portfolio_id=${portfolioId}`, {
            method: 'GET',
            credentials: 'include',
            signal: globalAbortController.signal
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load portfolio');
        }

        if (data.success) {
            // Update active portfolio
            activePortfolioId = portfolioId;

            // Load portfolio data
            portfolio = {
                name: data.portfolio.name,
                positions: data.portfolio.positions || [],
                createdAt: data.portfolio.created_at,
                id: data.portfolio.id,
                isDefault: data.portfolio.is_default
            };

            console.log(`✓ Selected portfolio: ${portfolio.name} (${portfolio.positions.length} positions)`);

            // Show dashboard and render it (don't await - background fetch should be async)
            showView('portfolioView');
            renderPortfolioDashboard(); // Fire and forget - cache renders instantly, background fetch happens asynchronously

            return true;
        }
    } catch (error) {
        console.error('Error selecting portfolio:', error);
        alert('Failed to load portfolio. Please try again.');
        return false;
    }
}

// Refresh portfolio data with animation feedback
async function refreshPortfolioData() {
    try {
        const refreshIcon = document.querySelector('.portfolio-header .refresh-icon');
        if (refreshIcon) {
            refreshIcon.classList.add('refreshing');
        }

        if (activePortfolioId) {
            await selectPortfolio(activePortfolioId);
            console.log('✓ Portfolio data refreshed');
        }
    } catch (error) {
        console.error('Error refreshing portfolio data:', error);
        alert('Failed to refresh portfolio data. Please try again.');
    } finally {
        const refreshIcon = document.querySelector('.portfolio-header .refresh-icon');
        if (refreshIcon) {
            refreshIcon.classList.remove('refreshing');
        }
    }
}

// Helper function to calculate aggregated portfolio metrics from cached data
function calculateAggregatedMetrics() {
    // Always calculate from individual portfolios to ensure we capture the latest updates
    // Don't use cached aggregate as it becomes stale after portfolio changes
    let totalValue = 0;
    let totalInvested = 0;
    let totalGainLoss = 0;

    availablePortfolios.forEach(portfolio => {
        const pValue = portfolio.total_value || 0;
        const pInvested = portfolio.total_invested || 0;
        const pGainLoss = portfolio.gain_loss || (pValue - pInvested);

        totalValue += pValue;
        totalInvested += pInvested;
        totalGainLoss += pGainLoss;
    });

    // Aggregate return: total gain/loss divided by total invested
    const aggregateReturn = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

    return {
        totalValue,
        totalInvested,
        totalGainLoss,
        aggregateReturn
    };
}

// Sort portfolios for landing page display
function sortPortfolios(portfolios, sortColumn, sortDirection) {
    const sorted = [...portfolios];  // Create a copy to avoid mutating original

    sorted.sort((a, b) => {
        let aVal, bVal;

        switch(sortColumn) {
            case 'name':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);

            case 'shares':
                aVal = a.positions_count || 0;
                bVal = b.positions_count || 0;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;

            case 'totalValue':
                aVal = a.total_value || 0;
                bVal = b.total_value || 0;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;

            case 'totalInvested':
                aVal = a.total_invested || 0;
                bVal = b.total_invested || 0;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;

            case 'gainLoss':
                aVal = a.gain_loss || 0;
                bVal = b.gain_loss || 0;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;

            case 'return':
                aVal = a.return_percentage || 0;
                bVal = b.return_percentage || 0;
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;

            case 'createdAt':
                aVal = new Date(a.created_at || 0).getTime();
                bVal = new Date(b.created_at || 0).getTime();
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;

            default:
                return 0;
        }
    });

    return sorted;
}

// Handle table header click for sorting
function handlePortfolioTableSort(newSortColumn) {
    // If clicking the same column, toggle direction; otherwise switch to new column with asc
    if (portfolioSortColumn === newSortColumn) {
        portfolioSortDirection = portfolioSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        portfolioSortColumn = newSortColumn;
        portfolioSortDirection = 'asc';
    }

    // Re-render the landing page with new sort
    showPortfolioLandingPage();
}

// PHASE 3: Refresh portfolio list from server
async function refreshPortfolioList() {
    try {
        // Add animation to refresh icon
        const refreshIcon = document.querySelector('.refresh-icon');
        if (refreshIcon) {
            refreshIcon.classList.add('refreshing');
        }

        const response = await fetch(`${API_URL}/user/portfolios`, {
            credentials: 'include',
            signal: globalAbortController.signal
        });

        if (!response.ok) {
            throw new Error('Failed to refresh portfolio list');
        }

        const data = await response.json();
        if (data.success) {
            availablePortfolios = data.portfolios;
            console.log('✅ Portfolio list refreshed from server');
            showPortfolioLandingPage();
        }
    } catch (error) {
        console.error('Error refreshing portfolio list:', error);
        // Remove animation on error
        const refreshIcon = document.querySelector('.refresh-icon');
        if (refreshIcon) {
            refreshIcon.classList.remove('refreshing');
        }
    }
}

// PHASE 3: Show portfolio landing page with overview grid of all portfolios
function showPortfolioLandingPage() {
    // Clear activePortfolioId so switcher highlights "(AllPortfolios)"
    activePortfolioId = null;

    const landingView = document.getElementById('landingView');

    if (availablePortfolios.length === 0) {
        // Empty state: no portfolios
        const emptyHTML = `
            <div class="setup-card">
                <div class="setup-title">Your Portfolios</div>
                <div class="setup-subtitle">Get started by creating your first portfolio</div>
                <div class="empty-state">
                    <p>No portfolios found. Create your first portfolio to begin tracking your investments.</p>
                    <button onclick="showCreatePortfolioModal()" class="btn">Create new portfolio</button>
                </div>
            </div>
        `;
        landingView.innerHTML = emptyHTML;
    } else {
        // Single or multiple portfolios: show overview grid with aggregated header
        const metrics = calculateAggregatedMetrics();

        // Save aggregate metrics to database so landing page always shows latest
        saveAggregateMetricsToDatabase(metrics);

        let overviewHTML = `
            <div class="portfolio-overview">
                <div class="overview-header">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
                        <h1 class="overview-title" style="margin: 0;">Portfolio overview</h1>
                        <button onclick="refreshPortfolioList()" title="Refresh portfolio data" style="background: none; border: none; cursor: pointer; padding: 8px; display: flex; align-items: center; gap: 6px; color: #7c3aed; transition: all 0.2s ease; border-radius: 8px; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;" onmouseover="this.style.backgroundColor='rgba(124, 58, 237, 0.1)'" onmouseout="this.style.backgroundColor='transparent'">
                            <svg width="24" height="24" viewBox="0 0 640 640" fill="currentColor" class="refresh-icon">
                                <path d="M544.1 256L552 256C565.3 256 576 245.3 576 232L576 88C576 78.3 570.2 69.5 561.2 65.8C552.2 62.1 541.9 64.2 535 71L483.3 122.8C439 86.1 382 64 320 64C191 64 84.3 159.4 66.6 283.5C64.1 301 76.2 317.2 93.7 319.7C111.2 322.2 127.4 310 129.9 292.6C143.2 199.5 223.3 128 320 128C364.4 128 405.2 143 437.7 168.3L391 215C384.1 221.9 382.1 232.2 385.8 241.2C389.5 250.2 398.3 256 408 256L544.1 256zM573.5 356.5C576 339 563.8 322.8 546.4 320.3C529 317.8 512.7 330 510.2 347.4C496.9 440.4 416.8 511.9 320.1 511.9C275.7 511.9 234.9 496.9 202.4 471.6L249 425C255.9 418.1 257.9 407.8 254.2 398.8C250.5 389.8 241.7 384 232 384L88 384C74.7 384 64 394.7 64 408L64 552C64 561.7 69.8 570.5 78.8 574.2C87.8 577.9 98.1 575.8 105 569L156.8 517.2C201 553.9 258 576 320 576C449 576 555.7 480.6 573.4 356.5z"/>
                            </svg>
                            REFRESH
                        </button>
                    </div>
                    <div class="metrics-header">
                        <div class="metric-card">
                            <div class="metric-label">Total Value</div>
                            <div class="metric-value">$${metrics.totalValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-label">Total Invested</div>
                            <div class="metric-value">$${metrics.totalInvested.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-label">Total Gain/Loss</div>
                            <div class="metric-value ${metrics.totalGainLoss >= 0 ? 'positive' : 'negative'}">
                                ${metrics.totalGainLoss >= 0 ? '+' : ''}$${Math.abs(metrics.totalGainLoss).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-label">Return</div>
                            <div class="metric-value ${metrics.aggregateReturn >= 0 ? 'positive' : 'negative'}">
                                ${metrics.aggregateReturn >= 0 ? '+' : ''}${metrics.aggregateReturn.toFixed(2)}%
                            </div>
                        </div>
                    </div>
                </div>

                <div class="portfolios-overview-grid" id="portfoliosOverviewGrid">
        `;

        // Sort portfolios according to current sort settings
        const sortedPortfolios = sortPortfolios(availablePortfolios, portfolioSortColumn, portfolioSortDirection);

        if (sortedPortfolios.length === 0) {
            overviewHTML += `
                    <div class="portfolios-empty-state">
                        <div class="portfolios-empty-state-icon">📊</div>
                        <div class="portfolios-empty-state-title">No Portfolios Yet</div>
                        <div class="portfolios-empty-state-text">Create your first portfolio to start tracking your investments</div>
                    </div>
            `;
        } else {
            sortedPortfolios.forEach(p => {
                const returnPct = p.return_percentage || 0;
                const gainLoss = p.gain_loss || 0;
                const totalValue = p.total_value || 0;
                const totalInvested = p.total_invested || 0;
                const returnClass = returnPct > 0 ? 'positive' : returnPct < 0 ? 'negative' : 'neutral';
                const gainLossClass = gainLoss >= 0 ? 'positive' : 'negative';
                const createdDate = p.created_at ? (() => { const d = new Date(p.created_at); return d.toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'}); })() : '-';

                overviewHTML += `
                    <div class="portfolio-overview-card">
                        <div class="portfolio-card-header">
                            <h3 onclick="selectPortfolioAndShow('${p.id}')" style="cursor: pointer;">
                                ${p.name}
                            </h3>
                            <div class="portfolio-actions-menu">
                                <button class="btn-portfolio-actions" onclick="togglePortfolioMenu('${p.id}')" title="Portfolio options" aria-label="Options for ${p.name}">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="5" r="2"></circle>
                                        <circle cx="12" cy="12" r="2"></circle>
                                        <circle cx="12" cy="19" r="2"></circle>
                                    </svg>
                                </button>
                                <div class="portfolio-context-menu" id="portfolio-menu-${p.id}">
                                    <button class="menu-item delete-item" onclick="deletePortfolio('${p.id}')">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                            <line x1="10" y1="11" x2="10" y2="17"></line>
                                            <line x1="14" y1="11" x2="14" y2="17"></line>
                                        </svg>
                                        <span>Delete</span>
                                    </button>
                                    <button class="menu-item rename-item" onclick="renamePortfolio('${p.id}')">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                        </svg>
                                        <span>Rename</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="portfolio-metrics-grid">
                            <div class="portfolio-metric">
                                <div class="portfolio-metric-label">Shares</div>
                                <div class="portfolio-metric-value">${p.positions_count}</div>
                            </div>
                            <div class="portfolio-metric">
                                <div class="portfolio-metric-label">Current Value</div>
                                <div class="portfolio-metric-value">$${totalValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                            </div>
                            <div class="portfolio-metric">
                                <div class="portfolio-metric-label">Total Invested</div>
                                <div class="portfolio-metric-value">$${totalInvested.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                            </div>
                            <div class="portfolio-metric">
                                <div class="portfolio-metric-label">Gain/Loss</div>
                                <div class="portfolio-metric-value ${gainLossClass}">
                                    ${gainLoss >= 0 ? '+' : ''}$${Math.abs(gainLoss).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                </div>
                            </div>
                            <div class="portfolio-metric">
                                <div class="portfolio-metric-label">Return</div>
                                <div class="portfolio-metric-value ${returnClass}">
                                    ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%
                                </div>
                            </div>
                            <div class="portfolio-metric">
                                <div class="portfolio-metric-label">Created</div>
                                <div class="portfolio-metric-value">${createdDate}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        overviewHTML += `
                </div>

                <div class="portfolios-overview-actions">
                    <button class="btn btn-full-width" onclick="showCreatePortfolioModal()" ${availablePortfolios.length >= 5 ? 'disabled' : ''}>
                        ${availablePortfolios.length >= 5 ? 'Max 5 portfolios reached' : 'Create new portfolio'}
                    </button>
                </div>
            </div>
        `;

        landingView.innerHTML = overviewHTML;

        // Remove refresh animation after page updates
        const refreshIcon = document.querySelector('.refresh-icon');
        if (refreshIcon) {
            refreshIcon.classList.remove('refreshing');
        }
    }

    showView('landingView');
}

// PHASE 3: Select portfolio wrapper function
async function selectPortfolioAndShow(portfolioId) {
    await selectPortfolio(portfolioId);
}

// PHASE 3: Create new portfolio
async function createNewPortfolio(portfolioName) {
    if (!portfolioName || portfolioName.length < 1 || portfolioName.length > 50) {
        alert('Portfolio name must be 1-50 characters');
        return false;
    }

    try {
        const response = await fetch(`${API_URL}/user/portfolios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ portfolio_name: portfolioName }),
            signal: globalAbortController.signal
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to create portfolio');
        }

        if (data.success) {
            // Add new portfolio to list with return percentage
            const newPortfolio = {
                'id': data.portfolio.id,
                'name': data.portfolio.name,
                'positions_count': data.portfolio.positions_count,
                'is_default': data.portfolio.is_default,
                'created_at': data.portfolio.created_at,
                'return_percentage': 0.0,  // New portfolio has no return yet
                'total_value': 0,
                'total_invested': 0,
                'gain_loss': 0
            };
            availablePortfolios.push(newPortfolio);
            console.log(`✓ Created portfolio: ${portfolioName}`);

            // Refresh the portfolio landing page to show the new portfolio
            showPortfolioLandingPage();

            return true;
        }
    } catch (error) {
        console.error('Error creating portfolio:', error);
        alert(`Failed to create portfolio: ${error.message}`);
        return false;
    }
}

// PHASE 3: Show modal for creating portfolio
async function showCreatePortfolioModal() {
    const portfolioLimit = 5;
    if (availablePortfolios.length >= portfolioLimit) {
        alert(`You have reached the maximum of ${portfolioLimit} portfolios. Delete one to create a new portfolio.`);
        return;
    }

    // Show input modal for portfolio creation
    await showInputModal(
        'add_portfolio',
        async (portfolioName) => {
            // Callback when user confirms
            return await createNewPortfolio(portfolioName);
        },
        () => {
            // Callback when user cancels
            console.log('Portfolio creation cancelled');
        }
    );
}

// PHASE 3: Rename portfolio
async function renamePortfolio(portfolioId, newName) {
    if (!newName || newName.length < 1 || newName.length > 50) {
        alert('Portfolio name must be 1-50 characters');
        return false;
    }

    try {
        const response = await fetch(`${API_URL}/user/portfolios/${portfolioId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ new_name: newName }),
            signal: globalAbortController.signal
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to rename portfolio');
        }

        if (data.success) {
            // Update portfolio in list
            const idx = availablePortfolios.findIndex(p => p.id === portfolioId);
            if (idx !== -1) {
                availablePortfolios[idx].name = newName;
            }

            // If this is active portfolio, update display
            if (activePortfolioId === portfolioId) {
                portfolio.name = newName;
            }

            console.log(`✓ Renamed portfolio to: ${newName}`);
            showPortfolioLandingPage();

            return true;
        }
    } catch (error) {
        console.error('Error renaming portfolio:', error);
        alert(`Failed to rename portfolio: ${error.message}`);
        return false;
    }
}

// Portfolio menu functions
function togglePortfolioMenu(portfolioId) {
    const menuId = `portfolio-menu-${portfolioId}`;
    const menu = document.getElementById(menuId);
    const button = menu?.parentElement?.querySelector('.btn-portfolio-actions');

    if (menu && button) {
        // Close all other menus and remove active state from their buttons
        document.querySelectorAll('.portfolio-context-menu').forEach(m => {
            if (m.id !== menuId) {
                m.classList.remove('visible');
                const otherButton = m.parentElement?.querySelector('.btn-portfolio-actions');
                if (otherButton) {
                    otherButton.classList.remove('active');
                }
            }
        });

        // Toggle current menu
        const isVisible = menu.classList.contains('visible');

        if (!isVisible) {
            menu.classList.add('visible');
            button.classList.add('active');
        } else {
            menu.classList.remove('visible');
            button.classList.remove('active');
        }
    }
}

async function renamePortfolio(portfolioId) {
    // Close the menu
    const menuId = `portfolio-menu-${portfolioId}`;
    const menu = document.getElementById(menuId);
    if (menu) {
        menu.classList.remove('visible');
    }

    // Find the portfolio to get its current name
    const portfolio = availablePortfolios.find(p => p.id === portfolioId);
    if (!portfolio) {
        console.error('Portfolio not found:', portfolioId);
        return;
    }

    // Show rename modal with current portfolio name
    await showInputModal(
        'rename_portfolio',
        async (newName) => {
            if (!newName || newName === portfolio.name) {
                console.log('Portfolio name unchanged');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/user/portfolios/${portfolioId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({ new_name: newName }),
                    signal: globalAbortController.signal
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to rename portfolio');
                }

                if (data.success) {
                    // Update local portfolio data
                    portfolio.name = newName;

                    // If this is the active portfolio, update display
                    if (activePortfolioId === portfolioId) {
                        const activePortfolio = portfolio;
                        if (activePortfolio) {
                            activePortfolio.name = newName;
                        }
                    }

                    console.log(`✓ Portfolio renamed to: ${newName}`);
                    showPortfolioLandingPage();
                }
            } catch (error) {
                console.error('Error renaming portfolio:', error);
                alert(`Failed to rename portfolio: ${error.message}`);
            }
        },
        null,
        portfolio.name
    );
}

// PHASE 3: Delete portfolio
async function deletePortfolio(portfolioId) {
    // Close the menu first
    const menuId = `portfolio-menu-${portfolioId}`;
    const menu = document.getElementById(menuId);
    if (menu) {
        menu.classList.remove('visible');
    }
    if (availablePortfolios.length <= 1) {
        alert('You cannot delete your only portfolio. Create another portfolio first.');
        return false;
    }

    // Show modal confirmation
    await showModal(
        'delete_portfolio',
        { portfolio_name: portfolioId },
        async () => {
            // Callback when user confirms deletion
            try {
                const response = await fetch(`${API_URL}/user/portfolios/${portfolioId}`, {
                    method: 'DELETE',
                    credentials: 'include',
                    signal: globalAbortController.signal
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to delete portfolio');
                }

                if (data.success) {
                    // Remove portfolio from list
                    availablePortfolios = availablePortfolios.filter(p => p.id !== portfolioId);

                    // If deleted portfolio was active, switch to another
                    if (activePortfolioId === portfolioId) {
                        if (availablePortfolios.length > 0) {
                            await selectPortfolio(availablePortfolios[0].id);
                        } else {
                            showPortfolioLandingPage();
                        }
                    } else {
                        showPortfolioLandingPage();
                    }

                    console.log('✓ Portfolio deleted');
                    return true;
                }
            } catch (error) {
                console.error('Error deleting portfolio:', error);
                alert(`Failed to delete portfolio: ${error.message}`);
                return false;
            }
        }
    );
}

// PHASE 4: Portfolio Switcher Functions

// Toggle portfolio switcher dropdown visibility
function togglePortfolioSwitcher() {
    const switcher = document.getElementById('portfolioSwitcher');
    const userProfileBtn = document.getElementById('userProfileBtn');

    if (switcher.classList.contains('hidden')) {
        // Show dropdown and refresh portfolio list
        showPortfolioSwitcher();

        // Add active state to button
        userProfileBtn.classList.add('active');

        // Position dropdown below the button
        requestAnimationFrame(() => {
            const buttonRect = userProfileBtn.getBoundingClientRect();

            // Position dropdown: align right edges and place below button
            switcher.style.top = (buttonRect.bottom + 8) + 'px';
            switcher.style.right = (window.innerWidth - buttonRect.right) + 'px';
        });
    } else {
        // Hide dropdown
        switcher.classList.add('hidden');
        userProfileBtn.classList.remove('active');
    }
}

// Fetch cached portfolio metrics from database (called on login)
// Fast operation - no price fetches, just reads from database
async function fetchCachedPortfolioMetrics() {
    try {
        console.log('💾 Fetching cached portfolio metrics from database...');
        const response = await fetch(`${API_URL}/portfolios/metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: globalAbortController.signal
        });

        if (!response.ok) {
            console.error(`Failed to fetch portfolio metrics: ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        if (data.success && data.portfolios) {
            // Merge backend metrics with frontend metrics, preferring frontend values if they're more recent
            // This ensures we don't lose fresh metrics that were just calculated
            const mergedPortfolios = data.portfolios.map(backendPortfolio => {
                const frontendPortfolio = availablePortfolios.find(p => p.id === backendPortfolio.id);

                // If we have fresh frontend data, keep it; otherwise use backend data
                if (frontendPortfolio) {
                    return {
                        ...backendPortfolio,
                        // Keep frontend values if they exist, as they might be fresher
                        total_value: frontendPortfolio.total_value !== undefined ? frontendPortfolio.total_value : backendPortfolio.total_value,
                        total_invested: frontendPortfolio.total_invested !== undefined ? frontendPortfolio.total_invested : backendPortfolio.total_invested,
                        gain_loss: frontendPortfolio.gain_loss !== undefined ? frontendPortfolio.gain_loss : backendPortfolio.gain_loss,
                        return_percentage: frontendPortfolio.return_percentage !== undefined ? frontendPortfolio.return_percentage : backendPortfolio.return_percentage,
                        // Always keep created_at from backend (never changes)
                        created_at: backendPortfolio.created_at || frontendPortfolio.created_at
                    };
                }
                return backendPortfolio;
            });

            availablePortfolios = mergedPortfolios;
            console.log('✓ Loaded cached metrics for ' + mergedPortfolios.length + ' portfolios:',
                mergedPortfolios.map(p => ({ name: p.name, return: p.return_percentage.toFixed(2) + '%', updated: p.last_updated })));

            // Store aggregated metrics for later use
            window.userAggregateMetrics = data.user_aggregate;

            return data;
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error fetching portfolio metrics:', error);
        }
    }
    return null;
}

// Update portfolio returns from fresh data (called on-demand when switching/saving)
async function updatePortfolioReturnsFromCurrent() {
    // Use the current enrichedPositions to calculate return percentage for active portfolio
    if (!activePortfolioId || !enrichedPositions || enrichedPositions.length === 0) {
        return;
    }

    // Calculate return percentage using current enriched positions
    const totalValue = enrichedPositions.reduce((sum, pos) => sum + (pos.positionValue || 0), 0);
    const constantTotalInvested = portfolio.positions.reduce((sum, pos) => sum + (pos.shares * pos.purchasePrice), 0);
    const totalGainLoss = totalValue - constantTotalInvested;
    const returnPct = constantTotalInvested > 0 ? (totalGainLoss / constantTotalInvested) * 100 : 0;

    // Update the active portfolio in availablePortfolios with all metrics
    const portfolioIndex = availablePortfolios.findIndex(p => p.id === activePortfolioId);
    if (portfolioIndex !== -1) {
        availablePortfolios[portfolioIndex].total_value = totalValue;
        availablePortfolios[portfolioIndex].total_invested = constantTotalInvested;
        availablePortfolios[portfolioIndex].gain_loss = totalGainLoss;
        availablePortfolios[portfolioIndex].return_percentage = returnPct;
        console.log(`✓ Updated portfolio metrics: value=$${totalValue.toFixed(2)}, invested=$${constantTotalInvested.toFixed(2)}, return=${returnPct.toFixed(2)}%`);

        // Save metrics to backend so they persist for next login
        console.log(`[METRICS] Saving metrics to backend for portfolio ${activePortfolioId}`);
        fetch(`${API_URL}/portfolio/save-metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                portfolio_id: activePortfolioId,
                total_value: totalValue,
                total_invested: constantTotalInvested,
                gain_loss: totalGainLoss,
                return_percentage: returnPct
            })
        })
        .then(response => {
            if (response.ok) {
                console.log(`[METRICS] ✓ Metrics saved successfully`);
            } else {
                console.warn(`[METRICS] Save failed with status ${response.status}`);
            }
        })
        .catch(error => console.warn('[METRICS] Failed to save metrics to backend:', error));
    }
}

// Save aggregate metrics to database
function saveAggregateMetricsToDatabase(metrics) {
    console.log(`[AGGREGATE] Saving aggregate metrics to backend: value=${metrics.totalValue.toFixed(2)}, invested=${metrics.totalInvested.toFixed(2)}, gain_loss=${metrics.totalGainLoss.toFixed(2)}, return=${metrics.aggregateReturn.toFixed(2)}%`);

    fetch(`${API_URL}/user/aggregate-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            total_value_all_portfolios: metrics.totalValue,
            total_invested_all_portfolios: metrics.totalInvested,
            gain_loss_all_portfolios: metrics.totalGainLoss,
            aggregate_return_percentage: metrics.aggregateReturn
        })
    })
    .then(response => {
        if (response.ok) {
            console.log(`[AGGREGATE] ✓ Aggregate metrics saved successfully`);
        } else {
            console.warn(`[AGGREGATE] Save failed with status ${response.status}`);
        }
    })
    .catch(error => console.warn('[AGGREGATE] Failed to save aggregate metrics:', error));
}

// Show portfolio switcher dropdown with updated portfolio list
async function showPortfolioSwitcher() {
    const switcher = document.getElementById('portfolioSwitcher');
    const portfolioList = document.getElementById('portfolioList');
    const usernameElem = document.getElementById('switcherUsername');
    const createBtn = document.getElementById('createPortfolioFromSwitcher');

    // Update username
    usernameElem.textContent = currentUsername || currentUser?.username || '{username}';

    // Clear and populate portfolio list
    portfolioList.innerHTML = '';

    // Add "All Portfolios" item at top
    const allPortfoliosItem = document.createElement('div');
    allPortfoliosItem.className = `portfolio-item ${!activePortfolioId ? 'active' : ''}`;

    const allPortfoliosName = document.createElement('a');
    allPortfoliosName.className = 'portfolio-name';
    allPortfoliosName.textContent = '(AllPortfolios)';
    allPortfoliosName.href = '#';
    allPortfoliosName.onclick = (e) => {
        e.preventDefault();
        document.getElementById('portfolioSwitcher').classList.add('hidden');
        showPortfolioLandingPage();
    };

    const allPortfoliosReturn = document.createElement('div');
    allPortfoliosReturn.className = 'portfolio-return';
    const aggregateReturn = window.userAggregateMetrics?.aggregate_return_percentage || 0;
    const aggregateReturnClass = aggregateReturn > 0 ? 'positive' : aggregateReturn < 0 ? 'negative' : 'neutral';
    allPortfoliosReturn.classList.add(aggregateReturnClass);
    allPortfoliosReturn.textContent = `Return: ${aggregateReturn > 0 ? '+' : ''}${aggregateReturn.toFixed(2)}%`;

    allPortfoliosItem.appendChild(allPortfoliosName);
    allPortfoliosItem.appendChild(allPortfoliosReturn);
    portfolioList.appendChild(allPortfoliosItem);

    if (availablePortfolios && availablePortfolios.length > 0) {
        availablePortfolios.forEach(p => {
            const portfolioItem = document.createElement('div');
            portfolioItem.className = `portfolio-item ${p.id === activePortfolioId ? 'active' : ''}`;

            const portfolioName = document.createElement('a');
            portfolioName.className = 'portfolio-name';
            portfolioName.textContent = p.name;
            portfolioName.href = '#';
            portfolioName.onclick = (e) => {
                e.preventDefault();
                switchToPortfolio(p.id);
            };

            const returnDiv = document.createElement('div');
            returnDiv.className = 'portfolio-return';
            const returnPct = p.return_percentage || 0;
            const returnClass = returnPct > 0 ? 'positive' : returnPct < 0 ? 'negative' : 'neutral';
            returnDiv.classList.add(returnClass);
            returnDiv.textContent = `Return: ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`;

            portfolioItem.appendChild(portfolioName);
            portfolioItem.appendChild(returnDiv);
            portfolioList.appendChild(portfolioItem);
        });
    }

    // Enable/disable create button based on portfolio limit (max 5)
    const maxPortfolios = 5;
    const canCreate = availablePortfolios.length < maxPortfolios;
    createBtn.disabled = !canCreate;
    createBtn.textContent = canCreate
        ? 'Create new portfolio'
        : `Max ${maxPortfolios} portfolios reached`;

    // Show dropdown
    switcher.classList.remove('hidden');
}

// Switch to a different portfolio and reload dashboard
async function switchToPortfolio(portfolioId) {
    try {
        // Save current portfolio first AND update its return percentage
        if (portfolio && portfolio.positions && portfolio.positions.length > 0) {
            await savePortfolioToServer();
            // Update return percentage for the portfolio we just saved
            await updatePortfolioReturnsFromCurrent();
        }

        // Close dropdown
        document.getElementById('portfolioSwitcher').classList.add('hidden');

        // Switch portfolio
        await selectPortfolio(portfolioId);

        console.log(`✓ Switched to portfolio: ${portfolio.name}`);
    } catch (error) {
        console.error('Error switching portfolio:', error);
        alert('Failed to switch portfolio. Please try again.');
    }
}

// Load historical cache from localStorage
function loadHistoricalCache() {
    // Reset and validate cache from unified system
    portfolioCache.resetFromStorage();

    // Sync the legacy historicalCache object with the new system
    // (for backward compatibility with code that still accesses historicalCache directly)
    historicalCache = portfolioCache.getAll();

    // Log statistics for debugging
    const stats = portfolioCache.getStats();
    const portfolioSize = portfolio.positions.length;
    console.log(`[CACHE] Validated cache: ${stats.cachedTickers} cached, ${stats.activeTickers} active, portfolio has ${portfolioSize} positions (valid: ${stats.isValid})`);
}

// Save historical cache to localStorage
function saveHistoricalCache() {
    // Validate and clean cache through unified system
    portfolioCache.validateAndClean();

    // Sync the legacy historicalCache object with the cleaned version
    historicalCache = portfolioCache.getAll();
}

// Get today's date in YYYY-MM-DD format
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

// Check if we need to fetch historical data for a position
function needsHistoricalFetch(ticker, purchaseDate) {
    const cached = historicalCache[ticker];
    if (!cached) return true;
    if (cached.purchaseDate !== purchaseDate) return true;
    return false;
}

// Check if we need to update today's price
function needsTodayPriceUpdate(ticker) {
    const cached = historicalCache[ticker];
    if (!cached) return false;
    return cached.lastUpdated !== getTodayDate();
}

// Show view
function showView(viewId) {
    const currentActive = document.querySelector('.view.active');

    // Stop polling when leaving portfolio view
    if (currentActive && currentActive.id === 'portfolioView' && viewId !== 'portfolioView') {
        stopRealTimePolling();
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// Navigate back to portfolio view (from create portfolio form)
function backToPortfolio() {
    showView('portfolioView');
}

// Calculate total investment
function updateTotalInvestment() {
    const shares = parseFloat(document.getElementById('shares').value) || 0;
    const price = parseFloat(document.getElementById('purchasePrice').value) || 0;
    const total = shares * price;
    document.getElementById('totalInvestment').textContent = '$' + total.toFixed(2);
}

// Format currency
function formatCurrency(value) {
    if (value === undefined || value === null || isNaN(value)) {
        return '$0.00';
    }
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format percentage
function formatPercent(value) {
    return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Show loading overlay
function showLoading(message = 'Loading...') {
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingProgress').textContent = message;
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// Show error message to user
function showErrorToast(message) {
    alert(message);
}

// Show skeleton loaders while fetching data
function showSkeletonLoaders() {
    console.log('Showing skeleton loaders...');

    // Show loading message on chart - but keep canvas structure for rendering
    const chartContainer = document.getElementById('chartContainer');
    if (chartContainer) {
        // Keep the canvas element but hide it, show skeleton overlay
        const canvas = document.getElementById('portfolioChart');
        const noDataDiv = document.getElementById('chartNoData');
        if (canvas) canvas.style.display = 'none';
        if (noDataDiv) noDataDiv.style.display = 'none';

        // Create loading overlay
        let loadingOverlay = document.getElementById('chartLoadingOverlay');
        if (!loadingOverlay) {
            loadingOverlay = document.createElement('div');
            loadingOverlay.id = 'chartLoadingOverlay';
            chartContainer.appendChild(loadingOverlay);
        }
        loadingOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
            background-size: 1000px 100%;
            animation: shimmer 2s infinite;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            z-index: 10;
        `;
        const message = document.createElement('div');
        message.className = 'loading-message';
        message.textContent = 'Fetching most recent data...';
        loadingOverlay.innerHTML = '';
        loadingOverlay.appendChild(message);
    }

    // Show skeleton rows in positions table
    const tbody = document.getElementById('positionsTableBody');
    if (tbody) {
        let skeletonHTML = '';
        for (let i = 0; i < 5; i++) {
            skeletonHTML += `
                <tr style="background: #f9fafb;">
                    <td><div class="skeleton" style="height: 20px; width: 60px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 40px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 80px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 80px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 100px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 100px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 60px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 100px;"></div></td>
                    <td><div class="skeleton" style="height: 20px; width: 80px;"></div></td>
                </tr>
            `;
        }
        tbody.innerHTML = skeletonHTML;
    }

    // Show skeleton metrics
    const metricsContainer = document.querySelector('.portfolio-header-right');
    if (metricsContainer) {
        const metricCards = metricsContainer.querySelectorAll('.metric-card');
        metricCards.forEach(card => {
            card.style.opacity = '1.0';
            const valueEl = card.querySelector('.metric-value');
            if (valueEl) {
                valueEl.innerHTML = '<div class="skeleton" style="height: 24px; width: 80px;"></div>';
            }
        });
    }
}

// Hide skeleton loaders
function hideSkeletonLoaders() {
    console.log('Hiding skeleton loaders...');
    // Loaders are replaced when actual data is rendered
}

// Delete position - Show modal
function deletePosition(index) {
    const deleteStartTime = performance.now();
    console.log(`[DELETE] deletePosition() called for index: ${index}`);

    const position = portfolio.positions[index];

    // Show the generic modal with delete_position configuration
    showModal(
        'delete_position',
        {
            ticker: position.ticker,
            shares: position.shares
        },
        async () => {
            // Callback executed when user confirms
            await performDeletePosition(index);
        }
    ).then(() => {
        const deleteCompleteTime = performance.now();
        const totalTime = (deleteCompleteTime - deleteStartTime).toFixed(2);
        console.log(`[DELETE] Modal display complete in: ${totalTime}ms`);
    });
}

// Perform the actual delete operation
async function performDeletePosition(index) {
    const position = portfolio.positions[index];
    const ticker = position.ticker;
    console.log(`[DELETE] performDeletePosition() executing for: ${ticker} at index ${index}`);

    // OPTIMISTIC UPDATE: Remove position immediately from UI
    portfolio.positions.splice(index, 1);
    console.log(`[DELETE] Position removed from array. New length: ${portfolio.positions.length}`);

    // Check if this was the last position with this ticker
    const hasOtherPositions = portfolio.positions.some(p => p.ticker === ticker);

    // Clear dashboard cache to force re-render with updated positions
    localStorage.removeItem(DASHBOARD_CACHE_KEY);

    // Save to server immediately (don't wait for dashboard re-render to complete)
    try {
        console.log(`[DELETE] Saving portfolio to server with ${portfolio.positions.length} positions...`);
        const saveResult = await savePortfolioToServer();

        if (!saveResult) {
            throw new Error('Failed to save portfolio to server');
        }

        console.log(`[DELETE] Portfolio saved successfully`);

        // ONLY after save succeeds: clean cache for this ticker if no other positions use it
        if (!hasOtherPositions) {
            console.log(`[DELETE] Save confirmed. Now cleaning cache for ${ticker} (no other positions with this ticker)`);
            // Use atomic remove operation - handles both in-memory and localStorage
            portfolioCache.remove(ticker);

            // Also delete historical data from backend
            try {
                await fetch(`${API_URL}/portfolio/delete-historical/${position.ticker}`, {
                    method: 'DELETE',
                    signal: globalAbortController.signal
                });
                console.log(`✓ Historical data deleted for ${position.ticker}`);
            } catch (error) {
                console.warn(`⚠ Failed to delete historical data for ${position.ticker}:`, error);
                // Non-critical error - don't restore position
            }
        }
    } catch (error) {
        console.error('[DELETE] Error saving portfolio after delete:', error);

        // ROLLBACK: Restore position if save failed
        portfolio.positions.splice(index, 0, position);

        // NO cache restoration needed since we didn't clean it yet (deferred until save succeeds)

        // Clear dashboard cache to force re-render with restored position
        localStorage.removeItem(DASHBOARD_CACHE_KEY);

        // Show error message to user
        showErrorToast(`Failed to delete ${position.ticker}. Position restored. Please try again.`);

        // Re-render dashboard with restored position
        await renderPortfolioDashboard();
        return;
    }

    // Re-render dashboard in background (fire and forget to close modal immediately)
    renderPortfolioDashboard().catch(error => {
        console.error('[DELETE] Error re-rendering dashboard after delete:', error);
        // Dashboard will show stale data if this fails, but deletion was successful
    });
}

// Edit position
function editPosition(index) {
    const position = portfolio.positions[index];

    // Set editing mode
    editingPositionIndex = index;

    // Pre-fill the form
    document.getElementById('ticker').value = position.ticker;
    document.getElementById('ticker').disabled = true; // Don't allow changing ticker
    document.getElementById('shares').value = position.shares;
    document.getElementById('purchasePrice').value = position.purchasePrice;
    document.getElementById('purchaseDate').value = position.purchaseDate;

    // Update button text
    document.getElementById('addPositionBtn').textContent = 'Update Position';

    // Update total investment
    updateTotalInvestment();

    // Show add position view
    showView('addPositionView');
}

// Fetch historical data for a position (with caching)
async function fetchHistoricalData(ticker, fromDate) {
    // Check cache first
    const cached = getCachedHistoricalPrices(ticker);
    if (cached && cached.prices && cached.prices.length > 0) {
        console.log(`📦 Using cached historical data for ${ticker} (cached at ${cached.timestamp})`);
        return {
            ticker: ticker,
            prices: cached.prices,
            from_date: fromDate,
            limited_data: false,
            fromCache: true
        };
    }

    // If not cached, fetch from API
    console.log(`🔍 Fetching historical data from API for ${ticker}`);
    const url = `${API_URL}/stock/${ticker}/history?from_date=${fromDate}`;
    const response = await fetch(url, {
        signal: globalAbortController.signal
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch historical data');
    }

    // Cache the result for future use
    if (data.prices && data.prices.length > 0) {
        setCachedHistoricalPrices(ticker, data.prices);
        console.log(`💾 Cached historical data for ${ticker}`);
    }

    return data;
}

// STEP 2: Unified single-phase data fetching
// Fetches instant prices AND historical data in parallel for all positions
// This replaces the two-phase approach to ensure complete data on initial load
async function fetchCompletePortfolioData(positions) {
    const loadStartTime = performance.now();
    console.log('=== SINGLE-PHASE LOAD START ===');
    console.log('Fetching complete portfolio data (instant + history) in parallel...');
    console.log(`⏱️ [T+0ms] Starting load sequence...`);

    try {
        // STEP 1: Fetch last-sync dates to know what date ranges are missing
        const step1Start = performance.now();
        console.log('Step 1: Getting last-sync dates from backend...');
        const lastSyncResponse = await fetch(`${API_URL}/portfolio/last-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: portfolio.username,
                password: portfolio.password,
                tickers: positions.map(p => p.ticker)
            }),
            signal: globalAbortController.signal
        });

        const lastSyncData = await lastSyncResponse.json();
        const lastSyncDates = lastSyncData.last_sync || {};
        const step1Duration = performance.now() - step1Start;
        console.log(`⏱️ [T+${step1Duration.toFixed(0)}ms] Last sync dates retrieved:`, lastSyncDates);

        // STEP 2: Fetch instant prices AND historical data in parallel for each position
        const step2Start = performance.now();
        console.log(`⏱️ [T+${(step2Start - loadStartTime).toFixed(0)}ms] Step 2: Fetching instant prices and historical data in parallel...`);
        console.log(`📊 Fetching data for ${positions.length} positions...`);

        const tickerTimings = {};

        // Helper function to batch concurrent requests (limit memory usage on Render free tier)
        async function batchFetches(positions, batchSize = 4) {
            const results = [];
            for (let i = 0; i < positions.length; i += batchSize) {
                const batch = positions.slice(i, i + batchSize);
                const batchResults = await Promise.allSettled(
                    batch.map((position, batchIndex) =>
                        fetchPositionData(position, i + batchIndex)
                    )
                );
                results.push(...batchResults);
            }
            return results;
        }

        async function fetchPositionData(position, index) {
            const tickerStart = performance.now();
            try {
                // Fetch instant price
                const instantResponse = await fetch(`${API_URL}/stock/${position.ticker}/instant`, {
                    signal: globalAbortController.signal
                });
                const instantData = instantResponse.ok ? await instantResponse.json() : {};

                // Determine date range for historical data
                const lastSyncDate = lastSyncDates[position.ticker.toUpperCase()];
                let fromDate = position.purchaseDate;

                // Calculate 6-month lookback date for first-time fetches
                const sixMonthsAgo = new Date();
                sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

                // Fetch historical data from calculated date range
                let historicalData = { prices: [] };
                let newDataFetched = false;

                // Check if we have cached data locally for this ticker
                const cachedData = getCachedHistoricalPrices(position.ticker);
                const hasCachedData = cachedData && cachedData.prices && cachedData.prices.length > 0;

                // Validate cache is current: compare cache timestamp with database last-sync date
                let cacheIsUpToDate = false;
                let cacheDate = null; // Declare in outer scope so it's available in both branches
                if (hasCachedData && cachedData.timestamp && lastSyncDate) {
                    cacheDate = new Date(cachedData.timestamp).toISOString().split('T')[0];
                    cacheIsUpToDate = cacheDate >= lastSyncDate;
                }

                // Smart fetch: only use if cache is already up-to-date with database
                // This avoids the 1-day fetch problem when old cache exists with new DB sync
                // NOTE: Even if cache is current, if the smart fetch returns no data (e.g., today's
                // market data not available), we'll fallback to the cached data to preserve chart continuity
                if (lastSyncDate && hasCachedData && cacheIsUpToDate) {
                    // Cache is current: only fetch data after last sync date
                    const lastSync = new Date(lastSyncDate);
                    const nextDay = new Date(lastSync.getTime() + 24 * 60 * 60 * 1000);
                    const nextDayStr = nextDay.toISOString().split('T')[0];
                    const todayStr = new Date().toISOString().split('T')[0];

                    // If next day is today or later, skip fetch entirely - today's data won't be available
                    // This prevents 404s and unnecessary network calls
                    if (nextDayStr >= todayStr) {
                        console.log(`⊘ Skipping fetch for ${position.ticker}: cache already current (last synced ${lastSyncDate}, today is ${todayStr})`);
                        // Use cached data directly, don't fetch
                        historicalData.prices = [];
                        newDataFetched = false;
                    } else {
                        fromDate = nextDayStr;
                        console.log(`✓ Smart fetch for ${position.ticker}: from ${fromDate} (cache current as of ${cacheDate}, last synced ${lastSyncDate})`);
                    }
                } else {
                    // Cache is stale/missing or newer than DB: get full 6 months of data
                    const purchaseDate = new Date(position.purchaseDate);
                    const sixMonthDate = new Date(sixMonthsAgoStr);
                    fromDate = purchaseDate > sixMonthDate ? position.purchaseDate : sixMonthsAgoStr;

                    if (!hasCachedData) {
                        console.log(`Full fetch for ${position.ticker}: from ${fromDate} (no cache)`);
                    } else if (!cacheIsUpToDate) {
                        const dbSyncLabel = lastSyncDate ? `DB last sync ${lastSyncDate}` : 'DB has no sync data';
                        console.log(`Full fetch for ${position.ticker}: from ${fromDate} (cache stale: cached ${cacheDate}, ${dbSyncLabel})`);
                    } else {
                        console.log(`Full fetch for ${position.ticker}: from ${fromDate} (6-month history)`);
                    }
                }

                // Only fetch if we have a specific date range to fetch from (not skipping today's data)
                if (fromDate) {
                    try {
                        const histResponse = await fetch(`${API_URL}/stock/${position.ticker}/history?from_date=${fromDate}`, {
                            signal: globalAbortController.signal
                        });
                        if (histResponse.ok) {
                            historicalData = await histResponse.json();
                            // Cache it only if we got new data
                            if (historicalData.prices && historicalData.prices.length > 0) {
                                newDataFetched = true;
                                setCachedHistoricalPrices(position.ticker, historicalData.prices);
                            }
                        } else {
                            console.log(`No new historical data for ${position.ticker} (${histResponse.status})`);
                        }
                    } catch (e) {
                        console.log(`Could not fetch new historical data for ${position.ticker}: ${e.message}`);
                    }
                }

                // Fallback: if no new data was fetched, use cache to preserve chart continuity
                if (!newDataFetched || !historicalData.prices || historicalData.prices.length === 0) {
                    const cachedData = getCachedHistoricalPrices(position.ticker);
                    if (cachedData && cachedData.prices && cachedData.prices.length > 0) {
                        historicalData.prices = cachedData.prices;
                        if (!newDataFetched) {
                            console.log(`Using cached historical data for ${position.ticker}`);
                        }
                    }
                }

                const tickerDuration = performance.now() - tickerStart;
                tickerTimings[position.ticker] = tickerDuration;

                return {
                    ticker: position.ticker,
                    instantData: instantData,
                    historicalPrices: historicalData.prices || [],
                    index: index,
                    success: true,
                    fetchTime: tickerDuration
                };
            } catch (error) {
                const tickerDuration = performance.now() - tickerStart;
                tickerTimings[position.ticker] = tickerDuration;
                console.error(`Error fetching complete data for ${position.ticker}:`, error);
                return {
                    ticker: position.ticker,
                    instantData: {},
                    historicalPrices: [],
                    index: index,
                    success: false,
                    error: error.message,
                    fetchTime: tickerDuration
                };
            }
        }

        // Use batching to limit concurrent requests (prevent memory exhaustion on Render free tier)
        console.log(`⏱️ [T+${(performance.now() - loadStartTime).toFixed(0)}ms] Waiting for all ${positions.length} batched fetches to complete...`);
        const completeFetchResults = await batchFetches(positions, 4);
        const step2Duration = performance.now() - step2Start;
        console.log(`⏱️ [T+${step2Duration.toFixed(0)}ms] All batched fetches completed`);

        // STEP 3: Process results and build enriched positions array
        const step3Start = performance.now();
        console.log(`⏱️ [T+${(step3Start - loadStartTime).toFixed(0)}ms] Step 3: Processing fetched data...`);
        const enrichedPositions = new Array(positions.length).fill(null);
        let totalValue = 0;
        let hasAnyError = false;

        completeFetchResults.forEach((result, idx) => {
            if (result.status === 'fulfilled' && result.value.success) {
                const data = result.value;
                const position = positions[data.index];
                const instantData = data.instantData;

                // Determine display price (live > cached close > purchase price)
                let displayPrice = position.purchasePrice;
                if (instantData.current_price && instantData.current_price > 0) {
                    displayPrice = instantData.current_price;
                } else if (instantData.last_close && instantData.last_close.close > 0) {
                    displayPrice = instantData.last_close.close;
                }

                const positionValue = position.shares * displayPrice;
                const costBasis = position.shares * position.purchasePrice;
                const gainLoss = positionValue - costBasis;
                const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;

                totalValue += positionValue;

                enrichedPositions[data.index] = {
                    ...position,
                    companyName: instantData.company_name || position.ticker,
                    currentPrice: displayPrice,
                    positionValue: positionValue,
                    costBasis: costBasis,
                    gainLoss: gainLoss,
                    gainLossPercent: gainLossPercent,
                    historicalPrices: data.historicalPrices || [],
                    lastClosePriceData: instantData.last_close || null,
                    marketOpen: instantData.market_open || false,
                    error: false
                };

                console.log(`✓ ${position.ticker}: price=${displayPrice}, value=${positionValue}, history=${(data.historicalPrices || []).length} points, fetch_time=${data.fetchTime.toFixed(0)}ms`);
            } else {
                const position = positions[result.value?.index || idx];
                if (position) {
                    enrichedPositions[idx] = {
                        ...position,
                        companyName: position.ticker,
                        currentPrice: position.purchasePrice,
                        positionValue: position.shares * position.purchasePrice,
                        costBasis: position.shares * position.purchasePrice,
                        gainLoss: 0,
                        gainLossPercent: 0,
                        historicalPrices: [],
                        lastClosePriceData: null,
                        marketOpen: false,
                        error: true,
                        errorMessage: result.value?.error || result.reason?.message || 'Unknown error'
                    };
                    hasAnyError = true;
                }
            }
        });

        const step3Duration = performance.now() - step3Start;
        const totalLoadDuration = performance.now() - loadStartTime;

        // CRITICAL: Validate cache after all fetches complete
        // This ensures no stale entries were added during the fetch cycle
        portfolioCache.validateAndClean();
        const cleanupStats = portfolioCache.getStats();

        // Log performance summary
        console.log('═══════════════════════════════════════');
        console.log('⏱️  PERFORMANCE SUMMARY');
        console.log('═══════════════════════════════════════');
        console.log(`Step 1 (Get last-sync dates):     ${step1Duration.toFixed(0)}ms`);
        console.log(`Step 2 (Parallel fetches):        ${step2Duration.toFixed(0)}ms`);
        console.log(`Step 3 (Process results):         ${step3Duration.toFixed(0)}ms`);
        console.log(`TOTAL LOAD TIME:                  ${totalLoadDuration.toFixed(0)}ms`);
        console.log(`Cache validation: ${cleanupStats.cachedTickers} cached, ${cleanupStats.activeTickers} active (valid: ${cleanupStats.isValid})`);
        console.log('═══════════════════════════════════════');

        return {
            enrichedPositions: enrichedPositions.filter(p => p !== null),
            totalValue: totalValue,
            hasErrors: hasAnyError,
            loadTime: totalLoadDuration
        };
    } catch (error) {
        console.error('Fatal error in fetchCompletePortfolioData:', error);
        throw error;
    }
}

// Fetch current prices for all positions with caching
async function fetchPortfolioPrices() {
    console.log('fetchPortfolioPrices called, portfolio.positions:', portfolio.positions);

    if (portfolio.positions.length === 0) {
        console.log('No positions in portfolio');
        return [];
    }

    loadHistoricalCache();
    console.log('Historical cache loaded:', historicalCache);

    const enrichedPositions = [];
    let completed = 0;
    const total = portfolio.positions.length;

    const needsHistorical = [];
    const needsUpdate = [];

    for (const position of portfolio.positions) {
        if (needsHistoricalFetch(position.ticker, position.purchaseDate)) {
            console.log(`${position.ticker} needs historical fetch`);
            needsHistorical.push(position);
        } else if (needsTodayPriceUpdate(position.ticker)) {
            console.log(`${position.ticker} needs today's price update`);
            needsUpdate.push(position);
        } else {
            console.log(`${position.ticker} has up-to-date cached data`);
        }
    }

    console.log('Needs historical:', needsHistorical.length, 'Needs update:', needsUpdate.length);

    // Fetch historical data for new positions
    if (needsHistorical.length > 0) {
        showLoading('Loading historical data...');

        for (const position of needsHistorical) {
            try {
                showLoading(`Loading historical data: ${completed + 1} of ${total} stocks`);
                console.log(`Fetching historical data for ${position.ticker} from ${position.purchaseDate}`);

                const histData = await fetchHistoricalData(position.ticker, position.purchaseDate);
                console.log(`Historical data received for ${position.ticker}:`, histData);

                historicalCache[position.ticker] = {
                    purchaseDate: position.purchaseDate,
                    prices: histData.prices,
                    lastUpdated: getTodayDate(),
                    limitedData: histData.limited_data || false
                };

                console.log(`Cached historical data for ${position.ticker}:`, historicalCache[position.ticker]);

                completed++;
                await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds for Finnhub API rate limit (60 calls/min)
            } catch (error) {
                console.error(`Error fetching historical data for ${position.ticker}:`, error);
                console.error('Error details:', error.message);

                historicalCache[position.ticker] = {
                    purchaseDate: position.purchaseDate,
                    prices: [],
                    lastUpdated: getTodayDate(),
                    limitedData: true,
                    error: true
                };

                completed++;
            }
        }

        console.log('Saving historical cache after fetching');
        saveHistoricalCache();
        console.log('Historical cache saved');
    }

    // Update today's price
    if (needsUpdate.length > 0) {
        showLoading('Updating current prices...');

        for (const position of needsUpdate) {
            try {
                const response = await fetch(`${API_URL}/stock/${position.ticker}`);
                const data = await response.json();

                if (response.ok) {
                    const cached = historicalCache[position.ticker];
                    const today = getTodayDate();
                    const currentPrice = data.current_price;

                    const todayIndex = cached.prices.findIndex(p => p.date === today);

                    if (todayIndex >= 0) {
                        cached.prices[todayIndex].close = currentPrice;
                    } else {
                        cached.prices.push({
                            date: today,
                            close: currentPrice
                        });
                    }

                    cached.lastUpdated = today;
                }

                await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds for Finnhub API rate limit (60 calls/min)
            } catch (error) {
                console.error(`Error updating price for ${position.ticker}:`, error);
            }
        }

        saveHistoricalCache();
    }

    // Enrich all positions
    showLoading('Calculating positions...');

    for (const position of portfolio.positions) {
        const cached = historicalCache[position.ticker];

        if (cached && cached.prices.length > 0 && !cached.error) {
            const latestPrice = cached.prices[cached.prices.length - 1];
            const currentPrice = latestPrice.close;
            const positionValue = position.shares * currentPrice;
            const costBasis = position.shares * position.purchasePrice;
            const gainLoss = positionValue - costBasis;
            const gainLossPercent = (gainLoss / costBasis) * 100;

            enrichedPositions.push({
                ...position,
                currentPrice: currentPrice,
                positionValue: positionValue,
                costBasis: costBasis,
                gainLoss: gainLoss,
                gainLossPercent: gainLossPercent,
                historicalPrices: cached.prices
            });
        } else {
            enrichedPositions.push({
                ...position,
                currentPrice: 0,
                positionValue: 0,
                costBasis: position.shares * position.purchasePrice,
                gainLoss: 0,
                gainLossPercent: 0,
                error: true,
                historicalPrices: []
            });
        }
    }

    hideLoading();
    return enrichedPositions;
}

// Calculate daily portfolio values
// For Phase 1: Calculate minimal portfolio history using only purchase dates
function calculatePhase1PortfolioHistory(enrichedPositions) {
    if (enrichedPositions.length === 0) return [];

    const dateMap = new Map();

    // Add purchase dates to the timeline
    enrichedPositions.forEach(position => {
        if (!dateMap.has(position.purchaseDate)) {
            dateMap.set(position.purchaseDate, {
                date: position.purchaseDate,
                positions: {}
            });
        }
    });

    // Always add today's date to show current portfolio value
    const today = getTodayDate();
    if (!dateMap.has(today)) {
        dateMap.set(today, {
            date: today,
            positions: {}
        });
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    const portfolioHistory = [];

    sortedDates.forEach(date => {
        let totalValue = 0;

        enrichedPositions.forEach(position => {
            if (position.purchaseDate <= date) {
                // Use current price for Phase 1 (we have this from API)
                const priceForDate = position.currentPrice || position.purchasePrice;
                if (priceForDate !== null) {
                    totalValue += position.shares * priceForDate;
                }
            }
        });

        if (totalValue > 0) {
            portfolioHistory.push({
                date: date,
                value: totalValue
            });
        }
    });

    return portfolioHistory;
}

function calculatePortfolioHistory(enrichedPositions) {
    if (enrichedPositions.length === 0) return [];

    const dateMap = new Map();

    // Add purchase dates to the timeline
    enrichedPositions.forEach(position => {
        if (!dateMap.has(position.purchaseDate)) {
            dateMap.set(position.purchaseDate, {
                date: position.purchaseDate,
                positions: {}
            });
        }
    });

    // Add historical price dates to the timeline
    enrichedPositions.forEach(position => {
        if (position.historicalPrices && position.historicalPrices.length > 0) {
            position.historicalPrices.forEach(priceData => {
                if (!dateMap.has(priceData.date)) {
                    dateMap.set(priceData.date, {
                        date: priceData.date,
                        positions: {}
                    });
                }
            });
        }
    });

    // Always add today's date to show current portfolio value
    const today = getTodayDate();
    if (!dateMap.has(today)) {
        dateMap.set(today, {
            date: today,
            positions: {}
        });
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    const portfolioHistory = [];

    sortedDates.forEach(date => {
        let totalValue = 0;

        enrichedPositions.forEach(position => {
            if (position.purchaseDate <= date) {
                let priceForDate = null;

                // Try to find historical price for this date
                if (position.historicalPrices && position.historicalPrices.length > 0) {
                    for (let i = position.historicalPrices.length - 1; i >= 0; i--) {
                        if (position.historicalPrices[i].date <= date) {
                            priceForDate = position.historicalPrices[i].close;
                            break;
                        }
                    }
                }

                // If no historical price found, use purchase price as fallback
                if (priceForDate === null) {
                    priceForDate = position.purchasePrice;
                }

                if (priceForDate !== null) {
                    totalValue += position.shares * priceForDate;
                }
            }
        });

        portfolioHistory.push({
            date: date,
            value: totalValue
        });
    });

    return portfolioHistory;
}

// Render portfolio chart
let portfolioChart = null;

// Render chart from pre-calculated history (used by both Phase 1 and Phase 2)
function renderPortfolioChartWithHistory(history) {
    const canvas = document.getElementById('portfolioChart');
    const noDataDiv = document.getElementById('chartNoData');
    const chartContainer = document.getElementById('chartContainer');

    if (history.length === 0) {
        // Show no data message
        canvas.style.display = 'none';
        noDataDiv.style.display = 'block';
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af;">
                    <div style="text-align: center;">
                        <div style="font-size: 1.2rem; margin-bottom: 12px;">No Performance Data Available</div>
                        <div style="font-size: 0.9rem;">Historical data will appear after successfully loading stock prices</div>
                    </div>
                </div>
            `;
        }
        return;
    }

    // Don't show loading spinner for limited data - just render the chart
    // The spinner would only show if there's NO data at all from very first load
    // Limited cache data (2 points) is still valid and better than showing a spinner

    // Show canvas, hide no data message
    canvas.style.display = 'block';
    if (chartContainer && noDataDiv) {
        noDataDiv.style.display = 'none';
    }

    const ctx = canvas.getContext('2d');

    if (portfolioChart) {
        portfolioChart.destroy();
    }

    const labels = history.map(h => h.date);
    const values = history.map(h => h.value);

    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const isPositive = lastValue >= firstValue;

    portfolioChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Portfolio Value',
                data: values,
                borderColor: isPositive ? '#10b981' : '#ef4444',
                backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: isPositive ? '#10b981' : '#ef4444',
                pointHoverBorderColor: '#ffffff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#1a1f2e',
                    titleColor: '#e8eaed',
                    bodyColor: '#e8eaed',
                    borderColor: '#2a2f3e',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return 'Value: ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    // REMOVE vertical grid lines inside the chart area
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        color: '#9ca3af',
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    grid: {
                        color: '#e5e7eb',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#9ca3af',
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });

    // Hide loading overlay and show canvas
    if (chartContainer) {
        const loadingOverlay = document.getElementById('chartLoadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
        if (canvas) {
            canvas.style.display = 'block';
        }
    }
}

// Legacy function: Calculate and render chart (used by Phase 2 updates)
function renderPortfolioChart(enrichedPositions) {
    const history = calculatePortfolioHistory(enrichedPositions);
    renderPortfolioChartWithHistory(history);
}

// Real-time polling system for market hours
let pollIntervalId = null;
const POLL_INTERVAL_MS = 60000; // Update every 60 seconds during market hours
// CRITICAL: 10s interval violated Finnhub rate limits (276 calls/min vs 60 allowed)
// 60s interval brings usage to ~46 calls/min (within free tier limits)

async function startRealTimePolling() {
    // Only start polling if any position has market_open = true
    const anyMarketOpen = enrichedPositions.some(pos => pos && pos.marketOpen);
    if (!anyMarketOpen) {
        console.log('Market is closed - real-time polling disabled');
        return;
    }

    console.log('Starting real-time price polling during market hours');

    // Clear any existing polling
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
    }

    // Poll for updates every 5 seconds
    pollIntervalId = setInterval(async () => {
        const currentMarketStatus = enrichedPositions.some(pos => pos && pos.marketOpen);

        // Stop polling if market has closed
        if (!currentMarketStatus) {
            console.log('Market closed - stopping real-time polling');
            clearInterval(pollIntervalId);
            pollIntervalId = null;
            return;
        }

        // Update prices for all positions
        await updateLivePrices();
    }, POLL_INTERVAL_MS);
}

async function updateLivePrices() {
    // Batch fetches to avoid exhausting connection pools (limit to 4 concurrent requests)
    const batchSize = 4;
    const validPositions = enrichedPositions.map((pos, idx) => ({ pos, idx })).filter(item => item.pos);

    let liveUpdateResults = [];

    for (let i = 0; i < validPositions.length; i += batchSize) {
        const batch = validPositions.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
            batch.map(async ({ pos, idx }) => {
                const instantData = await fetchInstantStockData(pos);
                return { index: idx, instantData };
            })
        );
        liveUpdateResults.push(...batchResults);
    }

    // Extract successful results
    const liveUpdates = liveUpdateResults.map(result => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.warn('Error polling price:', result.reason);
            return null;
        }
    });

    let totalValueLive = 0;
    let priceChanged = false;

    // Process each update
    liveUpdates.forEach(update => {
        if (!update) return;

        const { index, instantData } = update;
        const enriched = enrichedPositions[index];

        // Check if market is still open
        const stillOpen = instantData.market_open;

        // Update with new live price if available and market open
        if (stillOpen && instantData.current_price &&
            instantData.current_price !== enriched.currentPrice) {

            const oldPrice = enriched.currentPrice;
            const newPrice = instantData.current_price;
            const positionValue = enriched.shares * newPrice;
            const gainLoss = positionValue - enriched.costBasis;
            const gainLossPercent = enriched.costBasis > 0 ? (gainLoss / enriched.costBasis) * 100 : 0;

            // Update enriched data
            enriched.currentPrice = newPrice;
            enriched.positionValue = positionValue;
            enriched.gainLoss = gainLoss;
            enriched.gainLossPercent = gainLossPercent;
            enriched.marketOpen = stillOpen;

            // Update table row with animated price change
            const row = document.querySelector(`tr[data-ticker="${enriched.ticker}"]`);
            if (row) {
                const cells = row.querySelectorAll('td');
                const rowClass = gainLoss >= 0 ? 'gain-positive' : 'gain-negative';

                // Update price cell
                if (cells[3]) {
                    cells[3].textContent = formatCurrency(newPrice);
                    // Add visual feedback for price change
                    cells[3].style.backgroundColor = newPrice > oldPrice ? '#90EE90' : '#FFB6C6';
                    setTimeout(() => cells[3].style.backgroundColor = '', 300);
                }

                // Update position value
                if (cells[4]) {
                    cells[4].textContent = formatCurrency(positionValue);
                }

                // Update gain/loss
                if (cells[5]) {
                    cells[5].textContent = (gainLoss >= 0 ? '+' : '-') + formatCurrency(Math.abs(gainLoss));
                    cells[5].className = rowClass;
                }

                // Update percentage
                if (cells[6]) {
                    cells[6].textContent = (gainLossPercent >= 0 ? '+' : '') + gainLossPercent.toFixed(2) + '%';
                    cells[6].className = rowClass;
                }
            }

            priceChanged = true;
        }

        totalValueLive += enriched.positionValue;
    });

    // Update header metrics if any price changed
    if (priceChanged) {
        const totalGainLossLive = totalValueLive - window.portfolioTotalInvested;
        const totalReturnLive = window.portfolioTotalInvested > 0 ?
            (totalGainLossLive / window.portfolioTotalInvested) * 100 : 0;

        document.getElementById('totalValueHeader').textContent = formatCurrency(totalValueLive);

        const gainLossClassLive = totalGainLossLive >= 0 ? 'metric-value positive' : 'metric-value negative';
        document.getElementById('totalGainLossHeader').textContent = (totalGainLossLive >= 0 ? '+' : '-') + formatCurrency(Math.abs(totalGainLossLive));
        document.getElementById('totalGainLossHeader').className = gainLossClassLive;

        const returnSignLive = totalReturnLive >= 0 ? '+' : '';
        document.getElementById('totalReturnHeader').textContent = returnSignLive + totalReturnLive.toFixed(2) + '%';
        document.getElementById('totalReturnHeader').className = totalReturnLive >= 0 ? 'metric-value positive' : 'metric-value negative';

        // Update chart with live prices
        renderPortfolioChart(enrichedPositions);
    }
}

function stopRealTimePolling() {
    if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
        console.log('Real-time polling stopped');
    }
}


// Render portfolio dashboard - moved to next section due to size

// Attach landing page button listeners early
function attachButtonListeners() {
    console.log('attachButtonListeners called');

    // Landing page button event listeners
    const createPortfolioBtn = document.getElementById('createPortfolioBtn');
    const findPortfolioBtn = document.getElementById('findPortfolioBtn');

    console.log('createPortfolioBtn:', createPortfolioBtn);
    console.log('findPortfolioBtn:', findPortfolioBtn);

    if (createPortfolioBtn) {
        createPortfolioBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Create button clicked');
            showCreateView();
        });
        console.log('Create button listener attached');
    }
    if (findPortfolioBtn) {
        findPortfolioBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Login button clicked');
            showLoginView();
        });
        console.log('Login button listener attached');
    }
}

// Initialize app when DOM is ready
async function initializeApp() {
    // Modal table already exists in Supabase - no need to initialize on every load
    // Modal configs are fetched on-demand and cached in the frontend

    // Check if user has an active session
    // Session token is stored in HTTP-only cookie by backend, not accessible here
    // We check if we have a username which persists during the session
    if (currentUsername) {
        // User is authenticated - show portfolio view immediately, load data in background
        showView('portfolioView');
        updateProfileButtonVisibility();

        try {
            // Load portfolio data from server
            // No password needed - backend validates via HTTP-only cookie token
            const response = await fetch(`${API_URL}/portfolio/details`, {
                signal: globalAbortController.signal
            });

            if (!response.ok) {
                throw new Error('Failed to load portfolio');
            }

            const data = await response.json();
            portfolio = data.portfolio;

            if (portfolio.positions.length > 0) {
                // Portfolio exists, render it
                await renderPortfolioDashboard();
            } else {
                // No positions yet, show add position view
                showView('addPositionView');
            }
        } catch (error) {
            // Session invalid, clear and show landing
            console.error('Session invalid:', error);
            currentUsername = null;
            currentPassword = null;
            showView('landingView');
        }
    } else {
        // No session, show landing view
        showView('landingView');
    }

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('purchaseDate').setAttribute('max', today);

    // Portfolio setup form
    // Password strength indicator
    document.getElementById('portfolioPassword').addEventListener('input', (e) => {
        const password = e.target.value;
        if (password.length === 0) {
            document.getElementById('passwordStrength').style.display = 'none';
            return;
        }

        document.getElementById('passwordStrength').style.display = 'block';
        const validation = validatePasswordStrength(password);
        const strengthBar = document.getElementById('passwordStrengthBar');
        const strengthText = document.getElementById('passwordStrengthText');

        const strengthPercent = (validation.strength / 5) * 100;
        strengthBar.style.width = strengthPercent + '%';

        let color = '#ef4444'; // Red
        let text = 'Weak';
        if (validation.strength >= 4) {
            color = '#22c55e'; // Green
            text = 'Strong';
        } else if (validation.strength >= 3) {
            color = '#f59e0b'; // Amber
            text = 'Good';
        }

        strengthBar.style.backgroundColor = color;
        strengthText.style.color = color;
        strengthText.textContent = text;
    });

    document.getElementById('portfolioSetupForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('portfolioUsername').value.trim();
        const name = document.getElementById('portfolioName').value.trim();
        const password = document.getElementById('portfolioPassword').value;
        const confirmPassword = document.getElementById('portfolioPasswordConfirm').value;

        // Validate username
        if (username.length < 3) {
            alert('Username must be at least 3 characters long.');
            return;
        }

        // Validate passwords match
        if (password !== confirmPassword) {
            alert('Passwords do not match. Please try again.');
            return;
        }

        // Validate password strength
        const validation = validatePasswordStrength(password);
        if (!validation.isValid) {
            let missing = [];
            if (!validation.requirements.length) missing.push('8+ characters');
            if (!validation.requirements.uppercase) missing.push('uppercase letter');
            if (!validation.requirements.lowercase) missing.push('lowercase letter');
            if (!validation.requirements.number) missing.push('number');
            if (!validation.requirements.special) missing.push('special character');
            alert(`Password must contain: ${missing.join(', ')}`);
            return;
        }

        try {
            await createPortfolio(username, name, password);
            updateProfileButtonVisibility();

            // PHASE 2: After successful registration, user has 1 portfolio, go directly to dashboard
            if (activePortfolioId && availablePortfolios && availablePortfolios.length > 0) {
                showView('portfolioView');
                await renderPortfolioDashboard();
            } else {
                // Fallback: show add position view
                showView('addPositionView');
            }
        } catch (error) {
            alert(error.message);
        }
    });

    // Login form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;

        // Validate inputs
        if (username.length < 3) {
            alert('Please enter a valid username.');
            return;
        }

        if (password.length === 0) {
            alert('Please enter your password.');
            return;
        }

        try {
            await loginPortfolio(username, password);
            updateProfileButtonVisibility();

            // loginPortfolio already handles displaying the correct view:
            // - Single portfolio: selectPortfolio() shows portfolioView with dashboard
            // - Multiple portfolios: showPortfolioLandingPage() is called by loginPortfolio
            // So we don't need to call showView or showPortfolioLandingPage again here

            // Only update landing page if we have multiple portfolios
            if (availablePortfolios.length > 1) {
                // Fetch cached metrics from database (fast - no price fetches)
                const metricsData = await fetchCachedPortfolioMetrics();

                // Show portfolio landing page (overview) with cached metrics
                showPortfolioLandingPage();

                // If no cached metrics yet, trigger background job to calculate them
                if (metricsData && metricsData.portfolios.length > 0) {
                    const allZeros = metricsData.portfolios.every(p => p.return_percentage === 0);
                    if (allZeros) {
                        console.log('⚙️ No cached metrics found - triggering background update...');
                        fetch(`${API_URL}/background/update-portfolio-metrics`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ user_id: currentUser?.id })
                        }).then(r => r.json()).then(result => {
                            console.log('✓ Background update triggered:', result);
                            // Refresh metrics after background update completes
                            setTimeout(() => {
                                fetchCachedPortfolioMetrics().then(() => {
                                    showPortfolioLandingPage();
                                });
                            }, 2000);
                        }).catch(e => console.error('Background update failed:', e));
                    }
                }
            }
        } catch (error) {
            alert(error.message);
        }
    });

    // PHASE 4: Portfolio Switcher Event Listeners
    const userProfileBtn = document.getElementById('userProfileBtn');
    const portfolioSwitcher = document.getElementById('portfolioSwitcher');
    const createPortfolioFromSwitcher = document.getElementById('createPortfolioFromSwitcher');
    const logoutBtn = document.getElementById('logoutBtn');

    if (userProfileBtn) {
        userProfileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePortfolioSwitcher();
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (portfolioSwitcher && !portfolioSwitcher.contains(e.target) &&
            userProfileBtn && !userProfileBtn.contains(e.target)) {
            portfolioSwitcher.classList.add('hidden');
        }
    });

    // Create new portfolio from switcher - navigate to form
    if (createPortfolioFromSwitcher) {
        createPortfolioFromSwitcher.addEventListener('click', async () => {
            // Check portfolio limit
            if (availablePortfolios && availablePortfolios.length >= 5) {
                alert('Maximum 5 portfolios allowed');
                return;
            }

            // Close dropdown and navigate to create portfolio form
            document.getElementById('portfolioSwitcher').classList.add('hidden');
            showView('createPortfolioView');
            document.getElementById('newPortfolioName').focus();
        });
    }

    // Create portfolio form submission (authenticated users only)
    const createPortfolioForm = document.getElementById('createPortfolioForm');
    if (createPortfolioForm) {
        createPortfolioForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const portfolioName = document.getElementById('newPortfolioName').value.trim();

            if (!portfolioName) {
                alert('Please enter a portfolio name');
                return;
            }

            try {
                const result = await createNewPortfolio(portfolioName);
                if (result) {
                    // Clear form
                    createPortfolioForm.reset();
                    // Return to portfolio view
                    showView('portfolioView');
                    // Refresh switcher dropdown
                    await showPortfolioSwitcher();
                    console.log(`✓ Portfolio "${portfolioName}" created successfully`);
                }
            } catch (error) {
                console.error('Error creating portfolio:', error);
                alert('Failed to create portfolio. Please try again.');
            }
        });
    }

    // Logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                // Make logout API call
                const response = await fetch(`${API_URL}/portfolio/logout`, {
                    method: 'POST',
                    credentials: 'include',
                    signal: globalAbortController.signal
                });

                // Only log errors for actual failures (non-2xx responses)
                if (!response.ok) {
                    console.error(`Logout API failed with status ${response.status}`);
                }
            } catch (error) {
                console.error('Logout API error:', error);
            } finally {
                // Always redirect to landing page regardless of API response
                // Clear local state
                currentUsername = null;
                currentUser = null;
                currentPassword = null;
                activePortfolioId = null;
                availablePortfolios = [];
                portfolio = {};

                // Redirect to landing page with proper cleanup
                showLanding();
                portfolioSwitcher.classList.add('hidden');

                console.log('✓ Logged out successfully');
            }
        });
    }

    // Update total investment
    document.getElementById('shares').addEventListener('input', updateTotalInvestment);
    document.getElementById('purchasePrice').addEventListener('input', updateTotalInvestment);

    // Add position form
    document.getElementById('addPositionForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const ticker = document.getElementById('ticker').value.trim().toUpperCase();
        const shares = parseFloat(document.getElementById('shares').value);
        const purchasePrice = parseFloat(document.getElementById('purchasePrice').value);
        const purchaseDate = document.getElementById('purchaseDate').value;

        const addBtn = document.getElementById('addPositionBtn');
        const isEditing = editingPositionIndex >= 0;

        // Validate all inputs
        if (!ticker) {
            alert('Please enter a ticker symbol');
            return;
        }

        if (isNaN(shares) || shares <= 0) {
            alert('Please enter a valid number of shares (must be greater than 0)');
            return;
        }

        if (isNaN(purchasePrice) || purchasePrice <= 0) {
            alert('Please enter a valid purchase price (must be greater than 0)');
            return;
        }

        if (!purchaseDate) {
            alert('Please select a purchase date');
            return;
        }

        // Check position limit only when adding new
        if (!isEditing && portfolio.positions.length >= 60) {
            alert('Maximum 60 positions allowed');
            return;
        }

        addBtn.disabled = true;
        addBtn.textContent = isEditing ? 'Updating...' : 'Adding...';

        try {
            // Only validate ticker if adding new (ticker is disabled when editing)
            let companyName;
            if (!isEditing) {
                const response = await fetch(`${API_URL}/stock/${ticker}`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Invalid ticker symbol');
                }

                companyName = data.company_name;
            } else {
                companyName = portfolio.positions[editingPositionIndex].companyName;
            }

            const position = {
                ticker: ticker,
                companyName: companyName,
                shares: shares,
                purchasePrice: purchasePrice,
                purchaseDate: purchaseDate,
                addedAt: isEditing ? portfolio.positions[editingPositionIndex].addedAt : new Date().toISOString()
            };

            if (isEditing) {
                // Update existing position
                const oldPurchaseDate = portfolio.positions[editingPositionIndex].purchaseDate;

                // If purchase date changed, invalidate cache for this ticker
                if (oldPurchaseDate !== purchaseDate && historicalCache[ticker]) {
                    delete historicalCache[ticker];
                    saveHistoricalCache();
                }

                portfolio.positions[editingPositionIndex] = position;
                editingPositionIndex = -1; // Reset editing mode
            } else {
                // Add new position
                portfolio.positions.push(position);
            }

            // Save to server
            await savePortfolioToServer();

            document.getElementById('successMessage').textContent = isEditing ? 'Position updated successfully!' : 'Position added successfully!';
            document.getElementById('successMessage').classList.add('show');
            setTimeout(() => {
                document.getElementById('successMessage').classList.remove('show');
            }, 3000);

            // Reset form
            document.getElementById('addPositionForm').reset();
            document.getElementById('ticker').disabled = false;
            document.getElementById('addPositionBtn').textContent = 'Add Position';
            updateTotalInvestment();

        } catch (error) {
            alert(error.message);
        } finally {
            addBtn.disabled = false;
            if (!isEditing || addBtn.textContent === 'Updating...') {
                addBtn.textContent = isEditing ? 'Update Position' : 'Add Position';
            }
        }
    });

    // View portfolio button
    document.getElementById('viewPortfolioBtn').addEventListener('click', async () => {
        if (portfolio.positions.length === 0) {
            alert('Add at least one position first');
            return;
        }
        showView('portfolioView');
        updateProfileButtonVisibility();
        // default to Overview tab when opening portfolio
        activateTab('overview');
        await renderPortfolioDashboard();
    });

    // Add more button removed

    // Tab event listeners
    document.getElementById('overviewTab').addEventListener('click', () => {
        activateTab('overview');
    });
    document.getElementById('positionsTab').addEventListener('click', () => {
        activateTab('positions');
    });
    document.getElementById('newsTab').addEventListener('click', () => {
        activateTab('news');
    });

    // Cache functionality is still active in background (no UI needed)

    // Add event listeners for sortable headers
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.sort;
            sortPositions(column);
        });
    });
}

// Attach event listeners and initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
    attachButtonListeners();
    updateProfileButtonVisibility();
    initializeApp();
});

// Also try attaching immediately if document is already loaded
if (document.readyState === 'loading') {
    console.log('Document is still loading, waiting for DOMContentLoaded');
} else {
    console.log('Document already loaded, attaching listeners immediately');
    attachButtonListeners();
    updateProfileButtonVisibility();
    initializeApp();
}

// Tab switching for portfolio view
function activateTab(tabId) {
    document.getElementById('overviewTab').classList.remove('active');
    document.getElementById('positionsTab').classList.remove('active');
    document.getElementById('newsTab').classList.remove('active');

    document.getElementById('overviewContent').style.display = 'none';
    document.getElementById('positionsContent').style.display = 'none';
    document.getElementById('newsContent').style.display = 'none';

    document.getElementById(tabId + 'Tab').classList.add('active');

    if (tabId === 'overview') {
        document.getElementById('overviewContent').style.display = 'block';
    } else if (tabId === 'positions') {
        document.getElementById('positionsContent').style.display = 'block';
    } else if (tabId === 'news') {
        document.getElementById('newsContent').style.display = 'block';
        loadNewsTab();
    }
}

// News Cache Configuration
const NEWS_CACHE_CONFIG = {
    storageKey: 'stock_news_cache_v1',
    expirationHours: 24,  // Increased from 12 to 24 hours for Marketaux rate limit management (100/day)
    maxCacheSize: 10 * 1024 * 1024 // 10MB
};

// Load news cache from localStorage
function loadNewsCache() {
    try {
        const cacheStr = localStorage.getItem(NEWS_CACHE_CONFIG.storageKey);
        if (!cacheStr) return {};

        const cache = JSON.parse(cacheStr);
        const lastUpdateTime = cache.lastUpdate || 0;
        const nowTime = new Date().getTime();
        const hoursElapsed = (nowTime - lastUpdateTime) / (1000 * 60 * 60);

        if (hoursElapsed > NEWS_CACHE_CONFIG.expirationHours) {
            localStorage.removeItem(NEWS_CACHE_CONFIG.storageKey);
            return {};
        }

        return cache.data || {};
    } catch (e) {
        return {};
    }
}

// Save news cache to localStorage
function saveNewsCache(cacheData) {
    try {
        const cacheStr = JSON.stringify(cacheData);
        const size = new Blob([cacheStr]).size;

        if (size > NEWS_CACHE_CONFIG.maxCacheSize) {
            // Remove oldest entries if cache exceeds max size
            const keys = Object.keys(cacheData.data);
            for (let i = 0; i < Math.floor(keys.length / 4); i++) {
                delete cacheData.data[keys[i]];
            }
        }

        localStorage.setItem(NEWS_CACHE_CONFIG.storageKey, JSON.stringify(cacheData));
    } catch (e) {
        console.warn('Could not save news cache:', e);
    }
}

// Fetch news for a specific ticker
async function fetchNewsForTicker(ticker, days = 5) {
    try {
        const response = await fetch(`${API_URL}/news/${ticker}?days=${days}`, {
            signal: globalAbortController.signal
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch news for ${ticker}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching news for ${ticker}:`, error);
        return { news: [], error: error.message };
    }
}

// Get or fetch news with caching
async function getNewsWithCache(ticker, days = 5) {
    const cacheKey = `${ticker}_${days}`;
    let newsCache = loadNewsCache();

    if (newsCache[cacheKey]) {
        return newsCache[cacheKey];
    }

    const data = await fetchNewsForTicker(ticker, days);

    // Save to cache
    newsCache[cacheKey] = data;
    saveNewsCache({
        data: newsCache,
        lastUpdate: new Date().getTime()
    });

    return data;
}

// Populate stock filter dropdown
function populateNewsStockFilter() {
    const select = document.getElementById('newsStockFilter');

    // Clear existing options except "All Stocks"
    while (select.options.length > 1) {
        select.remove(1);
    }

    // Create a document fragment to batch DOM updates
    const fragment = document.createDocumentFragment();

    // Add options for each position with company name and ticker
    enrichedPositions.forEach(position => {
        const option = document.createElement('option');
        option.value = position.ticker;
        // Display: "Company Name (TICKER)" or just "TICKER" if company name not available
        const displayText = position.companyName ? `${position.companyName} (${position.ticker})` : position.ticker;
        option.textContent = displayText;
        fragment.appendChild(option);
    });

    // Add all options at once
    select.appendChild(fragment);
}

// Load and display news
async function loadNewsTab() {
    populateNewsStockFilter();
    // Only show empty state with dropdown - don't fetch news yet
    const newsContainer = document.getElementById('newsContainer');
    newsContainer.innerHTML = '<div class="news-empty"><div class="news-empty-icon">📰</div><div>Select a stock or view all stocks</div></div>';
    // Automatically load news for "All Stocks" after dropdown is rendered
    setTimeout(() => displayNews(), 0);
}

// Display news with current filters
async function displayNews() {
    const stockFilter = document.getElementById('newsStockFilter').value;
    const days = parseInt(document.getElementById('newsTimeFilter').value);
    const newsContainer = document.getElementById('newsContainer');

    newsContainer.innerHTML = '<div class="news-loading">Loading news...</div>';

    try {
        let allNews = [];
        let tickers = [];

        if (stockFilter) {
            tickers = [stockFilter];
        } else {
            tickers = portfolio.positions.map(p => p.ticker);
        }

        // Fetch news for all selected tickers in parallel batches (4 concurrent)
        const BATCH_SIZE = 4;
        for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
            const batch = tickers.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(ticker =>
                getNewsWithCache(ticker, days).then(result => ({
                    ticker,
                    result
                }))
            );
            const batchResults = await Promise.all(batchPromises);

            for (const { ticker, result } of batchResults) {
                if (result.news && Array.isArray(result.news)) {
                    allNews = allNews.concat(result.news.map(article => ({
                        ...article,
                        ticker: ticker
                    })));
                }
            }
        }

        // Sort by date (newest first)
        allNews.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));

        if (allNews.length === 0) {
            newsContainer.innerHTML = `
                <div class="news-empty">
                    <div class="news-empty-icon">📰</div>
                    <div>No news found for the selected period</div>
                </div>
            `;
            return;
        }

        // Render news articles
        newsContainer.innerHTML = allNews.map(article => {
            const date = new Date(article.datetime * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });

            // Find current price info for the ticker if available
            let dailyChange = null;
            let dailyChangeClass = '';

            if (enrichedPositions && enrichedPositions.length > 0) {
                const enriched = enrichedPositions.find(e => e.ticker === article.ticker);
                if (enriched && !enriched.error && enriched.dailyChangePercent !== undefined && enriched.dailyChangePercent !== null) {
                    dailyChange = enriched.dailyChangePercent;
                    dailyChangeClass = dailyChange >= 0 ? 'positive' : 'negative';
                }
            }

            return `
                <a href="${article.url}" target="_blank" class="news-article">
                    <div class="news-headline">${escapeHtml(article.headline)}</div>
                    <div class="news-date-summary">
                        <span class="news-date">${date}</span>
                        <span class="news-summary">${escapeHtml(article.summary ? article.summary.substring(0, 200) : 'No summary available')}${article.summary && article.summary.length > 200 ? '...' : ''}</span>
                    </div>
                    <div class="news-footer">
                        <span class="news-source">${escapeHtml(article.source || 'Unknown')}</span>
                        <span class="news-ticker">${article.ticker}</span>
                        ${dailyChange !== null && typeof dailyChange === 'number' ? `<span class="news-return ${dailyChangeClass}">${dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(2)}%</span>` : ''}
                    </div>
                </a>
            `;
        }).join('');
    } catch (error) {
        newsContainer.innerHTML = `
            <div class="news-empty">
                <div class="news-empty-icon">⚠️</div>
                <div>Error loading news. Please try again.</div>
            </div>
        `;
        console.error('Error loading news:', error);
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Add filter event listeners
document.addEventListener('DOMContentLoaded', () => {
    const newsStockFilter = document.getElementById('newsStockFilter');
    const newsTimeFilter = document.getElementById('newsTimeFilter');

    if (newsStockFilter) {
        newsStockFilter.addEventListener('change', () => displayNews());
    }
    if (newsTimeFilter) {
        newsTimeFilter.addEventListener('change', () => displayNews());
    }
});

// Wire top add button to show add position view
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'addNewPositionTopBtn') {
        // Reset editing state
        editingPositionIndex = -1;
        document.getElementById('addPositionForm').reset();
        document.getElementById('ticker').disabled = false;
        document.getElementById('addPositionBtn').textContent = 'Add Position';
        updateTotalInvestment();
        showView('addPositionView');
    }
});

// Render portfolio dashboard continues...
async function renderPortfolioDashboard() {
    console.log('renderPortfolioDashboard called');
    console.log('Portfolio positions:', portfolio.positions);
    console.log('Portfolio object:', portfolio);
    console.log('Portfolio.positions length:', portfolio.positions ? portfolio.positions.length : 'undefined');

    // Validate and sync cache at dashboard render time
    loadHistoricalCache();

    document.getElementById('portfolioNameDisplay').textContent = portfolio.name;

    if (portfolio.positions.length === 0) {
        console.log('No positions - showing empty state');
        // Destroy existing chart if it exists
        if (portfolioChart) {
            portfolioChart.destroy();
            portfolioChart = null;
        }
        // Hide chart and show no data message
        const chartContainer = document.getElementById('chartContainer');
        const chartNoData = document.getElementById('chartNoData');
        if (chartContainer) {
            chartContainer.style.display = 'none';
        }
        if (chartNoData) {
            chartNoData.style.display = 'block';
        }
        document.getElementById('positionsTableBody').innerHTML = `
            <tr>
                <td colspan="9" class="empty-state">
                    <div>No positions yet. Add your first position to get started.</div>
                </td>
            </tr>
        `;
        document.getElementById('totalValueHeader').textContent = formatCurrency(0);
        document.getElementById('totalInvestedHeader').textContent = formatCurrency(0);
        document.getElementById('totalGainLossHeader').textContent = formatCurrency(0);
        document.getElementById('totalGainLossHeader').className = 'metric-value';
        document.getElementById('totalReturnHeader').textContent = '0.00%';
        document.getElementById('totalReturnHeader').className = 'metric-value';
        document.getElementById('portfolioSubtitle').textContent = `0 positions`;
        return;
    }

    hideLoading();

    // Calculate total invested (constant - based on cost basis)
    let constantTotalInvested = 0;
    portfolio.positions.forEach(pos => {
        constantTotalInvested += pos.shares * pos.purchasePrice;
    });
    window.portfolioTotalInvested = constantTotalInvested;

    // ========================================
    // CACHE-FIRST LOADING STRATEGY
    // ========================================
    // Step 1: Check cache and render immediately if available (100-200ms)
    // Step 2: Fetch fresh data in background and update when ready

    const cachedDashboard = getCachedDashboardData(activePortfolioId);
    if (cachedDashboard && cachedDashboard.enrichedPositions && cachedDashboard.chartHistory) {
        const cachedValue = cachedDashboard.enrichedPositions.reduce((sum, pos) => sum + pos.positionValue, 0);
        const cachedReturn = constantTotalInvested > 0 ? ((cachedValue - constantTotalInvested) / constantTotalInvested) * 100 : 0;
        console.log(`⚡ [CACHE HIT] Rendering dashboard from cache: value=$${cachedValue.toFixed(2)}, return=${cachedReturn.toFixed(2)}% (${cachedDashboard.enrichedPositions.length} positions, ${cachedDashboard.chartHistory.length} chart points)`);
        enrichedPositions = cachedDashboard.enrichedPositions;
        renderDashboardFromData(cachedDashboard.enrichedPositions, cachedDashboard.chartHistory, constantTotalInvested);
    } else {
        console.log('📊 [NO CACHE] No cache found - showing skeleton loaders');
        showSkeletonLoaders();
    }

    // Now fetch fresh data in background
    try {
        const renderStartTime = performance.now();
        console.log('🔄 [BACKGROUND FETCH] Fetching fresh data in background...');

        const completeDataResult = await fetchCompletePortfolioData(portfolio.positions);
        const fetchDuration = performance.now() - renderStartTime;

        if (!completeDataResult || !completeDataResult.enrichedPositions || completeDataResult.enrichedPositions.length === 0) {
            throw new Error('No portfolio data returned from complete data fetch');
        }

        enrichedPositions = completeDataResult.enrichedPositions;

        // Calculate fresh data metrics
        const freshValue = completeDataResult.enrichedPositions.reduce((sum, pos) => sum + pos.positionValue, 0);
        const freshReturn = constantTotalInvested > 0 ? ((freshValue - constantTotalInvested) / constantTotalInvested) * 100 : 0;

        // Calculate chart history AFTER complete data is fetched
        console.log(`✅ [FRESH DATA RECEIVED] Fresh data received (took ${fetchDuration.toFixed(0)}ms): value=$${freshValue.toFixed(2)}, return=${freshReturn.toFixed(2)}% - calculating chart history...`);
        const fullHistory = calculatePortfolioHistory(enrichedPositions);

        // Render with fresh data
        console.log(`🔄 [UPDATING DASHBOARD] Replacing cached display with fresh data...`);
        renderDashboardFromData(enrichedPositions, fullHistory, constantTotalInvested);

        // Cache the COMPLETE data for next visit
        cacheDashboardData(portfolio.id, enrichedPositions, fullHistory);

        // Update portfolio return percentage in switcher (on-demand, not background polling)
        await updatePortfolioReturnsFromCurrent();

        const totalRenderDuration = performance.now() - renderStartTime;
        console.log('═══════════════════════════════════════');
        console.log('⏱️  FULL PAGE LOAD PERFORMANCE');
        console.log('═══════════════════════════════════════');
        console.log(`Data fetch (backend):              ${completeDataResult.loadTime.toFixed(0)}ms`);
        console.log(`TOTAL TIME TO VISIBLE:            ${totalRenderDuration.toFixed(0)}ms`);
        console.log('═══════════════════════════════════════');
        console.log(`✓ Fresh data load complete. Dashboard updated: value=$${freshValue.toFixed(2)}, return=${freshReturn.toFixed(2)}%`);

        // Start real-time polling if market is open
        startRealTimePolling();

    } catch (error) {
        console.error('Error fetching fresh portfolio data:', error);
        // Fallback: keep cached version visible if it was shown
        if (!cachedDashboard) {
            document.getElementById('portfolioSubtitle').textContent = `Error loading portfolio: ${error.message}`;
        } else {
            console.log('⚠️ Fresh data fetch failed, but cached data is still visible');
            // Re-render cached data to ensure chart is visible (not stuck in loading state)
            renderDashboardFromData(cachedDashboard.enrichedPositions, cachedDashboard.chartHistory, constantTotalInvested);
        }
        startRealTimePolling();  // Still start polling to try recovery
    }
}

// Fetch instant stock data for two-phase rendering strategy
async function fetchInstantStockData(position) {
    try {
        // Use the new /instant endpoint for two-phase rendering
        const response = await fetch(`${API_URL}/stock/${position.ticker}/instant`, {
            signal: globalAbortController.signal
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch instant data for ${position.ticker}`);
        }

        const instantData = await response.json();
        return instantData;  // Return the full response for two-phase logic
    } catch (error) {
        console.error(`Error fetching instant data for ${position.ticker}:`, error);

        // Return fallback data structure
        return {
            ticker: position.ticker,
            company_name: position.ticker,
            market_open: false,
            timestamp: new Date().toISOString(),
            last_close: null,  // No cached price available
            current_price: null,
            change_amount: null,
            change_percent: null,
            previous_close: null,
            error: true
        };
    }
}

// Sorting functions
function sortPositions(column) {
    // Toggle direction if clicking same column, otherwise start ascending
    if (sortState.column === column) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.column = column;
        sortState.direction = 'asc';
    }

    // Get all rows and extract sort values from the table
    const rows = Array.from(document.querySelectorAll('tr[data-ticker]'));

    const rowData = rows.map(row => {
        const ticker = row.dataset.ticker;
        const cells = row.querySelectorAll('td');

        // Parse values from cells (position may vary based on layout)
        // Ticker: cells[0], Shares: cells[1], PurchasePrice: cells[2], CurrentPrice: cells[3],
        // PositionValue: cells[4], GainLoss: cells[5], Return%: cells[6]

        let sortValue = null;

        switch(column) {
            case 'ticker':
                sortValue = ticker.toUpperCase();
                break;
            case 'positionValue':
                // Parse position value from cell 4
                const posValueText = cells[4]?.textContent || '0';
                sortValue = parseFloat(posValueText.replace(/[$,]/g, '')) || 0;
                break;
            case 'gainLoss':
                // Parse gain/loss from cell 5
                const gainLossText = cells[5]?.textContent || '0';
                sortValue = parseFloat(gainLossText.replace(/[$,+]/g, '')) || 0;
                // Handle negative values
                if (gainLossText.includes('-')) sortValue = -Math.abs(sortValue);
                break;
            case 'gainLossPercent':
                // Parse return % from cell 6
                const returnText = cells[6]?.textContent || '0';
                sortValue = parseFloat(returnText.replace(/[%+]/g, '')) || 0;
                // Handle negative values
                if (returnText.includes('-')) sortValue = -Math.abs(sortValue);
                break;
            default:
                sortValue = 0;
        }

        return { row, sortValue, ticker };
    });

    // Sort the row data
    rowData.sort((a, b) => {
        if (typeof a.sortValue === 'string') {
            return sortState.direction === 'asc'
                ? a.sortValue.localeCompare(b.sortValue)
                : b.sortValue.localeCompare(a.sortValue);
        } else {
            return sortState.direction === 'asc'
                ? a.sortValue - b.sortValue
                : b.sortValue - a.sortValue;
        }
    });

    // Re-render the table with sorted rows
    const tbody = document.getElementById('positionsTableBody');
    rowData.forEach(item => {
        tbody.appendChild(item.row);
    });

    updateSortIndicators(column);
}

function updateSortIndicators(activeColumn) {
    // Clear all active indicators
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.classList.remove('active');
        const indicator = header.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = '';
        }
    });

    // Set active column indicator
    const activeHeader = document.querySelector(`[data-sort="${activeColumn}"]`);
    if (activeHeader) {
        activeHeader.classList.add('active');
        const indicator = activeHeader.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = sortState.direction === 'asc' ? '↑' : '↓';
        }
    }
}
