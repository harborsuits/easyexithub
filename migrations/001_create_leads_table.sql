-- Phase 5: Create Leads Table for EasyExit Lead-to-Buyer Matching
-- Execute this in Supabase SQL Editor: https://app.supabase.com/project/bgznglzzknmetzpwkbbz/sql/new

CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  
  -- Property Information
  property_address TEXT NOT NULL,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  market TEXT CHECK (market IN ('Birmingham, AL', 'Kansas City, MO', 'Multi-Market')),
  
  -- Property Financials
  asking_price DECIMAL(12,2),
  estimated_arv DECIMAL(12,2),
  repair_estimate DECIMAL(12,2),
  estimated_profit DECIMAL(12,2),
  days_on_market INTEGER,
  
  -- Property Details
  property_type TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  square_feet INTEGER,
  year_built INTEGER,
  condition_notes TEXT,
  photo_url TEXT,
  
  -- Lead Source & Contact
  lead_source TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  
  -- Lead Status
  lead_status TEXT DEFAULT 'new' CHECK (lead_status IN ('new', 'contacted', 'negotiating', 'under_contract', 'closed', 'passed')),
  
  -- Buyer Assignment & Deal Tracking
  assigned_buyer_id BIGINT REFERENCES buyers(id) ON DELETE SET NULL,
  assignment_date TIMESTAMP,
  deal_status TEXT DEFAULT 'unassigned' CHECK (deal_status IN ('unassigned', 'assigned', 'negotiating', 'contract_sent', 'contract_signed', 'closing', 'closed', 'dead')),
  contract_price DECIMAL(12,2),
  closing_date DATE,
  
  -- Notes & Tracking
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by TEXT DEFAULT 'system',
  updated_by TEXT DEFAULT 'system'
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_leads_market ON leads(market);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_buyer ON leads(assigned_buyer_id);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_deal_status ON leads(deal_status);

-- Create view for matching (unassigned leads paired with potential buyers)
DROP VIEW IF EXISTS available_matches CASCADE;

CREATE VIEW available_matches AS
SELECT 
  l.id as lead_id,
  l.property_address,
  l.property_city,
  l.market,
  l.estimated_arv,
  l.repair_estimate,
  l.estimated_profit,
  b.id as buyer_id,
  b.company_name as buyer_name,
  b.target_markets,
  b.notes as buyer_tier,
  CASE 
    WHEN b.notes LIKE '%Tier 1%' THEN 1
    WHEN b.notes LIKE '%Tier 2%' THEN 2
    WHEN b.notes LIKE '%Tier 3%' THEN 3
    ELSE 4
  END as tier_order
FROM leads l
CROSS JOIN buyers b
WHERE 
  l.lead_status = 'new' 
  AND l.assigned_buyer_id IS NULL
  AND l.deal_status = 'unassigned'
  AND (
    b.target_markets LIKE CONCAT('%', SPLIT_PART(l.market, ',', 1), '%')
    OR b.target_markets LIKE '%Multi-Market%'
  )
ORDER BY l.created_at DESC, tier_order ASC;

-- Enable RLS if needed
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (can restrict later)
CREATE POLICY "Allow public access" ON leads FOR ALL USING (true) WITH CHECK (true);

SELECT 'Leads table created successfully' as status;
