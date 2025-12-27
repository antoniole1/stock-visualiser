-- Add missing modal configurations to the modals table
-- This uses ON CONFLICT DO UPDATE to safely insert or update modals

-- Add delete_portfolio modal
INSERT INTO modals (
    modal_key,
    title,
    body_text,
    cancel_button_text,
    confirm_button_text,
    confirm_button_color
) VALUES (
    'delete_portfolio',
    'Delete portfolio',
    'Are you sure you want to delete this portfolio?',
    'Close',
    'Delete portfolio',
    'danger'
)
ON CONFLICT (modal_key) DO UPDATE SET
    title = EXCLUDED.title,
    body_text = EXCLUDED.body_text,
    cancel_button_text = EXCLUDED.cancel_button_text,
    confirm_button_text = EXCLUDED.confirm_button_text,
    confirm_button_color = EXCLUDED.confirm_button_color,
    updated_at = now();

-- Add add_portfolio modal
INSERT INTO modals (
    modal_key,
    title,
    body_text,
    cancel_button_text,
    confirm_button_text,
    confirm_button_color
) VALUES (
    'add_portfolio',
    'Add new portfolio',
    'Enter a name for your new portfolio',
    'Cancel',
    'Create portfolio',
    'primary'
)
ON CONFLICT (modal_key) DO UPDATE SET
    title = EXCLUDED.title,
    body_text = EXCLUDED.body_text,
    cancel_button_text = EXCLUDED.cancel_button_text,
    confirm_button_text = EXCLUDED.confirm_button_text,
    confirm_button_color = EXCLUDED.confirm_button_color,
    updated_at = now();
