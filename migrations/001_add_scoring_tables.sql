-- Add lead viability scoring table
CREATE TABLE IF NOT EXISTS lead_scoring (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  
  -- Viability score (0-100)
  viability_score INTEGER NOT NULL CHECK (viability_score >= 0 AND viability_score <= 100),
  is_viable BOOLEAN NOT NULL DEFAULT false,
  
  -- Individual indicators
  tax_years_delinquent INTEGER DEFAULT 0,
  probate_open BOOLEAN DEFAULT false,
  recent_death BOOLEAN DEFAULT false,
  foreclosure_active BOOLEAN DEFAULT false,
  lis_pendens BOOLEAN DEFAULT false,
  code_violations_count INTEGER DEFAULT 0,
  bankruptcy BOOLEAN DEFAULT false,
  abandoned_property BOOLEAN DEFAULT false,
  deed_in_lieu BOOLEAN DEFAULT false,
  
  -- Indicator breakdown
  indicators JSONB,  -- Array of triggered indicators
  score_breakdown TEXT,  -- Human readable breakdown
  
  -- Timestamps
  scored_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(lead_id)
);

CREATE INDEX ON lead_scoring(viability_score DESC);
CREATE INDEX ON lead_scoring(is_viable);
CREATE INDEX ON lead_scoring(probate_open);
CREATE INDEX ON lead_scoring(recent_death);
CREATE INDEX ON lead_scoring(scored_at DESC);

-- Add lead sources tracking table
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  
  -- Source information
  source_town VARCHAR NOT NULL,  -- brunswick, bath, portland, etc
  source_scraper VARCHAR NOT NULL,  -- gis, tax_assessment, etc
  
  -- Data source details
  gis_data JSONB,  -- Raw GIS feature data
  tax_data JSONB,  -- Raw tax assessment data
  probate_data JSONB,  -- Probate case details
  obituary_data JSONB,  -- Obituary details
  violation_data JSONB,  -- Code violation details
  
  -- Timestamps
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL,
  enriched_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(lead_id, source_town, scraped_at)
);

CREATE INDEX ON lead_sources(source_town);
CREATE INDEX ON lead_sources(source_scraper);
CREATE INDEX ON lead_sources(scraped_at DESC);

-- Add archived leads table (for low-score leads after 2 months)
CREATE TABLE IF NOT EXISTS leads_archived (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_lead_id UUID NOT NULL,  -- Reference to original lead
  
  -- Copy of lead data
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  zip TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  assessed_value DECIMAL,
  
  -- Scoring info
  viability_score INTEGER,
  reason_archived TEXT,  -- "low_score", "duplicate", "sold", etc
  
  -- Timestamps
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE,
);

CREATE INDEX ON leads_archived(original_lead_id);
CREATE INDEX ON leads_archived(archived_at DESC);

-- Add scrape job tracking
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Job details
  town VARCHAR NOT NULL,
  job_type VARCHAR NOT NULL,  -- "full_scrape", "enrichment", etc
  status VARCHAR NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  
  -- Results
  properties_found INTEGER DEFAULT 0,
  properties_viable INTEGER DEFAULT 0,
  properties_archived INTEGER DEFAULT 0,
  
  -- Error handling
  error_message TEXT,
  
  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
);

CREATE INDEX ON scrape_jobs(town);
CREATE INDEX ON scrape_jobs(status);
CREATE INDEX ON scrape_jobs(created_at DESC);

-- Update leads table to track source
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_town VARCHAR;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_scraper VARCHAR;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS viability_score INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_viable BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_source_town ON leads(source_town);
CREATE INDEX IF NOT EXISTS idx_leads_is_viable ON leads(is_viable);
CREATE INDEX IF NOT EXISTS idx_leads_viability_score ON leads(viability_score DESC);
