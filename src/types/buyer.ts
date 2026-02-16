export interface Buyer {
  id: number;
  company_name: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  target_markets?: string;
  min_price?: number;
  max_price?: number;
  condition_tolerance?: string;
  investment_strategy?: string;
  property_type_preference?: string;
  is_active?: boolean;
  reliability_score?: number;
  notes?: string;
  address?: string;
  average_close_days?: number;
  created_at?: string;
  updated_at?: string;
}

export type BuyerTier = 'all' | 'tier1' | 'tier2' | 'tier3';
export type MarketFilter = 'all' | 'birmingham' | 'kc' | 'multi';
