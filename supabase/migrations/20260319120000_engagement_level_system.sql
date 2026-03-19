-- Migration: Engagement Level System
-- Date: 2026-03-19
-- Purpose: Replace boolean engaged flag with enum-based engagement classification
--          Add cold_attempts counter for 3-attempt rule enforcement

-- Create engagement level enum
CREATE TYPE engagement_level_enum AS ENUM (
  'cold',    -- voicemail/no_answer/busy/disconnected (3-attempt rule applies)
  'warm',    -- maybe_later/thinking_about_selling (unlimited, lower priority)
  'hot',     -- callback_requested/executor/interested/price_discussion (unlimited, high priority)
  'dead',    -- wrong_number/not_interested/hung_up (blocked)
  'dnc'      -- explicit do-not-call/legal request (blocked + compliance)
);

-- Create death reason enum for terminal outcomes
CREATE TYPE death_reason_enum AS ENUM (
  'no_response',        -- 3 cold attempts, never answered
  'wrong_number',       -- incorrect phone number
  'not_interested',     -- explicit rejection
  'sold_elsewhere',     -- sold to realtor/other investor
  'family_transfer',    -- family member took property
  'attorney_handling',  -- attorney blocking contact
  'dnc_request',        -- explicit do-not-call request
  'property_transferred', -- deed already transferred
  'kept_property'       -- decided not to sell
);

-- Add new columns to leads table
ALTER TABLE leads
  ADD COLUMN engagement_level engagement_level_enum DEFAULT 'cold',
  ADD COLUMN cold_attempts INTEGER DEFAULT 0,
  ADD COLUMN death_reason death_reason_enum;

-- Create indexes for dispatcher queries and analytics
CREATE INDEX idx_leads_engagement_callable 
  ON leads(engagement_level, callable, cold_attempts) 
  WHERE callable = true;

CREATE INDEX idx_leads_engagement_level 
  ON leads(engagement_level);

CREATE INDEX idx_leads_cold_attempts 
  ON leads(cold_attempts);

CREATE INDEX idx_leads_death_reason 
  ON leads(death_reason) 
  WHERE death_reason IS NOT NULL;

-- Migrate existing data
-- Leads with status=dead → engagement_level=dead
UPDATE leads 
  SET engagement_level = 'dead' 
  WHERE status = 'dead';

-- Leads with status=dnc → engagement_level=dnc
UPDATE leads 
  SET engagement_level = 'dnc' 
  WHERE status = 'dnc';

-- Leads with positive outcomes → hot
UPDATE leads 
  SET engagement_level = 'hot'
  WHERE status IN ('callback_requested', 'executor', 'interested', 'price_discussion', 'timeline_discussion', 'wants_offer');

-- Leads with maybe outcomes → warm
UPDATE leads 
  SET engagement_level = 'warm'
  WHERE status IN ('maybe_later', 'call_me_next_month', 'not_ready_yet', 'thinking_about_selling');

-- Count existing cold attempts (voicemail/no_answer/busy)
-- This is a one-time backfill based on communications history
UPDATE leads l
  SET cold_attempts = (
    SELECT COUNT(*)
    FROM communications c
    WHERE c.lead_id = l.id
      AND c.outcome IN ('voicemail', 'no_answer', 'busy', 'disconnected')
  )
  WHERE engagement_level = 'cold';

-- Apply 3-attempt rule to existing cold leads
UPDATE leads
  SET status = 'dead',
      callable = false,
      death_reason = 'no_response'
  WHERE engagement_level = 'cold'
    AND cold_attempts >= 3;

-- Add comments documenting the system
COMMENT ON COLUMN leads.engagement_level IS 'Engagement classification: cold (3-attempt rule), warm (unlimited/low-priority), hot (unlimited/high-priority), dead (blocked), dnc (compliance-blocked)';
COMMENT ON COLUMN leads.cold_attempts IS 'Counter for voicemail/no_answer/busy/disconnected outcomes. Only enforced when engagement_level=cold. Resets if lead becomes warm/hot.';
COMMENT ON COLUMN leads.death_reason IS 'Terminal outcome reason. Set when lead moves to dead/dnc. Used for analytics and pipeline insights.';
