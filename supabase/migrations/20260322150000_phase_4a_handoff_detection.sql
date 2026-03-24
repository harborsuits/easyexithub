-- Phase 4A: Outbound handoff detection & trigger classification
-- Adds fields to track when AI detects seller interest and needs human takeover

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS handoff_priority text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS handoff_trigger_phrase text,
  ADD COLUMN IF NOT EXISTS handoff_trigger_source text,
  ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_assigned_to text,
  ADD COLUMN IF NOT EXISTS handoff_completed_at timestamptz;

-- Constraint: handoff_priority enum
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT chk_handoff_priority
    CHECK (handoff_priority IN ('none','hot_interest','warm_interest','manual_review'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Constraint: handoff_trigger_source enum
DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT chk_handoff_trigger_source
    CHECK (handoff_trigger_source IN ('ai_outbound','inbound_callback','manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for engine queries
CREATE INDEX IF NOT EXISTS idx_leads_handoff_status_pending 
  ON leads(handoff_status, handoff_requested_at DESC) 
  WHERE handoff_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_leads_handoff_priority 
  ON leads(handoff_priority, handoff_requested_at DESC) 
  WHERE handoff_priority != 'none';

-- Communications table: add event_type for handoff events
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS event_type text;

-- Index for retrieving handoff-triggered calls
CREATE INDEX IF NOT EXISTS idx_comms_handoff_trigger 
  ON communications(lead_id, event_type) 
  WHERE event_type = 'handoff_triggered';

-- Follow-ups table: ensure kind supports human_callback
-- (already exists from prior phases, just documenting)
-- kind enum includes: initial_outreach, retry, callback, human_callback, recycled_outreach
