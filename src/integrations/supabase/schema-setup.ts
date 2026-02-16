/**
 * Supabase Schema Setup
 * 
 * This file contains SQL migrations and helper functions to ensure
 * the database schema is properly initialized.
 * 
 * Migration 001: Create leads table for EasyExit lead-to-buyer matching
 */

export const leadsTableSQL = `
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  
  -- Property Information
  property_address TEXT NOT NULL,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  market TEXT,
  
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
  lead_status TEXT DEFAULT 'new',
  
  -- Buyer Assignment & Deal Tracking
  assigned_buyer_id BIGINT,
  assignment_date TIMESTAMP,
  deal_status TEXT DEFAULT 'unassigned',
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
`;

/**
 * Get the schema setup SQL with comments
 */
export function getLeadsTableDefinition() {
  return `
-- EasyExit Leads Table Schema
-- For tracking properties and matching them to buyers

-- Column Definitions:
-- id: Unique lead identifier
-- property_address: Full street address of the property
-- market: Target market (Birmingham, AL | Kansas City, MO | Multi-Market)
-- asking_price: List price of the property
-- estimated_arv: After-repair value (estimated selling price)
-- repair_estimate: Total estimated repair costs
-- estimated_profit: Projected profit (ARV - asking_price - repairs - closing)
-- lead_status: Stages (new, contacted, negotiating, under_contract, closed, passed)
-- assigned_buyer_id: Foreign key to buyers table
-- deal_status: Deal stages (unassigned, assigned, negotiating, contract_sent, contract_signed, closing, closed, dead)
-- contract_price: Agreed purchase price if under contract
-- closing_date: Anticipated closing date
`;
}

/**
 * Helper function to check if leads table exists
 * (Can be called from the app to initialize schema if needed)
 */
export async function ensureLeadsTableExists(supabaseClient: any) {
  try {
    // Try to query the leads table
    const { data, error } = await supabaseClient
      .from('leads')
      .select('COUNT(*)')
      .limit(1);
    
    if (error && error.code === 'PGRST204') {
      console.log('ℹ️  Leads table does not exist. Please create it via Supabase SQL Editor.');
      console.log('Navigate to: https://app.supabase.com/project/bgznglzzknmetzpwkbbz/sql/new');
      console.log('And paste the SQL from migrations/001_create_leads_table.sql');
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('Error checking leads table:', err);
    return false;
  }
}

/**
 * Type definitions for Leads
 */
export interface Lead {
  id?: number;
  property_address: string;
  property_city?: string;
  property_state?: string;
  property_zip?: string;
  market: 'Birmingham, AL' | 'Kansas City, MO' | 'Multi-Market';
  asking_price?: number;
  estimated_arv?: number;
  repair_estimate?: number;
  estimated_profit?: number;
  days_on_market?: number;
  property_type?: string;
  bedrooms?: number;
  bathrooms?: number;
  square_feet?: number;
  year_built?: number;
  condition_notes?: string;
  photo_url?: string;
  lead_source?: string;
  owner_name?: string;
  owner_phone?: string;
  owner_email?: string;
  lead_status?: 'new' | 'contacted' | 'negotiating' | 'under_contract' | 'closed' | 'passed';
  assigned_buyer_id?: number;
  assignment_date?: string;
  deal_status?: 'unassigned' | 'assigned' | 'negotiating' | 'contract_sent' | 'contract_signed' | 'closing' | 'closed' | 'dead';
  contract_price?: number;
  closing_date?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

/**
 * Lead Matching View (shows potential matches)
 */
export const leadsMatchingViewSQL = `
CREATE OR REPLACE VIEW available_matches AS
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
    WHEN b.notes ILIKE '%Tier 1%' THEN 1
    WHEN b.notes ILIKE '%Tier 2%' THEN 2
    WHEN b.notes ILIKE '%Tier 3%' THEN 3
    ELSE 4
  END as tier_order
FROM leads l
CROSS JOIN buyers b
WHERE 
  l.lead_status = 'new' 
  AND l.assigned_buyer_id IS NULL
  AND l.deal_status = 'unassigned'
  AND (
    b.target_markets ILIKE CONCAT('%', SPLIT_PART(l.market, ',', 1), '%')
    OR b.target_markets ILIKE '%Multi%'
  )
ORDER BY l.created_at DESC, tier_order ASC;
`;
