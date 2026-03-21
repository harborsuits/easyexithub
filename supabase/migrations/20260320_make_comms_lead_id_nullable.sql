-- Allow communications to be logged without a specific lead
-- (e.g., ambiguous inbound calls, unknown callers)
ALTER TABLE communications ALTER COLUMN lead_id DROP NOT NULL;
