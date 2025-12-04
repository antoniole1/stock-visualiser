const API_URL = '/api';

// Session authentication storage
let currentUsername = sessionStorage.getItem('portfolio_username');
let currentPassword = sessionStorage.getItem('portfolio_password');

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
        const cache = loadCacheFromStorage();
        cache[ticker] = {
            prices: priceData,
            lastUpdated: Date.now(),
            timestamp: new Date().toISOString()
        };
        saveCacheToStorage(cache);
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

function getCachedDashboardData() {
    try {
        const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
        if (!cached) return null;

        const data = JSON.parse(cached);
        const cacheAge = Date.now() - data.timestamp;

        // Use cache if less than 24 hours old
        if (cacheAge < DASHBOARD_CACHE_MAX_AGE) {
            const ageMinutes = (cacheAge / 1000 / 60).toFixed(0);
            console.log(`💾 Dashboard cache hit: ${ageMinutes}m old, ${data.chartHistory.length} chart points, ${data.enrichedPositions.length} positions`);
            return {
                enrichedPositions: data.enrichedPositions,
                chartHistory: data.chartHistory
            };
        }

        console.log('💾 Dashboard cache expired');
        return null;
    } catch (error) {
        console.error('Error reading dashboard cache:', error);
        return null;
    }
}

function cacheDashboardData(enrichedPositions, chartHistory) {
    try {
        const cacheData = {
            enrichedPositions: enrichedPositions,
            chartHistory: chartHistory,
            timestamp: Date.now()
        };
        const cacheStr = JSON.stringify(cacheData);
        const size = new Blob([cacheStr]).size;

        localStorage.setItem(DASHBOARD_CACHE_KEY, cacheStr);
        console.log(`💾 Dashboard cached: ${enrichedPositions.length} positions, ${chartHistory.length} chart points (${(size / 1024).toFixed(1)}KB)`);
    } catch (error) {
        console.error('Error caching dashboard data:', error);
        // If quota exceeded, try clearing old cache
        if (error.name === 'QuotaExceededError') {
            console.warn('⚠️ Storage quota exceeded - clearing old dashboard cache');
            localStorage.removeItem(DASHBOARD_CACHE_KEY);
        }
    }
}

