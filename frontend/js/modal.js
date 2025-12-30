/**
 * Modal Management System
 * Provides a reusable modal component backed by Supabase configuration
 */

// Modal state management
const modalState = {
    currentModal: null,
    currentConfig: null,
    pendingAction: null,
    pendingActionCancel: null
};

// Modal configuration cache
const modalConfigCache = {};

// Fallback hardcoded modal configurations (for when backend is unavailable)
const fallbackModalConfigs = {
    delete_position: {
        title: 'Delete position',
        body_text: 'Are you sure you want to delete {ticker} ({shares} shares)?',
        warning_text: 'Once deleted, the data will disappear from the backend and it will not be possible to retrieve it again.',
        cancel_button_text: 'Cancel',
        confirm_button_text: 'Delete position',
        confirm_button_color: 'danger'
    },
    delete_portfolio: {
        title: 'Delete portfolio',
        body_text: 'Are you sure you want to delete this portfolio?',
        cancel_button_text: 'Close',
        confirm_button_text: 'Delete portfolio',
        confirm_button_color: 'danger'
    },
    add_portfolio: {
        title: 'Add new portfolio',
        body_text: 'Enter a name for your new portfolio',
        placeholder_text: 'Portfolio name',
        cancel_button_text: 'Cancel',
        confirm_button_text: 'Create portfolio',
        confirm_button_color: 'primary'
    },
    rename_portfolio: {
        title: 'Rename portfolio',
        body_text: 'Change name to your portfolio',
        placeholder_text: 'Portfolio name',
        cancel_button_text: 'Close',
        confirm_button_text: 'Save',
        confirm_button_color: 'primary'
    }
};

/**
 * Fetch modal configuration from backend with caching and fallback
 * @param {string} modalKey - The unique key for the modal (e.g., 'delete_position')
 * @returns {Promise<Object>} Modal configuration object
 */
async function fetchModalConfig(modalKey) {
    const fetchStartTime = performance.now();

    // Check cache first
    if (modalConfigCache[modalKey]) {
        console.log(`[MODAL] Using cached config for: ${modalKey}`);
        return modalConfigCache[modalKey];
    }

    console.log(`[MODAL] Fetching config for: ${modalKey}`);

    try {
        const response = await fetch(`${API_URL}/modals/${modalKey}`);
        const fetchEndTime = performance.now();
        const fetchDuration = (fetchEndTime - fetchStartTime).toFixed(2);

        console.log(`[MODAL] Fetch completed in ${fetchDuration}ms`);

        if (!response.ok) {
            console.error(`[MODAL] Failed to fetch modal config: ${response.statusText}`);
            // Try fallback config
            if (fallbackModalConfigs[modalKey]) {
                console.log(`[MODAL] Using fallback config for: ${modalKey}`);
                return fallbackModalConfigs[modalKey];
            }
            return null;
        }

        const config = await response.json();
        const parseEndTime = performance.now();
        const parseDuration = (parseEndTime - fetchEndTime).toFixed(2);
        console.log(`[MODAL] JSON parsed in ${parseDuration}ms`);

        // Cache the config
        modalConfigCache[modalKey] = config;

        return config;
    } catch (error) {
        console.error(`[MODAL] Error fetching modal config: ${error}`);
        // Try fallback config
        if (fallbackModalConfigs[modalKey]) {
            console.log(`[MODAL] Using fallback config for: ${modalKey} (fetch failed)`);
            return fallbackModalConfigs[modalKey];
        }
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
        modalState.pendingActionCancel = onCancel;

        console.log(`[MODAL] Stored callbacks: pendingAction=${typeof onConfirm}, pendingActionCancel=${typeof onCancel}`);

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
    console.log(`[MODAL] confirmModalAction() called`);
    console.log(`[MODAL] pendingAction type: ${typeof modalState.pendingAction}`);

    if (modalState.pendingAction && typeof modalState.pendingAction === 'function') {
        try {
            console.log(`[MODAL] Disabling buttons...`);

            // Disable the confirm button to prevent multiple clicks
            const confirmBtn = document.querySelector('.modal-content button[onclick="confirmModalAction()"]');
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
                confirmBtn.style.cursor = 'not-allowed';
            }

            // Disable the cancel button as well
            const cancelBtn = document.querySelector('.modal-content button[onclick="closeModal()"]');
            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.style.opacity = '0.5';
                cancelBtn.style.cursor = 'not-allowed';
            }

            console.log(`[MODAL] Executing pending action...`);
            // Execute the callback and wait for it to complete
            const result = await modalState.pendingAction();
            console.log(`[MODAL] Action completed successfully`);

            // Close modal only after action completes
            closeModal();

            return result;
        } catch (error) {
            console.error('[MODAL] Error executing modal action:', error);
            // Close modal on error as well
            closeModal();
        }
    } else {
        console.error(`[MODAL] No pending action or action is not a function!`);
    }
}

