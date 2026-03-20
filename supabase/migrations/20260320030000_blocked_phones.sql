-- Phase 2: Global phone suppression table
-- Prevents blocked phones from being called through ANY lead row or reimport

CREATE TABLE IF NOT EXISTS blocked_phones (
  id bigint generated always as identity primary key,
  normalized_phone text NOT NULL,
  reason text NOT NULL,
  source_lead_id bigint REFERENCES leads(id),
  source_comm_id bigint REFERENCES communications(id),
  blocked_at timestamptz NOT NULL DEFAULT now(),
  blocked_by text NOT NULL DEFAULT 'system',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_phones_active
  ON blocked_phones (normalized_phone, reason) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_blocked_phones_lookup
  ON blocked_phones (normalized_phone) WHERE active = true;

-- Normalize phone to bare 10 digits
CREATE OR REPLACE FUNCTION normalize_phone(phone text) RETURNS text AS $$
BEGIN
  RETURN regexp_replace(
    CASE
      WHEN phone LIKE '+1%' THEN substring(phone from 3)
      WHEN phone LIKE '1%' AND length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11
        THEN substring(regexp_replace(phone, '[^0-9]', '', 'g') from 2)
      ELSE phone
    END,
    '[^0-9]', '', 'g'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill from existing suppressed leads
INSERT INTO blocked_phones (normalized_phone, reason, source_lead_id, blocked_by, notes)
SELECT DISTINCT ON (normalize_phone(l.owner_phone), 
  CASE 
    WHEN l.status = 'dnc' THEN 'dnc'
    WHEN l.wrong_number_flag = true THEN 'wrong_number'
    WHEN l.death_reason = 'wrong_number' THEN 'wrong_number'
    ELSE 'bad_number'
  END)
  normalize_phone(l.owner_phone),
  CASE 
    WHEN l.status = 'dnc' THEN 'dnc'
    WHEN l.wrong_number_flag = true THEN 'wrong_number'
    WHEN l.death_reason = 'wrong_number' THEN 'wrong_number'
    ELSE 'bad_number'
  END,
  l.id,
  'backfill',
  'Backfilled from existing lead suppression flags'
FROM leads l
WHERE l.owner_phone IS NOT NULL
  AND (l.status IN ('dnc', 'dead', 'bad_number') 
       OR l.wrong_number_flag = true
       OR l.opt_out = true)
ON CONFLICT DO NOTHING;

-- Cascade: block all leads sharing a blocked phone (exclusion_reason is text[])
UPDATE leads SET
  callable = false,
  outbound_approved = false,
  exclusion_reason = array_cat(COALESCE(exclusion_reason, ARRAY[]::text[]), ARRAY['blocked_phone'])
WHERE normalize_phone(owner_phone) IN (
  SELECT normalized_phone FROM blocked_phones WHERE active = true
)
AND callable = true;