function renderDashboardFromData(enrichedPositions, chartHistory, constantTotalInvested) {
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

    console.log(`✅ Dashboard rendered: ${enrichedPositions.length} positions, ${chartHistory.length} chart points, $${totalValue.toFixed(2)} total value`);
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

// View navigation functions
function showLanding() {
    showView('landingView');
}

function showCreateView() {
    showView('setupView');
}

function showLoginView() {
    showView('loginView');
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

// Create portfolio on server
async function createPortfolio(username, name, password) {
    const response = await fetch(`${API_URL}/portfolio/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, password })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Failed to create portfolio');
    }

    if (data.success) {
        currentUsername = username;
        currentPassword = password;
        sessionStorage.setItem('portfolio_username', username);
        sessionStorage.setItem('portfolio_password', password);
        portfolio = data.portfolio;
        portfolio.positions = [];
        return true;
    }
    return false;
}

// Login to portfolio
async function loginPortfolio(username, password) {
    const response = await fetch(`${API_URL}/portfolio/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Failed to load portfolio');
    }

    if (data.success) {
        currentUsername = username;
        currentPassword = password;
        sessionStorage.setItem('portfolio_username', username);
        sessionStorage.setItem('portfolio_password', password);
        portfolio = data.portfolio;
        return true;
    }
    return false;
}

// Save portfolio positions to server
async function savePortfolioToServer() {
    if (!currentUsername || !currentPassword) {
        console.warn('No username/password set, cannot save to server');
        return false;
    }

    try {
        const response = await fetch(`${API_URL}/portfolio/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUsername,
                password: currentPassword,
                positions: portfolio.positions
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Failed to save portfolio:', data.error);
            return false;
        }

        return data.success;
    } catch (error) {
        console.error('Error saving portfolio:', error);
        return false;
    }
}

// Load historical cache from localStorage
function loadHistoricalCache() {
    const saved = localStorage.getItem('portfolioHistoricalCache');
    if (saved) {
        historicalCache = JSON.parse(saved);
    }
}

// Save historical cache to localStorage
function saveHistoricalCache() {
    localStorage.setItem('portfolioHistoricalCache', JSON.stringify(historicalCache));
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
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
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

// Delete position
async function deletePosition(index) {
    const position = portfolio.positions[index];

    if (confirm(`Are you sure you want to delete ${position.ticker} (${position.shares} shares)?`)) {
        // Remove position from portfolio
        portfolio.positions.splice(index, 1);

        // Save to server
        await savePortfolioToServer();

        // Check if this was the last position with this ticker
        const hasOtherPositions = portfolio.positions.some(p => p.ticker === position.ticker);

        // If no other positions use this ticker, remove from cache
        if (!hasOtherPositions && historicalCache[position.ticker]) {
            delete historicalCache[position.ticker];
            saveHistoricalCache();
        }

        // Re-render dashboard
        renderPortfolioDashboard();
    }
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
    const response = await fetch(url);
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
            })
        });

        const lastSyncData = await lastSyncResponse.json();
        const lastSyncDates = lastSyncData.last_sync || {};
        const step1Duration = performance.now() - step1Start;
        console.log(`⏱️ [T+${step1Duration.toFixed(0)}ms] Last sync dates retrieved:`, lastSyncDates);

        // STEP 2: Fetch instant prices AND historical data in parallel for each position
        const step2Start = performance.now();
        console.log(`⏱️ [T+${(step2Start - loadStartTime).toFixed(0)}ms] Step 2: Fetching instant prices and historical data in parallel...`);
        console.log(`📊 Fetching data for ${positions.length} positions...`);

        // Create fetch promises with timeout protection
        const createTimeoutPromise = (promise, timeoutMs) => {
            return Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Fetch timeout')), timeoutMs)
                )
            ]);
        };

        const tickerTimings = {};
        const fetchPromises = positions.map(async (position, index) => {
            const tickerStart = performance.now();
            try {
                // Fetch instant price
                const instantResponse = await fetch(`${API_URL}/stock/${position.ticker}/instant`);
                const instantData = instantResponse.ok ? await instantResponse.json() : {};

                // Determine date range for historical data
                const lastSyncDate = lastSyncDates[position.ticker.toUpperCase()];
                let fromDate = position.purchaseDate;

                // Calculate 6-month lookback date for first-time fetches
                const sixMonthsAgo = new Date();
                sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

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
                if (lastSyncDate && hasCachedData && cacheIsUpToDate) {
                    // Cache is current: only fetch data after last sync date
                    const lastSync = new Date(lastSyncDate);
                    const nextDay = new Date(lastSync.getTime() + 24 * 60 * 60 * 1000);
                    fromDate = nextDay.toISOString().split('T')[0];
                    console.log(`✓ Smart fetch for ${position.ticker}: from ${fromDate} (cache current as of ${cacheDate}, last synced ${lastSyncDate})`);
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

                // Fetch historical data from calculated date range
                let historicalData = { prices: [] };
                try {
                    const histResponse = await fetch(`${API_URL}/stock/${position.ticker}/history?from_date=${fromDate}`);
                    if (histResponse.ok) {
                        historicalData = await histResponse.json();
                        // Cache it
                        if (historicalData.prices && historicalData.prices.length > 0) {
                            setCachedHistoricalPrices(position.ticker, historicalData.prices);
                        }
                    } else {
                        console.log(`No new historical data for ${position.ticker} (${histResponse.status})`);
                    }
                } catch (e) {
                    console.log(`Could not fetch new historical data for ${position.ticker}: ${e.message}`);
                }

                // Fallback: if no new data, check cache
                if (!historicalData.prices || historicalData.prices.length === 0) {
                    const cachedData = getCachedHistoricalPrices(position.ticker);
                    if (cachedData && cachedData.prices && cachedData.prices.length > 0) {
                        historicalData.prices = cachedData.prices;
                        console.log(`Using cached historical data for ${position.ticker}`);
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
        });

        // Use Promise.allSettled with 30-second timeout per individual fetch
        // This allows results to start rendering within reasonable time
        console.log(`⏱️ [T+${(performance.now() - loadStartTime).toFixed(0)}ms] Waiting for all ${positions.length} parallel fetches to complete...`);
        const completeFetchResults = await Promise.allSettled(
            fetchPromises.map((promise, i) => createTimeoutPromise(promise, 30000))
        );
        const step2Duration = performance.now() - step2Start;
        console.log(`⏱️ [T+${step2Duration.toFixed(0)}ms] All parallel fetches completed`);

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

        // Log performance summary
        console.log('═══════════════════════════════════════');
        console.log('⏱️  PERFORMANCE SUMMARY');
        console.log('═══════════════════════════════════════');
        console.log(`Step 1 (Get last-sync dates):     ${step1Duration.toFixed(0)}ms`);
        console.log(`Step 2 (Parallel fetches):        ${step2Duration.toFixed(0)}ms`);
        console.log(`Step 3 (Process results):         ${step3Duration.toFixed(0)}ms`);
        console.log(`TOTAL LOAD TIME:                  ${totalLoadDuration.toFixed(0)}ms`);
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

    if (history.length === 0) {
        // Show no data message
        canvas.style.display = 'none';
        noDataDiv.style.display = 'block';
        return;
    }

    // Show canvas, hide no data message
    canvas.style.display = 'block';
    noDataDiv.style.display = 'none';

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
                        color: '#2a2f3e',
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
    const chartContainer = document.getElementById('chartContainer');
    if (chartContainer) {
        const loadingOverlay = document.getElementById('chartLoadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
        const canvas = document.getElementById('portfolioChart');
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
const POLL_INTERVAL_MS = 5000; // Update every 5 seconds during market hours

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
    // Fetch latest prices for all positions in parallel
    const liveUpdateResults = await Promise.allSettled(
        enrichedPositions.map(async (enriched, index) => {
            if (!enriched) return null;

            const instantData = await fetchInstantStockData(enriched);
            return { index, instantData };
        })
    );

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Check if user has an active session
    if (currentUsername && currentPassword) {
        try {
            // Try to load portfolio from server with stored credentials
            await loginPortfolio(currentUsername, currentPassword);
            if (portfolio.positions.length > 0) {
                showView('portfolioView');
                await renderPortfolioDashboard();
            } else {
                showView('addPositionView');
            }
        } catch (error) {
            // Session invalid, clear and show landing
            console.error('Session invalid:', error);
            sessionStorage.removeItem('portfolio_username');
            sessionStorage.removeItem('portfolio_password');
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
            showView('addPositionView');
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
            showView('portfolioView');
            await renderPortfolioDashboard();
        } catch (error) {
            alert(error.message);
        }
    });

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
});

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
    expirationHours: 12,
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
        const response = await fetch(`${API_URL}/news/${ticker}?days=${days}`);
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

    // Add options for each position with company name and ticker
    enrichedPositions.forEach(position => {
        const option = document.createElement('option');
        option.value = position.ticker;
        // Display: "Company Name (TICKER)" or just "TICKER" if company name not available
        const displayText = position.companyName ? `${position.companyName} (${position.ticker})` : position.ticker;
        option.textContent = displayText;
        select.appendChild(option);
    });
}

// Load and display news
async function loadNewsTab() {
    populateNewsStockFilter();
    displayNews();
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

        // Fetch news for all selected tickers with 1.5 second delays
        for (let i = 0; i < tickers.length; i++) {
            const ticker = tickers[i];
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            const result = await getNewsWithCache(ticker, days);
            if (result.news && Array.isArray(result.news)) {
                allNews = allNews.concat(result.news.map(article => ({
                    ...article,
                    ticker: ticker
                })));
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
                if (enriched && !enriched.error) {
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
                        ${dailyChange !== null ? `<span class="news-return ${dailyChangeClass}">${dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(2)}%</span>` : ''}
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

    document.getElementById('portfolioNameDisplay').textContent = portfolio.name;

    if (portfolio.positions.length === 0) {
        console.log('No positions - showing empty state');
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

    const cachedDashboard = getCachedDashboardData();
    if (cachedDashboard && cachedDashboard.enrichedPositions && cachedDashboard.chartHistory) {
        console.log(`⚡ [T+0ms] CACHE HIT - Rendering dashboard from cache (${cachedDashboard.chartHistory.length} chart points)`);
        renderDashboardFromData(cachedDashboard.enrichedPositions, cachedDashboard.chartHistory, constantTotalInvested);
    } else {
        console.log('📊 [T+0ms] No cache found - showing skeleton loaders');
        showSkeletonLoaders();
    }

    // Now fetch fresh data in background
    try {
        const renderStartTime = performance.now();
        console.log('🔄 [T+100ms] Fetching fresh data in background...');

        const completeDataResult = await fetchCompletePortfolioData(portfolio.positions);
        const fetchDuration = performance.now() - renderStartTime;

        if (!completeDataResult || !completeDataResult.enrichedPositions || completeDataResult.enrichedPositions.length === 0) {
            throw new Error('No portfolio data returned from complete data fetch');
        }

        enrichedPositions = completeDataResult.enrichedPositions;

        // Calculate chart history AFTER complete data is fetched
        console.log(`✅ [T+${fetchDuration.toFixed(0)}ms] Fresh data received - calculating chart history...`);
        const fullHistory = calculatePortfolioHistory(enrichedPositions);

        // Render with fresh data
        renderDashboardFromData(enrichedPositions, fullHistory, constantTotalInvested);

        // Cache the COMPLETE data for next visit
        cacheDashboardData(enrichedPositions, fullHistory);

        const totalRenderDuration = performance.now() - renderStartTime;
        console.log('═══════════════════════════════════════');
        console.log('⏱️  FULL PAGE LOAD PERFORMANCE');
        console.log('═══════════════════════════════════════');
        console.log(`Data fetch (backend):              ${completeDataResult.loadTime.toFixed(0)}ms`);
        console.log(`TOTAL TIME TO VISIBLE:            ${totalRenderDuration.toFixed(0)}ms`);
        console.log('═══════════════════════════════════════');
        console.log('✓ Fresh data load complete. Dashboard updated and cached.');

        // Start real-time polling if market is open
        startRealTimePolling();

    } catch (error) {
        console.error('Error fetching fresh portfolio data:', error);
        // Fallback: keep cached version visible if it was shown
        if (!cachedDashboard) {
            document.getElementById('portfolioSubtitle').textContent = `Error loading portfolio: ${error.message}`;
        } else {
            console.log('⚠️ Fresh data fetch failed, but cached data is still visible');
        }
        startRealTimePolling();  // Still start polling to try recovery
    }
}

// Fetch instant stock data for two-phase rendering strategy
async function fetchInstantStockData(position) {
    try {
        // Use the new /instant endpoint for two-phase rendering
        const response = await fetch(`${API_URL}/stock/${position.ticker}/instant`);

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
