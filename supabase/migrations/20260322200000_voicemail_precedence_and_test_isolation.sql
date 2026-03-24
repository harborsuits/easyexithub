-- =====================================================================
-- Migration: Voicemail Precedence & Test Isolation
-- Date: 2026-03-22
--
-- 1. Add is_test_lead flag to leads table for test isolation
-- 2. Clean up lead 2544 (Ernest) — revert false "interested/qualified"
--    state caused by voicemail misclassification bug
-- =====================================================================

-- 1. Test isolation: is_test_lead column
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_test_lead BOOLEAN DEFAULT false;

COMMENT ON COLUMN leads.is_test_lead IS 
  'Test fixture flag. When true, lead is used for testing only and will not receive real outbound. '
  'trigger-call in test_mode can ONLY dial leads with is_test_lead=true.';

-- Index for quick filtering
CREATE INDEX IF NOT EXISTS idx_leads_is_test_lead ON leads (is_test_lead) WHERE is_test_lead = true;

-- 2. Fix lead 2544 (Ernest) — revert voicemail false promotion
-- Only run if lead 2544 exists and is currently in the bad state
UPDATE leads
SET
  status = CASE WHEN status = 'qualified' THEN 'new' ELSE status END,
  engagement_level = CASE WHEN engagement_level IN ('warm', 'hot') THEN 'cold' ELSE engagement_level END,
  pipeline_stage = NULL,
  state_change_reason = 'Reverted: voicemail misclassified as interest (bug fix 2026-03-22)',
  status_update_source = 'migration_fix',
  pipeline_update_source = 'migration_fix',
  compliance_hold = true,
  compliance_hold_reason = COALESCE(compliance_hold_reason, '') || ' | Voicemail misclassification fix applied 2026-03-22'
WHERE id = 2544
  AND status = 'qualified'
  AND last_disposition = 'interested';

-- Cancel any bogus follow-ups from the misclassified event
UPDATE follow_ups
SET
  status = 'canceled',
  reason = COALESCE(reason, '') || ' | Cancelled: originated from voicemail misclassification'
WHERE lead_id = 2544
  AND status = 'pending'
  AND source = 'vapi_webhook';

-- Log the fix in compliance audit
INSERT INTO compliance_audit_log (event_type, lead_id, gate_name, gate_result, reason, source)
VALUES (
  'migration_fix',
  2544,
  'voicemail_precedence_fix',
  'corrected',
  'Reverted false interested/qualified state caused by voicemail misclassification. '
  'Comm record showed voicemail but webhook promoted lead to interested. '
  'See: 20260322200000_voicemail_precedence_and_test_isolation.sql',
  'migration'
);
