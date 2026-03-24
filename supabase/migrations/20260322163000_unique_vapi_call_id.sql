-- Add unique index on communications.vapi_call_id
-- Prevents duplicate comm rows from webhook retries or race conditions
-- WHERE clause allows nulls (non-Vapi comms have null vapi_call_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_communications_vapi_call_id_unique
  ON communications (vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;
