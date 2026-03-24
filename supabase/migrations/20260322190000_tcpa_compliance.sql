-- =====================================================================
-- ITEM 20: TCPA / AI VOICE COMPLIANCE
-- Strict compliance mode, consent gating, DNC enforcement,
-- disclosure/opt-out rules, compliance audit logging
-- =====================================================================

-- 1. COMPLIANCE CONFIG — system-wide compliance settings
-- Single-row table (id=1 always). Controls strict mode, DNC enforcement, etc.
CREATE TABLE IF NOT EXISTS compliance_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Master switch: when true, ALL outbound AI calls require consent + DNC clear
  strict_mode boolean NOT NULL DEFAULT true,
  -- Require explicit prior consent before AI outbound (TCPA safe harbor)
  require_prior_consent boolean NOT NULL DEFAULT true,
  -- Require DNC check before dialing (blocks if phone on internal DNC list)
  require_dnc_check boolean NOT NULL DEFAULT true,
  -- Require AI disclosure at call start (Alex must identify as AI)
  require_ai_disclosure boolean NOT NULL DEFAULT true,
  -- Auto-suppress on opt-out detection in transcript
  auto_suppress_on_optout boolean NOT NULL DEFAULT true,
  -- Maine-specific: property solicitation requires additional disclosure
  maine_solicitation_disclosure boolean NOT NULL DEFAULT true,
  -- Max cold outreach attempts before requiring explicit consent refresh
  max_cold_without_consent integer NOT NULL DEFAULT 3,
  -- DNC registry last checked timestamp (null = never checked)
  dnc_registry_last_checked timestamptz,
  -- DNC registry provider (future: 'federal_ftc', 'state_maine', etc.)
  dnc_registry_provider text,
  -- Notes for attorney review
  attorney_review_notes text,
  attorney_review_status text DEFAULT 'pending_review',
  attorney_review_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default strict config
INSERT INTO compliance_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 2. COMPLIANCE AUDIT LOG — every outbound attempt or block is recorded
-- This is the central compliance paper trail.
CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id bigint generated always as identity primary key,
  -- What happened
  event_type text NOT NULL,
    -- 'attempt_allowed'    — call passed all compliance gates
    -- 'attempt_blocked'    — call blocked by a compliance gate
    -- 'optout_detected'    — opt-out phrase detected in transcript
    -- 'dnc_added'          — phone added to DNC/block list
    -- 'consent_recorded'   — consent obtained from lead
    -- 'consent_revoked'    — consent withdrawn
    -- 'disclosure_given'   — AI disclosure confirmed in call
    -- 'disclosure_missing' — call ended without AI disclosure (violation risk)
    -- 'manual_override'    — human override of compliance gate
  -- Who/what
  lead_id bigint REFERENCES leads(id),
  phone_number text,
  call_id text,                      -- Vapi call_id if applicable
  follow_up_id bigint,               -- follow_up record if applicable
  -- Compliance details
  gate_name text,                    -- which gate triggered (e.g. 'tcpa_consent', 'dnc_check')
  gate_result text,                  -- 'pass', 'block', 'warn'
  reason text NOT NULL,              -- human-readable explanation
  -- Context snapshot (for audit reconstruction)
  consent_status text,               -- lead's consent status at time of event
  dnc_status text,                   -- DNC check result at time of event
  strict_mode boolean,               -- was strict mode on?
  -- Metadata
  source text NOT NULL DEFAULT 'system', -- 'trigger-call', 'webhook', 'engine', 'manual'
  metadata jsonb,                    -- additional context (gate details, transcript excerpt, etc.)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_audit_lead ON compliance_audit_log (lead_id, created_at DESC);
CREATE INDEX idx_compliance_audit_phone ON compliance_audit_log (phone_number, created_at DESC);
CREATE INDEX idx_compliance_audit_type ON compliance_audit_log (event_type, created_at DESC);
CREATE INDEX idx_compliance_audit_call ON compliance_audit_log (call_id) WHERE call_id IS NOT NULL;

