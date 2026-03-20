-- Add webhook_processed_at for idempotency
-- Prevents duplicate webhook processing
ALTER TABLE communications ADD COLUMN IF NOT EXISTS webhook_processed_at timestamptz;

-- Backfill: mark all existing communications as processed
UPDATE communications SET webhook_processed_at = created_at WHERE webhook_processed_at IS NULL;

-- Index for fast lookup by vapi_call_id + processed status
CREATE INDEX IF NOT EXISTS idx_comms_vapi_call_id ON communications (vapi_call_id) WHERE vapi_call_id IS NOT NULL;
