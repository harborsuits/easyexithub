import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Lead, Buyer, PipelineStage, ContactEntry, Comp, RepairItem } from '@/types';
import { mockLeads, mockBuyers, calculateMAO } from '@/data/mockData';
import { supabase } from '@/integrations/supabase/client';
import { mapSupabaseLead } from '@/integrations/supabase/mappers';

interface CRMContextType {
  leads: Lead[];
  buyers: Buyer[];
  selectedLead: Lead | null;
  setSelectedLead: (lead: Lead | null) => void;
  updateLeadStage: (leadId: string, newStage: PipelineStage) => void;
  updateLead: (leadId: string, updates: Partial<Lead>) => void;
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => void;
  deleteLead: (leadId: string) => void;
  addContact: (leadId: string, contact: Omit<ContactEntry, 'id'>) => void;
  addComp: (leadId: string, comp: Omit<Comp, 'id'>) => void;
  removeComp: (leadId: string, compId: string) => void;
  addRepairItem: (leadId: string, item: Omit<RepairItem, 'id'>) => void;
  removeRepairItem: (leadId: string, itemId: string) => void;
  updateRepairItem: (leadId: string, itemId: string, updates: Partial<RepairItem>) => void;
  addBuyer: (buyer: Omit<Buyer, 'id' | 'createdAt' | 'totalDeals'>) => void;
  updateBuyer: (buyerId: string, updates: Partial<Buyer>) => void;
  deleteBuyer: (buyerId: string) => void;
  loading: boolean;
}

const CRMContext = createContext<CRMContextType | undefined>(undefined);

