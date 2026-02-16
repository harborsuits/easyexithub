import { Lead, PipelineStage } from '@/types';
import { supabase } from './client';

// Create deal when lead is assigned to buyer
export async function createDeal(
  leadId: number,
  buyerId: number,
  ownerName: string,
  marketName: string,
  estimatedArv: number = 0
) {
  try {
    const { data, error } = await supabase
      .from('deals')
      .insert({
        lead_id: leadId,
        buyer_id: buyerId,
        property_address: ownerName,
        market: marketName,
        list_price: estimatedArv,
        offer_price: Math.floor(estimatedArv * 0.7), // Default 70% ARV
        status: 'assigned',
        assigned_date: new Date().toISOString(),
      })
      .select();

    if (error) {
      console.error('Error creating deal:', error);
      throw error;
    }

    return data?.[0] || null;
  } catch (error) {
    console.error('createDeal error:', error);
    throw error;
  }
}

// Map Supabase lead schema to frontend Lead interface
export function mapSupabaseLead(dbLead: any): Lead {
  // Map deal_stage_id to PipelineStage
  const stageMap: Record<number, PipelineStage> = {
    1: 'raw',
    2: 'raw', // raw_lead -> raw
    3: 'researched',
    4: 'contact-ready',
    5: 'contacted',
    6: 'responding',
    7: 'offer-made',
    8: 'negotiating',
    9: 'under-contract',
    10: 'buyer-matched',
    11: 'assigned',
    12: 'closing',
    13: 'closed',
    14: 'dead',
  };

  return {
    id: String(dbLead.id),
    stage: stageMap[dbLead.deal_stage_id] || 'raw',
    createdAt: dbLead.created_at,
    updatedAt: dbLead.updated_at,
    
    // Property Info
    address: dbLead.address || '',
    city: dbLead.city || '',
    state: dbLead.state || '',
    zip: dbLead.zip || '',
    beds: dbLead.beds || 0,
    baths: dbLead.baths || 0,
    sqft: dbLead.sqft || 0,
    yearBuilt: dbLead.year_built,
    assessedValue: dbLead.assessed_value,
    
    // Owner Info
    ownerName: dbLead.owner_name || '',
    ownerPhone: dbLead.owner_phone,
    ownerEmail: dbLead.owner_email,
    ownerAddress: dbLead.owner_address,
    
    // Analysis
    comps: [],
    arv: dbLead.estimated_arv || 0,
    repairItems: [],
    totalRepairs: 0,
    assignmentFee: 0,
    mao: 0,
    
    // Offer
    offerAmount: undefined,
    
    // Contact History
    contacts: [],
    
    // Notes
    notes: dbLead.notes,
  };
}
