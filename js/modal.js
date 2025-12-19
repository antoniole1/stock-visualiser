/**
 * Modal Management System
 * Provides a reusable modal component backed by Supabase configuration
 */

// Modal state management
const modalState = {
    currentModal: null,
    currentConfig: null,
    pendingAction: null,
    pendingActionData: null
};

/**
 * Fetch modal configuration from backend
 * @param {string} modalKey - The unique key for the modal (e.g., 'delete_position')
 * @returns {Promise<Object>} Modal configuration object
 */
async function fetchModalConfig(modalKey) {
    const fetchStartTime = performance.now();
    console.log(`[MODAL] Fetching config for: ${modalKey}`);

    try {
        const response = await fetch(`${API_URL}/modals/${modalKey}`);
        const fetchEndTime = performance.now();
        const fetchDuration = (fetchEndTime - fetchStartTime).toFixed(2);

        console.log(`[MODAL] Fetch completed in ${fetchDuration}ms`);

        if (!response.ok) {
            console.error(`[MODAL] Failed to fetch modal config: ${response.statusText}`);
            return null;
        }

        const config = await response.json();
        const parseEndTime = performance.now();
        const parseDuration = (parseEndTime - fetchEndTime).toFixed(2);
        console.log(`[MODAL] JSON parsed in ${parseDuration}ms`);

        return config;
    } catch (error) {
        console.error(`[MODAL] Error fetching modal config: ${error}`);
        return null;
    }
}

/**
 * Initialize a modal with configuration from backend
 * @param {string} modalKey - The unique key for the modal
 * @param {Object} variables - Variables to interpolate in the modal text (e.g., {ticker: 'AAPL', shares: 100})
 * @param {Function} onConfirm - Callback function when user confirms
 * @param {Function} onCancel - Optional callback function when user cancels
 */
async function showModal(modalKey, variables = {}, onConfirm, onCancel = null) {
    const overallStartTime = performance.now();
    console.log(`[MODAL] showModal() called for: ${modalKey}`);

    try {
        // Fetch configuration from backend
        const fetchStartTime = performance.now();
        const config = await fetchModalConfig(modalKey);
        const fetchCompleteTime = performance.now();
        console.log(`[MODAL] Config fetch + parse took: ${(fetchCompleteTime - fetchStartTime).toFixed(2)}ms`);

        if (!config) {
            console.error(`[MODAL] Failed to load modal: ${modalKey}`);
            return;
        }

        // Store the configuration and callbacks in state
        modalState.currentModal = modalKey;
        modalState.currentConfig = config;
        modalState.pendingAction = onConfirm;
        modalState.pendingActionData = onCancel;

        // Create or update the modal in the DOM
        const domStartTime = performance.now();
        createOrUpdateModalDOM(config, variables);
        const domCompleteTime = performance.now();
        console.log(`[MODAL] DOM creation took: ${(domCompleteTime - domStartTime).toFixed(2)}ms`);

        // Show the modal
        const displayStartTime = performance.now();
        const modal = document.getElementById('genericModal');
        if (modal) {
            modal.style.display = 'flex';
        }
        const displayCompleteTime = performance.now();
        console.log(`[MODAL] Display toggle took: ${(displayCompleteTime - displayStartTime).toFixed(2)}ms`);

        // Total timing
        const overallCompleteTime = performance.now();
        const totalTime = (overallCompleteTime - overallStartTime).toFixed(2);
        console.log(`[MODAL] ⏱️  TOTAL TIME TO SHOW MODAL: ${totalTime}ms`);
        console.log(`[MODAL] └─ Config fetch: ${(fetchCompleteTime - fetchStartTime).toFixed(2)}ms`);
        console.log(`[MODAL] └─ DOM creation: ${(domCompleteTime - domStartTime).toFixed(2)}ms`);
        console.log(`[MODAL] └─ Display: ${(displayCompleteTime - displayStartTime).toFixed(2)}ms`);

    } catch (error) {
        console.error(`[MODAL] Error showing modal: ${error}`);
    }
}

/**
 * Create or update the generic modal in the DOM
 * @param {Object} config - Modal configuration from database
 * @param {Object} variables - Variables to interpolate in the text
 */
function createOrUpdateModalDOM(config, variables = {}) {
    let modal = document.getElementById('genericModal');

    // Create modal if it doesn't exist
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'genericModal';
        modal.className = 'modal-overlay';
        modal.onclick = (e) => {
            if (e.target.id === 'genericModal') {
                closeModal();
            }
        };
        document.body.appendChild(modal);
    }

    // Interpolate variables in text
    const interpolateText = (text) => {
        if (!text) return '';
        let result = text;
        Object.keys(variables).forEach((key) => {
            const placeholder = `{${key}}`;
            result = result.replace(new RegExp(placeholder, 'g'), variables[key]);
        });
        return result;
    };

    // Determine button color class
    const getButtonColorClass = (color) => {
        const colorMap = {
            'danger': 'btn-delete-confirm',
            'warning': 'btn-warning-confirm',
            'primary': 'btn-primary-confirm'
        };
        return colorMap[color] || 'btn-delete-confirm';
    };

    // Build the modal HTML
    const modalHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>${config.title}</h2>
                <button class="modal-close" onclick="closeModal()" aria-label="Close modal">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <p>${interpolateText(config.body_text)}</p>
                ${config.warning_text ? `<p class="modal-warning">${config.warning_text}</p>` : ''}
            </div>
            <div class="modal-footer">
                <button class="btn-cancel" onclick="closeModal()">${config.cancel_button_text}</button>
                <button class="${getButtonColorClass(config.confirm_button_color)}" onclick="confirmModalAction()">${config.confirm_button_text}</button>
            </div>
        </div>
    `;

    modal.innerHTML = modalHTML;
}

/**
 * Confirm the modal action and execute the callback
 */
async function confirmModalAction() {
    if (modalState.pendingAction) {
        try {
            // Close modal first
            closeModal();

            // Execute the callback
            await modalState.pendingAction();
        } catch (error) {
            console.error('Error executing modal action:', error);
        }
    }
}

/**
 * Close the modal and reset state
 */
function closeModal() {
    const modal = document.getElementById('genericModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Reset state
    modalState.currentModal = null;
    modalState.currentConfig = null;
    modalState.pendingAction = null;
    modalState.pendingActionData = null;

    // Call cancel callback if provided (stored in pendingActionData)
    if (modalState.pendingActionData && typeof modalState.pendingActionData === 'function') {
        modalState.pendingActionData();
    }
}

/**
 * Initialize modals in backend (creates the modals table and seed data)
 * Call this once to set up the modals system
 */
async function initializeModalSystem() {
    try {
        const response = await fetch(`${API_URL}/modals/init`, {
            method: 'POST'
        });

        if (response.ok) {
            console.log('✓ Modal system initialized');
            return true;
        } else {
            console.warn('Modal system initialization returned non-200 status');
            return false;
        }
    } catch (error) {
        console.warn('Error initializing modal system (modals table may already exist):', error);
        return false;
    }
}
