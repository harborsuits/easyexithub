export type PipelineStage =
  | 'raw'
  | 'researched'
  | 'contact-ready'
  | 'contacted'
  | 'responding'
  | 'offer-made'
  | 'negotiating'
  | 'under-contract'
  | 'buyer-matched'
  | 'assigned'
  | 'closing'
  | 'closed'
  | 'dead';

export const PIPELINE_STAGES: { id: PipelineStage; label: string; color: string }[] = [
  { id: 'raw', label: 'Raw Lead', color: 'stage-raw' },
  { id: 'researched', label: 'Researched', color: 'stage-researched' },
  { id: 'contact-ready', label: 'Contact Ready', color: 'stage-contact-ready' },
  { id: 'contacted', label: 'Contacted', color: 'stage-contacted' },
  { id: 'responding', label: 'Responding', color: 'stage-responding' },
  { id: 'offer-made', label: 'Offer Made', color: 'stage-offer' },
  { id: 'negotiating', label: 'Negotiating', color: 'stage-negotiating' },
  { id: 'under-contract', label: 'Under Contract', color: 'stage-contract' },
  { id: 'buyer-matched', label: 'Buyer Matched', color: 'stage-matched' },
  { id: 'assigned', label: 'Assigned', color: 'stage-assigned' },
  { id: 'closing', label: 'Closing', color: 'stage-closing' },
  { id: 'closed', label: 'Closed', color: 'stage-closed' },
  { id: 'dead', label: 'Dead', color: 'stage-dead' },
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
