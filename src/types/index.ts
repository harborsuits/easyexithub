// Pipeline stage = business progress (from DB pipeline_stage column)
// This is SEPARATE from status (eligibility/terminal state)
export type PipelineStage =
  | 'new'
  | 'attempting_contact'
  | 'follow_up_scheduled'
  | 'callback_pending'
  | 'needs_human_followup'
  | 'offer_prep'
  | 'negotiating'
  | 'under_contract'
  | 'closed_lost'
  | 'closed_won';

export const PIPELINE_STAGES: { id: PipelineStage; label: string; color: string }[] = [
  { id: 'new', label: 'New', color: 'stage-raw' },
  { id: 'attempting_contact', label: 'Attempting Contact', color: 'stage-contacted' },
  { id: 'follow_up_scheduled', label: 'Follow-Up Scheduled', color: 'stage-researched' },
  { id: 'callback_pending', label: 'Callback Pending', color: 'stage-responding' },
  { id: 'needs_human_followup', label: '🔥 Needs Follow-Up', color: 'stage-offer' },
  { id: 'offer_prep', label: 'Offer Prep', color: 'stage-negotiating' },
  { id: 'negotiating', label: 'Negotiating', color: 'stage-negotiating' },
  { id: 'under_contract', label: 'Under Contract', color: 'stage-contract' },
  { id: 'closed_won', label: 'Closed Won', color: 'stage-closed' },
  { id: 'closed_lost', label: 'Closed / Lost', color: 'stage-dead' },
];

export interface Comp {
  id: string;
  address: string;
  salePrice: number;
  saleDate: string;
}

export interface RepairItem {
  id: string;
  category: string;
  description: string;
  cost: number;
}

export interface ContactEntry {
  id: string;
  date: string;
  channel: 'call' | 'text' | 'email' | 'mail' | 'door-knock' | 'other';
  summary: string;
  response: string;
  followUpDate?: string;
}

export interface Lead {
  id: string;
  stage: PipelineStage;
  createdAt: string;
  updatedAt: string;
  
  // Property Info
  address: string;
  city: string;
  state: string;
  zip: string;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt?: number;
  assessedValue?: number;
  
  // Owner Info
  ownerName: string;
  ownerPhone?: string;
  ownerEmail?: string;
  ownerAddress?: string;
  
  // Pipeline/Business State
  status?: string;
  engagementLevel?: string;
  lastDisposition?: string;
  nextActionType?: string;
  nextActionAt?: string;
  handoffStatus?: string;
  slaDueAt?: string;
  assignedTo?: string;
  
  // Analysis
  comps: Comp[];
  arv: number;
  repairItems: RepairItem[];
  totalRepairs: number;
  assignmentFee: number;
  mao: number;
  
  // Offer
  offerAmount?: number;
  
  // Contact History
  contacts: ContactEntry[];
  
  // Notes
  notes?: string;
}

export type PropertyPreference = 'single-family' | 'multi-family' | 'townhouse' | 'condo' | 'land' | 'commercial';
export type ConditionPreference = 'turnkey' | 'light-rehab' | 'heavy-rehab' | 'tear-down';

export interface Buyer {
  id: string;
  name: string;
  company?: string;
  phone: string;
  email: string;
  markets: string[];
  propertyTypes: PropertyPreference[];
  priceMin: number;
  priceMax: number;
  conditions: ConditionPreference[];
  reliabilityScore: number; // 1-5
  notes?: string;
  createdAt: string;
  lastDealDate?: string;
  totalDeals: number;
}

export interface DashboardMetrics {
  pipelineSummary: { stage: PipelineStage; count: number }[];
  contactsToday: number;
  contactsThisWeek: number;
  responsesThisWeek: number;
  offersThisMonth: number;
  avgArv: number;
  avgAssignmentFee: number;
  conversionRate: number;
  closedThisMonth: number;
  totalPipelineValue: number;
}
