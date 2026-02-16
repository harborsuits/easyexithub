import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MapPin, Home, DollarSign, Wrench, TrendingUp, Phone, Mail, User, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { AppLayout } from '@/components/common/AppLayout';
import { createClient } from '@supabase/supabase-js';
import { createDeal } from '@/integrations/supabase/mappers';

const supabaseUrl = 'https://bgznglzzknmetzpwkbbz.supabase.co';
const supabaseKey = 'sb_publishable__EZVLNLFIn0eK-Blnr9vHg_vTGvUESH';
const supabase = createClient(supabaseUrl, supabaseKey);
// import { useLeads } from '@/context/LeadsContext';
// import { useBuyers } from '@/context/BuyersContext';
// import { buyerMatcher } from '@/utils/buyerMatcher';

// Mock lead data
const MOCK_LEADS: Record<number, any> = {
  1: {
    id: 1,
    property_address: '4521 8th Ave S',
    property_city: 'Birmingham',
    property_state: 'AL',
    property_zip: '35205',
    market: 'Birmingham, AL',
    asking_price: 85000,
    estimated_arv: 145000,
    repair_estimate: 35000,
    estimated_profit: 25000,
    days_on_market: 45,
    property_type: 'Single Family',
    bedrooms: 3,
    bathrooms: 2,
    square_feet: 1450,
    year_built: 1968,
    condition_notes: 'Roof needs replacement, foundation good, major kitchen/bath remodel needed',
    photo_url: 'https://via.placeholder.com/600x400?text=4521+8th+Ave+S',
    lead_source: 'Facebook Lead Ad',
    owner_name: 'John Smith',
    owner_phone: '(205) 555-0123',
    owner_email: 'john.smith@email.com',
    lead_status: 'new',
    deal_status: 'unassigned',
    notes: 'Hot lead - owner motivated to sell, considering relocation',
    created_at: '2026-02-10T10:00:00Z',
  },
  2: {
    id: 2,
    property_address: '2847 29th St N',
    property_city: 'Birmingham',
    property_state: 'AL',
    property_zip: '35203',
    market: 'Birmingham, AL',
    asking_price: 92000,
    estimated_arv: 155000,
    repair_estimate: 28000,
    estimated_profit: 35000,
    days_on_market: 30,
    property_type: 'Single Family',
    bedrooms: 4,
    bathrooms: 2.5,
    square_feet: 1850,
    year_built: 1975,
    condition_notes: 'Good bones, cosmetic updates needed, electrical system upgraded 2020',
    photo_url: 'https://via.placeholder.com/600x400?text=2847+29th+St+N',
    lead_source: 'Direct Referral',
    owner_name: 'Maria Garcia',
    owner_phone: '(205) 555-0456',
    owner_email: 'maria.garcia@email.com',
    lead_status: 'contacted',
    deal_status: 'assigned',
    assigned_buyer_id: 3,
    assigned_buyer_name: 'TyZhea Warren',
    assignment_date: '2026-02-09T14:30:00Z',
    notes: 'Second deal with TyZhea, she has cash ready',
    created_at: '2026-02-09T14:30:00Z',
  },
};