/**
 * Close the modal and reset state
 */
function closeModal() {
    console.log(`[MODAL] closeModal() called`);

    const modal = document.getElementById('genericModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Call cancel callback if provided before resetting state
    if (modalState.pendingActionCancel && typeof modalState.pendingActionCancel === 'function') {
        console.log(`[MODAL] Executing cancel callback`);
        try {
            modalState.pendingActionCancel();
        } catch (error) {
            console.error('[MODAL] Error executing cancel callback:', error);
        }
    }

    // Reset state
    modalState.currentModal = null;
    modalState.currentConfig = null;
    modalState.pendingAction = null;
    modalState.pendingActionCancel = null;
}

/**
 * Show modal with text input field (for portfolio creation, etc)
 * @param {string} modalKey - The unique key for the modal (e.g., 'add_portfolio')
 * @param {Function} onConfirm - Callback function when user confirms, receives input value
 * @param {Function} onCancel - Optional callback function when user cancels
 * @param {string} initialValue - Optional initial value for the input field
 */
async function showInputModal(modalKey, onConfirm, onCancel = null, initialValue = '') {
    console.log(`[MODAL] showInputModal() called for: ${modalKey}`);

    try {
        // Fetch configuration from backend
        const config = await fetchModalConfig(modalKey);

        if (!config) {
            console.error(`[MODAL] Failed to load modal: ${modalKey}`);
            return;
        }

        // Store the configuration and callbacks in state
        modalState.currentModal = modalKey;
        modalState.currentConfig = config;
        modalState.pendingAction = onConfirm;
        modalState.pendingActionCancel = onCancel;

        // Create the input modal in the DOM
        createOrUpdateInputModalDOM(config, initialValue);

        // Show the modal
        const modal = document.getElementById('genericModal');
        if (modal) {
            modal.style.display = 'flex';
        }

        console.log(`[MODAL] Input modal displayed`);

    } catch (error) {
        console.error(`[MODAL] Error showing input modal: ${error}`);
    }
}

/**
 * Create or update the input modal in the DOM
 * @param {Object} config - Modal configuration from database
 * @param {string} initialValue - Optional initial value for the input field
 */
function createOrUpdateInputModalDOM(config, initialValue = '') {
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

    // Determine button color class
    const getButtonColorClass = (color) => {
        const colorMap = {
            'danger': 'btn-delete-confirm',
            'warning': 'btn-warning-confirm',
            'primary': 'btn-primary-confirm'
        };
        return colorMap[color] || 'btn-delete-confirm';
    };

    // Build the input modal HTML
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
                <p>${config.body_text}</p>
                <input
                    type="text"
                    id="modalInputField"
                    class="form-input"
                    placeholder="${config.placeholder_text || 'Enter text'}"
                    value="${initialValue}"
                    maxlength="50"
                    autofocus
                />
            </div>
            <div class="modal-footer">
                <button class="btn-cancel" onclick="closeModal()">${config.cancel_button_text}</button>
                <button class="${getButtonColorClass(config.confirm_button_color)}" onclick="confirmInputModalAction()">${config.confirm_button_text}</button>
            </div>
        </div>
    `;

    modal.innerHTML = modalHTML;
}

/**
 * Confirm the input modal action and execute the callback with the input value
 */
async function confirmInputModalAction() {
    console.log(`[MODAL] confirmInputModalAction() called`);
    const inputField = document.getElementById('modalInputField');
    const inputValue = inputField ? inputField.value.trim() : '';

    if (!inputValue) {
        console.warn('[MODAL] Input field is empty');
        return;
    }

    if (modalState.pendingAction && typeof modalState.pendingAction === 'function') {
        try {
            console.log(`[MODAL] Executing pending action with input: ${inputValue}`);

            // Disable the confirm button to prevent multiple clicks
            const confirmBtn = document.querySelector('.modal-content button[onclick="confirmInputModalAction()"]');
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
                confirmBtn.style.cursor = 'not-allowed';
            }

            // Execute the callback with the input value and wait for it to complete
            const result = await modalState.pendingAction(inputValue);
            console.log(`[MODAL] Action completed successfully`);

            // Close modal only after action completes
            closeModal();

            return result;
        } catch (error) {
            console.error('[MODAL] Error executing input modal action:', error);
            // Close modal on error as well
            closeModal();
        }
    } else {
        console.error(`[MODAL] No pending action or action is not a function!`);
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
