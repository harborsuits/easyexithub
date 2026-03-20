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

// Valid pipeline stages from DB
const VALID_PIPELINE_STAGES = new Set([
  'new', 'attempting_contact', 'follow_up_scheduled', 'callback_pending',
  'needs_human_followup', 'offer_prep', 'negotiating', 'under_contract',
  'closed_lost', 'closed_won',
]);

// Map Supabase lead schema to frontend Lead interface
export function mapSupabaseLead(dbLead: any): Lead {
  // Read pipeline_stage directly from DB (new canonical source)
  // Fall back to deal_stage_id mapping only for legacy rows
  let stage: PipelineStage = 'new';
  
  if (dbLead.pipeline_stage && VALID_PIPELINE_STAGES.has(dbLead.pipeline_stage)) {
    stage = dbLead.pipeline_stage as PipelineStage;
  }

  // Extract property data from jsonb
  const pd = dbLead.property_data || {};

  return {
    id: String(dbLead.id),
    stage,
    createdAt: dbLead.created_at,
    updatedAt: dbLead.updated_at,
    
    // Property Info (from property_data jsonb)
    address: pd.property_address || pd.address || '',
    city: pd.property_city || pd.city || '',
    state: pd.property_state || 'ME',
    zip: pd.property_zip || '',
    beds: pd.beds || 0,
    baths: pd.baths || 0,
    sqft: pd.sqft || 0,
    yearBuilt: pd.year_built,
    assessedValue: pd.assessed_value,
    
    // Owner Info
    ownerName: dbLead.owner_name || '',
    ownerPhone: dbLead.owner_phone,
    ownerEmail: dbLead.owner_email,
    ownerAddress: dbLead.owner_address,
    
    // Pipeline/Business State
    status: dbLead.status,
    engagementLevel: dbLead.engagement_level,
    lastDisposition: dbLead.last_disposition,
    nextActionType: dbLead.next_action_type,
    nextActionAt: dbLead.next_action_at,
    handoffStatus: dbLead.handoff_status,
    slaDueAt: dbLead.sla_due_at,
    assignedTo: dbLead.assigned_to,
    
    // Analysis
    comps: [],
    arv: dbLead.estimated_arv || 0,
    repairItems: [],
    totalRepairs: 0,
    assignmentFee: dbLead.assignment_fee || 0,
    mao: 0,
    
    // Offer
    offerAmount: undefined,
    
    // Contact History
    contacts: [],
    
    // Notes
    notes: dbLead.motivation_notes,
  };
}
