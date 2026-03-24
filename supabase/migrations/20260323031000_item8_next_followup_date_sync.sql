-- =====================================================================
-- Item 8: next_followup_date sync trigger + backfill
--
-- Ensures leads.next_followup_date always reflects the earliest
-- pending follow-up's scheduled_for date. Fires automatically on
-- any insert/update/delete to follow_ups.
-- =====================================================================

-- 1. Trigger function: recalculates next_followup_date for the affected lead
CREATE OR REPLACE FUNCTION sync_lead_next_followup_date()
RETURNS trigger AS $$
DECLARE
  target_lead_id bigint;
BEGIN
  target_lead_id := COALESCE(NEW.lead_id, OLD.lead_id);

  UPDATE leads SET next_followup_date = (
    SELECT MIN(scheduled_for)::date
    FROM follow_ups
    WHERE lead_id = target_lead_id
    AND status = 'pending'
  )
  WHERE id = target_lead_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger on follow_ups (AFTER so we see the committed row state)
DROP TRIGGER IF EXISTS trg_sync_next_followup_date ON follow_ups;
CREATE TRIGGER trg_sync_next_followup_date
AFTER INSERT OR UPDATE OR DELETE ON follow_ups
FOR EACH ROW
EXECUTE FUNCTION sync_lead_next_followup_date();

-- 3. Partial index for fast pending lookups
CREATE INDEX IF NOT EXISTS idx_follow_ups_pending_by_lead
ON follow_ups (lead_id, scheduled_for)
WHERE status = 'pending';

-- 4. Backfill: set next_followup_date for leads with pending FUs
UPDATE leads SET next_followup_date = sub.min_date
FROM (
  SELECT lead_id, MIN(scheduled_for)::date AS min_date
  FROM follow_ups
  WHERE status = 'pending'
  GROUP BY lead_id
) sub
WHERE leads.id = sub.lead_id;

-- 5. Clear orphans: leads with next_followup_date but no pending FU
UPDATE leads SET next_followup_date = NULL
WHERE next_followup_date IS NOT NULL
AND id NOT IN (
  SELECT DISTINCT lead_id FROM follow_ups WHERE status = 'pending'
);

-- 6. Utility RPC for manual repair
CREATE OR REPLACE FUNCTION sync_next_followup_date(p_lead_id bigint)
RETURNS void AS $$
BEGIN
  UPDATE leads SET next_followup_date = (
    SELECT MIN(scheduled_for)::date
    FROM follow_ups
    WHERE lead_id = p_lead_id
    AND status = 'pending'
  )
  WHERE id = p_lead_id;
END;
$$ LANGUAGE plpgsql;
