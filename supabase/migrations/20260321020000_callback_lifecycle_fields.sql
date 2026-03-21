-- Phase 4B.1: Callback lifecycle fields on leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS callback_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS callback_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS callback_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS callback_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS callback_resolution text,
  ADD COLUMN IF NOT EXISTS callback_resolution_at timestamptz;

-- Check constraint for allowed callback_status values
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT chk_callback_status
    CHECK (callback_status IN ('none','pending','due','attempted','missed_once','missed_multiple','completed','canceled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for engine queries
CREATE INDEX IF NOT EXISTS idx_leads_callback_status ON leads(callback_status) WHERE callback_status != 'none';
CREATE INDEX IF NOT EXISTS idx_leads_callback_due_at ON leads(callback_due_at) WHERE callback_due_at IS NOT NULL;
