import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { buyerMatcher } from '@/utils/buyerMatcher';

/**
 * Context for managing leads with proper FK relationships
 * Schema:
 * - leads.market_id → markets.id
 * - leads.deal_stage_id → deal_stages.id
 * - buyers.target_markets → TEXT (space/comma separated market names)
 */

export interface Market {
  id: number;
  name: string;
  state?: string;
  region?: string;
}

export interface DealStage {
  id: number;
  name: string;
  order_index?: number;
}

export interface Buyer {
  id: number;
  company_name: string;
  target_markets?: string;
  notes?: string;
  contact_phone?: string;
  contact_email?: string;
  reliability_score?: number;
  is_active?: boolean;
}

export interface Lead {
  id: number;
  owner_name: string;
  owner_phone?: string;
  owner_email?: string;
  lead_source?: string;
  estimated_arv?: number;
  estimated_equity?: number;
  market_id: number;
  deal_stage_id: number;
  created_at: string;
  updated_at?: string;
  status?: string;
  
  // Loaded relations
  market?: Market;
  deal_stage?: DealStage;
}

interface LeadsContextType {
  leads: Lead[];
  markets: Market[];
  dealStages: DealStage[];
  buyers: Buyer[];
  loading: boolean;
  error?: string;
  
  // Methods
  fetchLeads(): Promise<Lead[]>;
  fetchMarkets(): Promise<Market[]>;
  fetchDealStages(): Promise<DealStage[]>;
  fetchBuyers(): Promise<Buyer[]>;
  getRecommendedBuyersForLead(lead: Lead, limit?: number): any[];
  getMatchStatsForLead(lead: Lead): any;
  assignLeadToBuyer(leadId: number, buyerId: number): Promise<void>;
}

const LeadsContext = createContext<LeadsContextType | undefined>(undefined);

export const useLeads = () => {
  const context = useContext(LeadsContext);
  if (!context) {
    throw new Error('useLeads must be used within LeadsProvider');
  }
  return context;
};

export const LeadsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [dealStages, setDealStages] = useState<DealStage[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // Fetch markets
  const fetchMarkets = async () => {
    try {
      const { data, error: err } = await supabase
        .from('markets')
        .select('id, name, state, region');
      
      if (err) throw err;
      setMarkets(data || []);
      console.log('Fetched markets:', data);
      return data || [];
    } catch (err) {
      console.error('Error fetching markets:', err);
      setError(String(err));
      return [];
    }
  };

  // Fetch deal stages
  const fetchDealStages = async () => {
    try {
      const { data, error: err } = await supabase
        .from('deal_stages')
        .select('id, name, order_index');
      
      if (err) throw err;
      setDealStages(data || []);
      console.log('Fetched deal stages:', data);
      return data || [];
    } catch (err) {
      console.error('Error fetching deal stages:', err);
      setError(String(err));
      return [];
    }
  };

  // Fetch buyers
  const fetchBuyers = async () => {
    try {
      const { data, error: err } = await supabase
        .from('buyers')
        .select('id, company_name, target_markets, notes, contact_phone, contact_email, reliability_score, is_active')
        .eq('is_active', true);
      
      if (err) throw err;
      setBuyers(data || []);
      console.log('Fetched buyers:', data?.length, 'active');
      return data || [];
    } catch (err) {
      console.error('Error fetching buyers:', err);
      setError(String(err));
      return [];
    }
  };

  // Fetch leads with related data
  const fetchLeads = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('leads')
        .select(`
          id,
          owner_name,
          owner_phone,
          owner_email,
          lead_source,
          estimated_arv,
          estimated_equity,
          market_id,
          deal_stage_id,
          created_at,
          updated_at,
          status
        `);
      
      if (err) throw err;
      
      // Enrich leads with market and deal_stage data
      const enrichedLeads = (data || []).map((lead) => ({
        ...lead,
        market: markets.find((m) => m.id === lead.market_id),
        deal_stage: dealStages.find((ds) => ds.id === lead.deal_stage_id),
      }));
      
      setLeads(enrichedLeads);
      console.log('Fetched leads:', enrichedLeads);
      return enrichedLeads;
    } catch (err) {
      console.error('Error fetching leads:', err);
      setError(String(err));
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Get recommended buyers for a lead
  const getRecommendedBuyersForLead = (lead: Lead, limit: number = 5) => {
    const marketName = lead.market?.name;
    return buyerMatcher.getTopMatches(lead, buyers, marketName, limit);
  };

  // Get match statistics
  const getMatchStatsForLead = (lead: Lead) => {
    const marketName = lead.market?.name;
    return buyerMatcher.getMatchStats(lead, buyers, marketName);
  };

  // Assign lead to buyer
  const assignLeadToBuyer = async (leadId: number, buyerId: number) => {
    try {
      const { error: err } = await supabase
        .from('leads')
        .update({ status: 'assigned' })
        .eq('id', leadId);
      
      if (err) throw err;
      
      // Refresh leads
      await fetchLeads();
      console.log(`Lead ${leadId} assigned to buyer ${buyerId}`);
    } catch (err) {
      console.error('Error assigning lead:', err);
      throw err;
    }
  };

  // Initialize: fetch all data
  useEffect(() => {
    const initializeContext = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchMarkets(), fetchDealStages(), fetchBuyers()]);
      } finally {
        setLoading(false);
      }
    };

    initializeContext();
  }, []);

  // Fetch leads when markets/stages are ready
  useEffect(() => {
    if (markets.length > 0 && dealStages.length > 0) {
      fetchLeads();
    }
  }, [markets, dealStages]);

  const value: LeadsContextType = {
    leads,
    markets,
    dealStages,
    buyers,
    loading,
    error,
    fetchLeads,
    fetchMarkets,
    fetchDealStages,
    fetchBuyers,
    getRecommendedBuyersForLead,
    getMatchStatsForLead,
    assignLeadToBuyer,
  };

  return (
    <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>
  );
};