// Mock buyers for recommendations
const MOCK_BUYERS = [
  { id: 3, company_name: 'Dee McNeal', target_markets: 'Birmingham, AL', notes: 'Tier 1 HOT', contact_phone: '(205) 555-1001', contact_email: 'dee@deals.com' },
  { id: 4, company_name: 'Wesley Sirivongxay', target_markets: 'Birmingham, AL', notes: 'Tier 1 HOT', contact_phone: '(205) 555-1002', contact_email: 'wesley@deals.com' },
  { id: 5, company_name: 'TyZhea Warren', target_markets: 'Birmingham, AL', notes: 'Tier 1 HOT', contact_phone: '(205) 555-1003', contact_email: 'tyzhea@deals.com' },
  { id: 6, company_name: 'Daniel Johnathan', target_markets: 'Birmingham, AL', notes: 'Tier 2 WARM', contact_phone: '(205) 555-1004', contact_email: 'daniel@deals.com' },
  { id: 7, company_name: 'Derik Bannister', target_markets: 'Birmingham, AL', notes: 'Tier 2 WARM', contact_phone: '(205) 555-1005', contact_email: 'derik@deals.com' },
];

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const leadId = parseInt(id || '1');

  const [lead, setLead] = useState<any>(null);
  const [recommendedBuyers, setRecommendedBuyers] = useState<any[]>([]);
  const [assigningTo, setAssigningTo] = useState<number | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Fetch real lead data from Supabase
  useEffect(() => {
    async function fetchLead() {
      try {
        const { data: leadData, error } = await supabase
          .from('leads')
          .select('*, market_id, deal_stage_id')
          .eq('id', leadId)
          .single();

        if (error) throw error;

        // Fetch market info
        const { data: market } = await supabase
          .from('markets')
          .select('id, name')
          .eq('id', leadData.market_id)
          .single();

        // Transform to mock format for now
        const transformedLead = {
          id: leadData.id,
          owner_name: leadData.owner_name || 'Unknown',
          owner_phone: leadData.owner_phone || 'N/A',
          owner_email: leadData.owner_email || 'N/A',
          lead_source: leadData.lead_source || 'Unknown',
          market: market?.name || 'Unknown Market',
          estimated_arv: leadData.estimated_arv || 0,
          deal_status: leadData.status || 'unassigned',
          market_id: leadData.market_id,
          lead_status: leadData.motivation_type || 'raw_lead',
          property_address: leadData.owner_name || `Lead #${leadData.id}`,
          property_city: market?.name?.split(',')[0] || 'Unknown',
          property_state: market?.name?.split(',')[1]?.trim() || 'N/A',
          condition_notes: leadData.motivation_notes || 'No notes',
          // Fallback values for fields not in Supabase lead record
          property_type: 'Single Family',
          bedrooms: 3,
          bathrooms: 2,
          square_feet: 1500,
          year_built: 1990,
          days_on_market: 30,
          photo_url: 'https://via.placeholder.com/600x400?text=Property',
          estimated_profit: (leadData.estimated_arv || 0) - (leadData.asking_price || 0) - 30000,
          asking_price: 100000,
          repair_estimate: 30000,
          assigned_buyer_id: null,
          assigned_buyer_name: null,
        };

        setLead(transformedLead);
      } catch (err) {
        console.error('Error fetching lead:', err);
        // Fallback to mock if real data fails
        setLead(MOCK_LEADS[leadId] || MOCK_LEADS[1]);
      } finally {
        setLoading(false);
      }
    }

    fetchLead();
  }, [leadId]);

  // Get recommended buyers - filter by market
  useEffect(() => {
    if (!lead) return;

    const matches = MOCK_BUYERS.filter(buyer =>
      buyer.target_markets.includes(lead.market.split(',')[0])
    ).sort((a, b) => {
      const tierA = a.notes.includes('Tier 1') ? 0 : a.notes.includes('Tier 2') ? 1 : 2;
      const tierB = b.notes.includes('Tier 1') ? 0 : b.notes.includes('Tier 2') ? 1 : 2;
      return tierA - tierB;
    }).map(buyer => ({
      ...buyer,
      match_score: buyer.notes.includes('Tier 1') ? 90 : buyer.notes.includes('Tier 2') ? 75 : 60,
    }));
    setRecommendedBuyers(matches.slice(0, 5));
  }, [lead]);

  const handleAssignBuyer = async (buyerId: number, buyerName: string) => {
    setAssigningTo(buyerId);
    
    try {
      // Update database with assignment
      const { error } = await supabase
        .from('leads')
        .update({
          assigned_buyer_id: buyerId,
          deal_stage_id: 2, // "Assigned" stage
          assignment_date: new Date().toISOString(),
        })
        .eq('id', leadId);

      if (error) {
        console.error('Assignment error:', error);
        setAssignmentMessage(`Error: ${error.message}`);
        setAssigningTo(null);
        return;
      }

      // Create deal when assignment succeeds
      try {
        await createDeal(
          parseInt(leadId),
          buyerId,
          lead.ownerName || 'Unnamed Property',
          lead.market || 'Unknown Market',
          lead.arv || 0
        );
      } catch (dealError) {
        console.error('Failed to create deal:', dealError);
        // Still continue - assignment succeeded even if deal creation failed
      }

      // Update local state
      setLead(prev => ({
        ...prev,
        assigned_buyer_id: buyerId,
        assigned_buyer_name: buyerName,
        deal_status: 'assigned',
        assignment_date: new Date().toISOString(),
      }));
      setAssignmentMessage(`✓ Lead assigned to ${buyerName}`);
      setAssigningTo(null);
      
      // Clear message after 3 seconds
      setTimeout(() => setAssignmentMessage(''), 3000);
    } catch (err) {
      console.error('Assignment error:', err);
      setAssignmentMessage('Error saving assignment');
      setAssigningTo(null);
    }
  };

  const getTierColor = (notes: string) => {
    if (notes.includes('Tier 1')) return 'text-red-600 bg-red-50';
    if (notes.includes('Tier 2')) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  const getTierLabel = (notes: string) => {
    if (notes.includes('Tier 1')) return 'Tier 1 - HOT';
    if (notes.includes('Tier 2')) return 'Tier 2 - WARM';
    return 'Tier 3 - ACTIVE';
  };

  if (loading || !lead) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading lead details...</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/leads')}
            className="p-2 hover:bg-white rounded-lg transition"
          >
            <ArrowLeft className="w-6 h-6 text-slate-700" />
          </button>
          <h1 className="text-3xl font-bold text-slate-900">Lead Details</h1>
        </div>

        {/* Assignment Message */}
        {assignmentMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-green-800 font-medium">{assignmentMessage}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Main Content (Left 2/3) */}
          <div className="col-span-2 space-y-6">
            {/* Property Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Home className="w-5 h-5 text-blue-600" />
                Property Information
              </h2>

              {/* Property Image */}
              {lead.photo_url && (
                <img
                  src={lead.photo_url}
                  alt={lead.property_address}
                  className="w-full h-72 object-cover rounded-lg mb-6"
                />
              )}

              {/* Address */}
              <div className="mb-6 pb-6 border-b border-slate-200">
                <p className="text-sm text-slate-600 mb-1">Address</p>
                <p className="text-2xl font-bold text-slate-900">{lead.property_address}</p>
                <p className="text-slate-600">
                  {lead.property_city}, {lead.property_state} {lead.property_zip}
                </p>
              </div>

              {/* Property Details Grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Property Type</p>
                  <p className="font-medium text-slate-900">{lead.property_type}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Year Built</p>
                  <p className="font-medium text-slate-900">{lead.year_built}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Bedrooms / Bathrooms</p>
                  <p className="font-medium text-slate-900">{lead.bedrooms} bed / {lead.bathrooms} bath</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Square Feet</p>
                  <p className="font-medium text-slate-900">{lead.square_feet.toLocaleString()} sqft</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Days on Market</p>
                  <p className="font-medium text-slate-900">{lead.days_on_market} days</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Market</p>
                  <p className="font-medium text-slate-900">{lead.market}</p>
                </div>
              </div>

              {/* Condition Notes */}
              <div>
                <p className="text-sm text-slate-600 mb-2">Condition Notes</p>
                <p className="text-slate-700 bg-slate-50 p-3 rounded text-sm">{lead.condition_notes}</p>
              </div>
            </div>

            {/* Financials Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                Financial Analysis
              </h2>

              <div className="grid grid-cols-2 gap-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-slate-600 mb-1">Asking Price</p>
                  <p className="text-3xl font-bold text-blue-600">${(lead.asking_price / 1000).toFixed(0)}k</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-slate-600 mb-1">Estimated ARV</p>
                  <p className="text-3xl font-bold text-purple-600">${(lead.estimated_arv / 1000).toFixed(0)}k</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm text-slate-600 mb-1">Repair Estimate</p>
                  <p className="text-3xl font-bold text-orange-600">${(lead.repair_estimate / 1000).toFixed(0)}k</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-slate-600 mb-1">Est. Profit</p>
                  <p className="text-3xl font-bold text-green-600">${(lead.estimated_profit / 1000).toFixed(0)}k</p>
                </div>
              </div>

              {/* Profit Breakdown */}
              <div className="mt-6 bg-slate-50 p-4 rounded-lg">
                <p className="text-sm font-semibold text-slate-700 mb-3">Profit Calculation</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">ARV (Estimated)</span>
                    <span className="font-medium">${(lead.estimated_arv / 1000).toFixed(0)}k</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 mt-2">
                    <span className="text-slate-600">Less: Asking Price</span>
                    <span className="font-medium">-${(lead.asking_price / 1000).toFixed(0)}k</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Less: Repairs</span>
                    <span className="font-medium">-${(lead.repair_estimate / 1000).toFixed(0)}k</span>
                  </div>
                  <div className="flex justify-between bg-green-100 -mx-4 -mb-4 px-4 py-2 rounded-b font-semibold text-green-700">
                    <span>Estimated Profit</span>
                    <span>${(lead.estimated_profit / 1000).toFixed(0)}k</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Owner/Lead Source Section */}
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <User className="w-5 h-5 text-slate-600" />
                  Owner Information
                </h2>

                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Name</p>
                    <p className="font-medium text-slate-900">{lead.owner_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 mb-1 flex items-center gap-1">
                      <Phone className="w-4 h-4" /> Phone
                    </p>
                    <a href={`tel:${lead.owner_phone}`} className="text-blue-600 hover:underline font-medium">
                      {lead.owner_phone}
                    </a>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 mb-1 flex items-center gap-1">
                      <Mail className="w-4 h-4" /> Email
                    </p>
                    <a href={`mailto:${lead.owner_email}`} className="text-blue-600 hover:underline font-medium">
                      {lead.owner_email}
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-4">Lead Source & Status</h2>

                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Lead Source</p>
                    <p className="font-medium text-slate-900">{lead.lead_source}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Lead Status</p>
                    <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                      {lead.lead_status.replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Deal Status</p>
                    <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 rounded-full text-xs font-medium">
                      {lead.deal_status.replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Added</p>
                    <p className="font-medium text-slate-900">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes Section */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Notes</h2>
              <p className="text-slate-700 bg-slate-50 p-4 rounded">{lead.notes}</p>
            </div>
          </div>

          {/* Sidebar (Right 1/3) */}
          <div className="space-y-6">
            {/* Current Assignment */}
            {lead.assigned_buyer_id ? (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Assigned To
                </h2>

                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <p className="text-sm text-slate-600 mb-2">Buyer</p>
                  <p className="text-lg font-bold text-slate-900">{lead.assigned_buyer_name}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    Assigned: {new Date(lead.assignment_date).toLocaleDateString()}
                  </p>
                </div>

                <button className="w-full mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition">
                  Change Assignment
                </button>
              </div>
            ) : (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
                <div className="flex items-start gap-3 mb-4">
                  <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-orange-900">Not Yet Assigned</p>
                    <p className="text-sm text-orange-800">Select a buyer from recommendations below</p>
                  </div>
                </div>
              </div>
            )}

            {/* Recommended Buyers */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Recommended Buyers</h2>

              {recommendedBuyers.length > 0 ? (
                <div className="space-y-3">
                  {recommendedBuyers.map((buyer) => (
                    <div key={buyer.id} className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{buyer.company_name}</p>
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium mt-1 ${getTierColor(buyer.notes)}`}>
                            {getTierLabel(buyer.notes)}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-blue-600">{buyer.match_score}%</span>
                      </div>

                      <div className="space-y-2 mb-4 text-sm">
                        {buyer.contact_phone && (
                          <a href={`tel:${buyer.contact_phone}`} className="text-slate-600 hover:text-blue-600 flex items-center gap-2">
                            <Phone className="w-4 h-4" />
                            {buyer.contact_phone}
                          </a>
                        )}
                        {buyer.contact_email && (
                          <a href={`mailto:${buyer.contact_email}`} className="text-slate-600 hover:text-blue-600 flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            {buyer.contact_email}
                          </a>
                        )}
                      </div>

                      <button
                        onClick={() => handleAssignBuyer(buyer.id, buyer.company_name)}
                        disabled={assigningTo !== null}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition"
                      >
                        {assigningTo === buyer.id ? 'Assigning...' : 'Assign'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <p>No suitable buyers found for this market</p>
                </div>
              )}
            </div>

            {/* Lead Actions */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Actions</h2>

              <div className="space-y-2">
                <button className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition text-left">
                  ✎ Edit Lead
                </button>
                <button className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition text-left">
                  💬 Send Message
                </button>
                <button className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition text-left">
                  📞 Log Call
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