-- 3. CONSENT RECORDS — per-lead consent tracking
-- Separate table so consent history is preserved even if lead data changes
CREATE TABLE IF NOT EXISTS consent_records (
  id bigint generated always as identity primary key,
  lead_id bigint REFERENCES leads(id),
  phone_number text NOT NULL,        -- normalized 10-digit
  -- Consent state
  consent_type text NOT NULL,
    -- 'implied_public_record'  — property is public record, initial contact permitted
    -- 'verbal_consent'         — obtained during call (Alex asked, they agreed)
    -- 'callback_consent'       — they explicitly requested a callback
    -- 'written_consent'        — signed/emailed consent (future)
    -- 'revoked'                — consent withdrawn (opt-out, DNC request)
  consent_status text NOT NULL DEFAULT 'active',
    -- 'active', 'expired', 'revoked'
  -- How obtained
  obtained_via text,                  -- 'ai_call', 'inbound_call', 'manual', 'public_record'
  obtained_at timestamptz NOT NULL DEFAULT now(),
  -- Expiry (consent doesn't last forever under TCPA)
  expires_at timestamptz,             -- null = no expiry (e.g. public record)
  -- Revocation
  revoked_at timestamptz,
  revoked_reason text,
  -- Source
  call_id text,                       -- Vapi call_id where consent obtained
  comm_id bigint REFERENCES communications(id),
  recorded_by text NOT NULL DEFAULT 'system',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_lead ON consent_records (lead_id, consent_status, obtained_at DESC);
CREATE INDEX idx_consent_phone ON consent_records (phone_number, consent_status, obtained_at DESC);

-- 4. ADD COMPLIANCE COLUMNS TO LEADS TABLE
-- These are denormalized status flags for fast gating in trigger-call

-- consent_status already exists on leads table (added earlier)
-- Ensure default is 'none' for any nulls
UPDATE leads SET consent_status = 'none' WHERE consent_status IS NULL;

-- ai_disclosure_given: has Alex identified as AI to this lead?
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_disclosure_given boolean DEFAULT false;

-- ai_disclosure_date: when was AI disclosure last given?
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_disclosure_date timestamptz;

-- compliance_hold: manual compliance hold (blocks all outbound)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS compliance_hold boolean DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS compliance_hold_reason text;

-- tcpa_eligible: computed eligibility flag (updated by trigger or function)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tcpa_eligible boolean DEFAULT true;

-- 5. BACKFILL CONSENT FROM EXISTING DATA

-- Leads that requested callbacks have callback consent
UPDATE leads SET consent_status = 'callback'
WHERE callback_status IN ('pending', 'missed_once')
  AND consent_status = 'none';

-- Leads from public property records get implied consent for initial contact
UPDATE leads SET consent_status = 'public_record'
WHERE consent_status = 'none'
  AND lead_source IN ('vgsi', 'probate', 'foreclosure', 'tax_lien')
  AND (outreach_count IS NULL OR outreach_count = 0);

-- Leads that have been contacted and engaged get verbal consent (conservative assumption)
-- Only if they showed positive engagement (warm/hot)
UPDATE leads SET consent_status = 'verbal'
WHERE consent_status = 'none'
  AND engagement_level IN ('warm', 'hot')
  AND outreach_count > 0;

-- Opted-out leads get revoked consent
UPDATE leads SET consent_status = 'revoked'
WHERE opt_out = true OR engagement_level = 'dnc';

-- Dead leads with no engagement don't get consent
-- (leave as 'none' — they'll be blocked by other gates anyway)

-- 6. COMPLIANCE-AWARE VIEW for quick dashboard queries
CREATE OR REPLACE VIEW compliance_dashboard AS
SELECT
  l.id,
  l.owner_name,
  l.owner_phone,
  l.consent_status,
  l.ai_disclosure_given,
  l.compliance_hold,
  l.tcpa_eligible,
  l.callable,
  l.outbound_approved,
  l.engagement_level,
  l.opt_out,
  CASE
    WHEN l.compliance_hold THEN 'HOLD'
    WHEN l.consent_status = 'revoked' THEN 'REVOKED'
    WHEN l.opt_out THEN 'OPTED_OUT'
    WHEN l.engagement_level = 'dnc' THEN 'DNC'
    WHEN NOT l.tcpa_eligible THEN 'INELIGIBLE'
    WHEN l.consent_status = 'none' AND COALESCE(l.outreach_count, 0) >= 3 THEN 'CONSENT_NEEDED'
    ELSE 'CLEAR'
  END AS compliance_posture,
  (SELECT count(*) FROM compliance_audit_log cal WHERE cal.lead_id = l.id AND cal.event_type = 'attempt_blocked') AS blocked_count,
  (SELECT max(cal.created_at) FROM compliance_audit_log cal WHERE cal.lead_id = l.id) AS last_compliance_event
FROM leads l;

-- 7. FUNCTION: Auto-revoke consent and suppress on opt-out
-- Called by webhook when opt-out detected in transcript
CREATE OR REPLACE FUNCTION revoke_consent_and_suppress(
  p_lead_id bigint,
  p_phone text,
  p_call_id text,
  p_reason text DEFAULT 'opt_out_detected'
) RETURNS void AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := normalize_phone(p_phone);

  -- Revoke all active consent records
  UPDATE consent_records
  SET consent_status = 'revoked',
      revoked_at = now(),
      revoked_reason = p_reason,
      updated_at = now()
  WHERE lead_id = p_lead_id
    AND consent_status = 'active';

  -- Insert revocation record
  INSERT INTO consent_records (lead_id, phone_number, consent_type, consent_status, obtained_via, revoked_at, revoked_reason, call_id, recorded_by, notes)
  VALUES (p_lead_id, v_normalized, 'revoked', 'revoked', 'ai_call', now(), p_reason, p_call_id, 'system', 'Auto-revoked on opt-out detection');

  -- Update lead
  UPDATE leads SET
    consent_status = 'revoked',
    opt_out = true,
    callable = false,
    outbound_approved = false,
    tcpa_eligible = false,
    engagement_level = 'dnc',
    updated_at = now()
  WHERE id = p_lead_id;

  -- Add to global phone block
  INSERT INTO blocked_phones (normalized_phone, reason, source_lead_id, blocked_by, notes)
  VALUES (v_normalized, 'opt_out', p_lead_id, 'compliance_auto', 'Auto-blocked on opt-out detection in call ' || COALESCE(p_call_id, 'unknown'))
  ON CONFLICT DO NOTHING;

  -- Log compliance event
  INSERT INTO compliance_audit_log (event_type, lead_id, phone_number, call_id, gate_name, reason, consent_status, source)
  VALUES ('consent_revoked', p_lead_id, v_normalized, p_call_id, 'optout_detection', p_reason, 'revoked', 'webhook');

  INSERT INTO compliance_audit_log (event_type, lead_id, phone_number, call_id, gate_name, reason, dnc_status, source)
  VALUES ('dnc_added', p_lead_id, v_normalized, p_call_id, 'optout_detection', 'Phone blocked globally on opt-out', 'blocked', 'webhook');
END;
$$ LANGUAGE plpgsql;