export function CRMProvider({ children }: { children: React.ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>(mockLeads);
  const [buyers, setBuyers] = useState<Buyer[]>(mockBuyers);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch leads from Supabase on mount
  useEffect(() => {
    const fetchLeads = async () => {
      try {
        console.log('Fetching leads from Supabase...');
        const { data, error } = await supabase
          .from('leads')
          .select('*');
        
        if (error) {
          console.error('Supabase error:', error);
          setLeads(mockLeads);
        } else {
          console.log('Fetched leads:', data);
          if (data && data.length > 0) {
            const mappedLeads = data.map(mapSupabaseLead);
            console.log('Mapped leads:', mappedLeads);
            setLeads(mappedLeads);
          } else {
            console.log('No leads in Supabase, using mock data');
            setLeads(mockLeads);
          }
        }
      } catch (err) {
        console.error('Error fetching leads:', err);
        setLeads(mockLeads);
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, []);

  const updateLeadStage = useCallback((leadId: string, newStage: PipelineStage) => {
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, stage: newStage, updatedAt: new Date().toISOString() }
          : lead
      )
    );
  }, []);

  const updateLead = useCallback((leadId: string, updates: Partial<Lead>) => {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;
        const updated = { ...lead, ...updates, updatedAt: new Date().toISOString() };
        // Recalculate MAO if relevant fields changed
        if ('arv' in updates || 'totalRepairs' in updates || 'assignmentFee' in updates) {
          updated.mao = calculateMAO(updated.arv, updated.totalRepairs, updated.assignmentFee);
        }
        return updated;
      })
    );
    // Also update selected lead if it's the one being modified
    setSelectedLead((prev) => {
      if (prev?.id !== leadId) return prev;
      const updated = { ...prev, ...updates, updatedAt: new Date().toISOString() };
      if ('arv' in updates || 'totalRepairs' in updates || 'assignmentFee' in updates) {
        updated.mao = calculateMAO(updated.arv, updated.totalRepairs, updated.assignmentFee);
      }
      return updated;
    });
  }, []);

  const addLead = useCallback(async (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newLead = {
      ...lead,
      created_at: now,
      updated_at: now,
    };
    
    try {
      const { data, error } = await supabase
        .from('leads')
        .insert([newLead])
        .select();
      
      if (error) {
        console.error('Error adding lead:', error);
      } else if (data && data.length > 0) {
        console.log('Lead added to Supabase:', data[0]);
        setLeads((prev) => [...prev, data[0] as Lead]);
      }
    } catch (err) {
      console.error('Exception adding lead:', err);
    }
  }, []);

  const deleteLead = useCallback((leadId: string) => {
    setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
    setSelectedLead((prev) => (prev?.id === leadId ? null : prev));
  }, []);

  const addContact = useCallback((leadId: string, contact: Omit<ContactEntry, 'id'>) => {
    const newContact: ContactEntry = {
      ...contact,
      id: `contact-${Date.now()}`,
    };
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, contacts: [...lead.contacts, newContact], updatedAt: new Date().toISOString() }
          : lead
      )
    );
  }, []);

  const addComp = useCallback((leadId: string, comp: Omit<Comp, 'id'>) => {
    const newComp: Comp = {
      ...comp,
      id: `comp-${Date.now()}`,
    };
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, comps: [...lead.comps, newComp], updatedAt: new Date().toISOString() }
          : lead
      )
    );
  }, []);

  const removeComp = useCallback((leadId: string, compId: string) => {
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? { ...lead, comps: lead.comps.filter((c) => c.id !== compId), updatedAt: new Date().toISOString() }
          : lead
      )
    );
  }, []);

  const addRepairItem = useCallback((leadId: string, item: Omit<RepairItem, 'id'>) => {
    const newItem: RepairItem = {
      ...item,
      id: `repair-${Date.now()}`,
    };
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;
        const newRepairItems = [...lead.repairItems, newItem];
        const totalRepairs = newRepairItems.reduce((sum, r) => sum + r.cost, 0);
        return {
          ...lead,
          repairItems: newRepairItems,
          totalRepairs,
          mao: calculateMAO(lead.arv, totalRepairs, lead.assignmentFee),
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, []);

  const removeRepairItem = useCallback((leadId: string, itemId: string) => {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;
        const newRepairItems = lead.repairItems.filter((r) => r.id !== itemId);
        const totalRepairs = newRepairItems.reduce((sum, r) => sum + r.cost, 0);
        return {
          ...lead,
          repairItems: newRepairItems,
          totalRepairs,
          mao: calculateMAO(lead.arv, totalRepairs, lead.assignmentFee),
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, []);

  const updateRepairItem = useCallback((leadId: string, itemId: string, updates: Partial<RepairItem>) => {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.id !== leadId) return lead;
        const newRepairItems = lead.repairItems.map((r) =>
          r.id === itemId ? { ...r, ...updates } : r
        );
        const totalRepairs = newRepairItems.reduce((sum, r) => sum + r.cost, 0);
        return {
          ...lead,
          repairItems: newRepairItems,
          totalRepairs,
          mao: calculateMAO(lead.arv, totalRepairs, lead.assignmentFee),
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, []);

  const addBuyer = useCallback((buyer: Omit<Buyer, 'id' | 'createdAt' | 'totalDeals'>) => {
    const newBuyer: Buyer = {
      ...buyer,
      id: `buyer-${Date.now()}`,
      createdAt: new Date().toISOString(),
      totalDeals: 0,
    };
    setBuyers((prev) => [...prev, newBuyer]);
  }, []);

  const updateBuyer = useCallback((buyerId: string, updates: Partial<Buyer>) => {
    setBuyers((prev) =>
      prev.map((buyer) =>
        buyer.id === buyerId ? { ...buyer, ...updates } : buyer
      )
    );
  }, []);

  const deleteBuyer = useCallback((buyerId: string) => {
    setBuyers((prev) => prev.filter((buyer) => buyer.id !== buyerId));
  }, []);

  return (
    <CRMContext.Provider
      value={{
        leads,
        buyers,
        selectedLead,
        setSelectedLead,
        updateLeadStage,
        updateLead,
        addLead,
        deleteLead,
        addContact,
        addComp,
        removeComp,
        addRepairItem,
        removeRepairItem,
        updateRepairItem,
        addBuyer,
        updateBuyer,
        deleteBuyer,
        loading,
      }}
    >
      {children}
    </CRMContext.Provider>
  );
}

export function useCRM() {
  const context = useContext(CRMContext);
  if (!context) {
    throw new Error('useCRM must be used within a CRMProvider');
  }
  return context;
}
