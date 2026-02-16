import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Lead } from '@/integrations/supabase/schema-setup';
import { 
  getRecommendedBuyers, 
  getMatchStats, 
  MatchedBuyer,
  type Buyer
} from '@/utils/buyerMatcher';

interface LeadsContextType {
  leads: Lead[];
  buyers: Buyer[];
  loading: boolean;
  error: string | null;
  addLead: (lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateLead: (id: number, updates: Partial<Lead>) => Promise<void>;
  assignLeadToBuyer: (leadId: number, buyerId: number) => Promise<void>;
  getRecommendedBuyersForLead: (leadId: number, topN?: number) => MatchedBuyer[];
  getMatchStatsForLead: (leadId: number) => any;
  fetchLeads: (filters?: { market?: string; status?: string }) => Promise<void>;
}

const LeadsContext = createContext<LeadsContextType | undefined>(undefined);

export function LeadsProvider({ children }: { children: React.ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch leads from Supabase
  const fetchLeads = async (filters?: { market?: string; status?: string }) => {
    setLoading(true);
    setError(null);
    try {
      console.log('Fetching leads from Supabase...');
      
      let query = supabase.from('leads').select('*');
      
      if (filters?.market) {
        query = query.eq('market', filters.market);
      }
      if (filters?.status) {
        query = query.eq('lead_status', filters.status);
      }
      
      const { data, error: err } = await query.order('created_at', { ascending: false });
      
      if (err) {
        if (err.message.includes('does not exist')) {
          setError('Leads table not yet initialized. Please run the migration in Supabase.');
          console.log('ℹ️  To create the leads table, run the SQL from migrations/001_create_leads_table.sql');
        } else {
          throw err;
        }
      } else {
        console.log(`Fetched ${data?.length || 0} leads`);
        setLeads((data || []) as Lead[]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch leads';
      setError(message);
      console.error('Error fetching leads:', err);
    } finally {
      setLoading(false);
    }
  };

  // Add a new lead
  const addLead = async (lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error: err } = await supabase
        .from('leads')
        .insert([lead])
        .select();
      
      if (err) throw err;
      if (data) {
        setLeads([...leads, ...(data as Lead[])]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add lead';
      setError(message);
      throw err;
    }
  };

  // Update a lead
  const updateLead = async (id: number, updates: Partial<Lead>) => {
    try {
      const { error: err } = await supabase
        .from('leads')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      
      if (err) throw err;
      
      // Update local state
      setLeads(leads.map(l => l.id === id ? { ...l, ...updates } : l));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update lead';
      setError(message);
      throw err;
    }
  };

  // Assign a lead to a buyer
  const assignLeadToBuyer = async (leadId: number, buyerId: number) => {
    try {
      await updateLead(leadId, {
        assigned_buyer_id: buyerId,
        assignment_date: new Date().toISOString(),
        deal_status: 'assigned',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign lead';
      setError(message);
      throw err;
    }
  };

  // Fetch buyers for matching
  const fetchBuyers = async () => {
    try {
      const { data, error: err } = await supabase
        .from('buyers')
        .select('*')
        .order('company_name', { ascending: true });
      
      if (err) {
        console.warn('Failed to fetch buyers:', err.message);
      } else {
        console.log(`Fetched ${data?.length || 0} buyers for matching`);
        setBuyers((data || []) as Buyer[]);
      }
    } catch (err) {
      console.error('Error fetching buyers:', err);
    }
  };

  // Get recommended buyers for a specific lead
  const getRecommendedBuyersForLead = (leadId: number, topN: number = 5) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
      console.warn(`Lead ${leadId} not found`);
      return [];
    }

    if (buyers.length === 0) {
      console.warn('No buyers loaded. Call fetchBuyers() first.');
      return [];
    }

    return getRecommendedBuyers(
      {
        id: lead.id!,
        property_address: lead.property_address,
        market: lead.market,
        estimated_arv: lead.estimated_arv,
        repair_estimate: lead.repair_estimate,
        estimated_profit: lead.estimated_profit,
      },
      buyers,
      topN
    );
  };

  // Get match statistics for a lead
  const getMatchStatsForLead = (leadId: number) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) {
      console.warn(`Lead ${leadId} not found`);
      return null;
    }

    return getMatchStats(
      {
        id: lead.id!,
        property_address: lead.property_address,
        market: lead.market,
      },
      buyers
    );
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchLeads();
    fetchBuyers();
  }, []);

  return (
    <LeadsContext.Provider
      value={{
        leads,
        buyers,
        loading,
        error,
        addLead,
        updateLead,
        assignLeadToBuyer,
        getRecommendedBuyersForLead,
        getMatchStatsForLead,
        fetchLeads,
      }}
    >
      {children}
    </LeadsContext.Provider>
  );
}

export function useLeads() {
  const context = useContext(LeadsContext);
  if (!context) {
    throw new Error('useLeads must be used within a LeadsProvider');
  }
  return context;
}
