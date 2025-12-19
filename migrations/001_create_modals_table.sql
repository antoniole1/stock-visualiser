-- Create modals table for storing modal content configuration
CREATE TABLE IF NOT EXISTS modals (
    id BIGSERIAL PRIMARY KEY,
    modal_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body_text TEXT NOT NULL,
    warning_text TEXT,
    cancel_button_text TEXT NOT NULL DEFAULT 'Cancel',
    confirm_button_text TEXT NOT NULL,
    confirm_button_color TEXT NOT NULL DEFAULT 'danger',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index on modal_key for faster lookups
CREATE INDEX IF NOT EXISTS idx_modals_modal_key ON modals(modal_key);

-- Insert initial data for delete_position modal
INSERT INTO modals (
    modal_key,
    title,
    body_text,
    warning_text,
    cancel_button_text,
    confirm_button_text,
    confirm_button_color
) VALUES (
    'delete_position',
    'Delete position',
    'Are you sure you want to delete {ticker} ({shares} shares)?',
    'Once deleted, the data will disappear from the backend and it will not be possible to retrieve it again.',
    'Cancel',
    'Delete position',
    'danger'
)
ON CONFLICT (modal_key) DO UPDATE SET
    title = EXCLUDED.title,
    body_text = EXCLUDED.body_text,
    warning_text = EXCLUDED.warning_text,
    cancel_button_text = EXCLUDED.cancel_button_text,
    confirm_button_text = EXCLUDED.confirm_button_text,
    confirm_button_color = EXCLUDED.confirm_button_color,
    updated_at = now();

-- Enable RLS (Row Level Security)
ALTER TABLE modals ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Allow public read access to modals" ON modals;

-- Create policy to allow public read access to modals
CREATE POLICY "Allow public read access to modals" ON modals
    FOR SELECT
    TO public
    USING (true);
