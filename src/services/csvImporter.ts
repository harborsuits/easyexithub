/**
 * CSV Importer Service
 * Reads processed BatchLeads CSVs from the workspace and imports them into the app
 */

const WORKSPACE_PATH = '/Users/bendickinson/.openclaw/workspace-easyexit/scrapers/data/exports';

export interface ProcessedLead {
  address: string;
  city: string;
  state: string;
  zip: string;
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  property_type: string;
  assessed_value: number;
  market_value: number;
  property_status: string;
  tax_delinquent: boolean;
  violations: boolean;
  probate: boolean;
  lis_pendens: boolean;
  distress_score: number;
  motivation: 'VERY HIGH' | 'HIGH' | 'MODERATE' | 'LOW';
  priority: 1 | 2 | 3 | 4;
  source: string;
  deal_stage: string;
  processed_at: string;
  csv_file?: string;
}

/**
 * Fetch all processed leads from the API endpoint
 */
export async function fetchProcessedLeads(): Promise<ProcessedLead[]> {
  try {
    const response = await fetch('http://localhost:5001/api/leads');
    if (!response.ok) {
      throw new Error('Failed to fetch leads from API');
    }
    const data = await response.json();
    return data.leads || [];
  } catch (error) {
    console.error('Error fetching processed leads:', error);
    return [];
  }
}

/**
 * Get statistics about processed leads
 */
export async function fetchLeadStats() {
  try {
    const response = await fetch('http://localhost:5001/api/stats');
    if (!response.ok) {
      throw new Error('Failed to fetch stats from API');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching lead stats:', error);
    return null;
  }
}

/**
 * Convert processed lead to app lead format
 */
export function convertToAppLead(processed: ProcessedLead) {
  return {
    owner_name: processed.owner_name,
    owner_email: processed.owner_email,
    owner_phone: isRealPhone(processed.owner_phone) ? processed.owner_phone : null,
    property_address: processed.address,
    property_city: processed.city,
    property_state: processed.state,
    property_zip: processed.zip,
    property_type: processed.property_type,
    assessed_value: processed.assessed_value,
    market_value: processed.market_value,
    estimated_arv: processed.market_value || processed.assessed_value,
    distress_score: processed.distress_score,
    motivation_level: processed.motivation,
    priority: processed.priority,
    tax_delinquent: processed.tax_delinquent,
    violations: processed.violations,
    probate: processed.probate,
    lis_pendens: processed.lis_pendens,
    lead_source: processed.source,
    deal_stage: processed.deal_stage,
    status: 'new',
    created_at: processed.processed_at,
  };
}

/**
 * Check if phone number is real (not test data)
 */
function isRealPhone(phone: string): boolean {
  if (!phone || phone.trim() === '') return false;
  // Filter out 555 numbers (test data)
  if (phone.includes('555')) return false;
  return true;
}
