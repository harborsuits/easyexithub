// Real database schema for leads
export interface Lead {
  id: number;
  owner_name: string;
  owner_phone?: string;
  owner_email?: string;
  owner_address?: string;
  lead_source?: string;
  motivation_type?: string;
  motivation_notes?: string;
  urgency_level?: number;
  estimated_arv?: number;
  estimated_equity?: number;
  last_contact_date?: string;
  next_followup_date?: string;
  status?: string;
  market_id: number;
  deal_stage_id: number;
  created_at: string;
  updated_at: string;
  
  // Related data (joined)
  market?: { id: number; name: string };
  deal_stage?: { id: number; name: string };
  property?: Property;
  assigned_buyer?: Buyer;
}

export interface Property {
  id: number;
  lead_id: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  property_type?: string;
  bedrooms?: number;
  bathrooms?: number;
  square_feet?: number;
  year_built?: number;
  photo_url?: string;
  notes?: string;
  after_repair_value?: number;
  repair_estimate?: number;
  asking_price?: number;
  contract_price?: number;
  created_at: string;
  updated_at: string;
}

export interface Buyer {
  id: number;
  company_name: string;
  target_markets?: string;
  notes?: string;
  contact_phone?: string;
  contact_email?: string;
  reliability_score?: number;
}

export interface Market {
  id: number;
  name: string;
}

export interface DealStage {
  id: number;
  name: string;
  order?: number;
}

export interface Deal {
  id: number;
  lead_id: number;
  assigned_buyer_id?: number;
  assignment_date?: string;
  contract_price?: number;
  closing_date?: string;
  status?: string;
  created_at: string;
  updated_at: string;
  
  // Related
  lead?: Lead;
  assigned_buyer?: Buyer;
  property?: Property;
}
