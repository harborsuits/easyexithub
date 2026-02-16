import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Filter, Search, AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';

interface Deal {
  id: number;
  property_address: string;
  property_city: string;
  market: string;
  assigned_buyer_name: string;
  assigned_buyer_id: number;
  assignment_date: string;
  deal_status: 'assigned' | 'negotiating' | 'contract_sent' | 'contract_signed' | 'closing' | 'closed' | 'dead';
  asking_price: number;
  contract_price?: number;
  estimated_profit: number;
  closing_date?: string;
}

const MOCK_DEALS: Deal[] = [
  {
    id: 2,
    property_address: '2847 29th St N',
    property_city: 'Birmingham',
    market: 'Birmingham, AL',
    assigned_buyer_name: 'TyZhea Warren',
    assigned_buyer_id: 5,
    assignment_date: '2026-02-09T14:30:00Z',
    deal_status: 'negotiating',
    asking_price: 92000,
    contract_price: 88000,
    estimated_profit: 35000,
  },
  {
    id: 4,
    property_address: '1234 Oak Street',
    property_city: 'Birmingham',
    market: 'Birmingham, AL',
    assigned_buyer_name: 'Daniel Johnathan',
    assigned_buyer_id: 7,
    assignment_date: '2026-02-07T11:45:00Z',
    deal_status: 'contract_signed',
    asking_price: 95000,
    contract_price: 91000,
    estimated_profit: 25000,
    closing_date: '2026-03-15',
  },
  {
    id: 6,
    property_address: '567 Maple Drive',
    property_city: 'Kansas City',
    market: 'Kansas City, MO',
    assigned_buyer_name: 'Mike Mann',
    assigned_buyer_id: 8,
    assignment_date: '2026-02-05T09:20:00Z',
    deal_status: 'contract_sent',
    asking_price: 88000,
    estimated_profit: 25000,
  },
  {
    id: 7,
    property_address: '3421 5th Avenue S',
    property_city: 'Birmingham',
    market: 'Birmingham, AL',
    assigned_buyer_name: 'Wesley Sirivongxay',
    assigned_buyer_id: 4,
    assignment_date: '2026-02-01T13:00:00Z',
    deal_status: 'closed',
    asking_price: 78000,
    contract_price: 75000,
    estimated_profit: 32000,
    closing_date: '2026-02-08',
  },
  {
    id: 8,
    property_address: '9876 Market Street',
    property_city: 'Birmingham',
    market: 'Birmingham, AL',
    assigned_buyer_name: 'Ex Flipper',
    assigned_buyer_id: 6,
    assignment_date: '2026-01-28T10:15:00Z',
    deal_status: 'closing',
    asking_price: 105000,
    contract_price: 100000,
    estimated_profit: 28000,
    closing_date: '2026-02-14',
  },
];

const getDealStatusIcon = (status: string) => {
  const icons: Record<string, any> = {
    assigned: <Clock className="w-4 h-4" />,
    negotiating: <AlertCircle className="w-4 h-4" />,
    contract_sent: <Clock className="w-4 h-4" />,
    contract_signed: <CheckCircle className="w-4 h-4" />,
    closing: <TrendingUp className="w-4 h-4" />,
    closed: <CheckCircle className="w-4 h-4" />,
    dead: <XCircle className="w-4 h-4" />,
  };
  return icons[status] || null;
};

const getDealStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    assigned: 'bg-blue-50 text-blue-700 border-blue-200',
    negotiating: 'bg-orange-50 text-orange-700 border-orange-200',
    contract_sent: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    contract_signed: 'bg-green-50 text-green-700 border-green-200',
    closing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    closed: 'bg-green-100 text-green-800 border-green-300',
    dead: 'bg-red-50 text-red-700 border-red-200',
  };
  return colors[status] || 'bg-slate-50 text-slate-700';
};

const getStatusStepPosition = (status: string): number => {
  const steps: Record<string, number> = {
    assigned: 1,
    negotiating: 2,
    contract_sent: 3,
    contract_signed: 4,
    closing: 5,
    closed: 6,
    dead: -1,
  };
  return steps[status] || 0;
};

const STATUS_WORKFLOW = ['Assigned', 'Negotiating', 'Contract Sent', 'Contract Signed', 'Closing', 'Closed'];

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [filteredDeals, setFilteredDeals] = useState<Deal[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch real assigned leads from Supabase
  useEffect(() => {
    const fetchDeals = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('leads')
          .select(`
            id,
            owner_name,
            assignment_date,
            estimated_arv,
            estimated_equity,
            assigned_buyer_id,
            market_id,
            markets(name),
            buyers(company_name, contact_name)
          `)
          .not('assigned_buyer_id', 'is', null)
          .order('assignment_date', { ascending: false });

        if (fetchError) {
          throw fetchError;
        }

        // Map Supabase response to Deal interface
        const mappedDeals: Deal[] = (data || []).map((lead: any) => ({
          id: lead.id,
          property_address: lead.owner_name || 'Unnamed Property',
          property_city: '', // Not in leads schema
          market: lead.markets?.name || 'Unknown Market',
          assigned_buyer_name: lead.buyers?.company_name || lead.buyers?.contact_name || 'Unknown Buyer',
          assigned_buyer_id: lead.assigned_buyer_id,
          assignment_date: lead.assignment_date,
          deal_status: 'assigned' as const, // All fetched deals start as 'assigned'
          asking_price: 0, // Not in leads schema
          estimated_profit: 0, // Placeholder
          contract_price: undefined,
          closing_date: undefined,
        }));

        setDeals(mappedDeals);
      } catch (err) {
        console.error('Error fetching deals:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch deals');
        setDeals([]); // Show empty state on error, not mock data
      } finally {
        setLoading(false);
      }
    };

    fetchDeals();
  }, []);

  // Filter deals when deals, searchTerm, statusFilter, or marketFilter change
  useEffect(() => {
    let filtered = deals;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(deal =>
        deal.property_address.toLowerCase().includes(searchTerm.toLowerCase()) ||
        deal.assigned_buyer_name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(deal => deal.deal_status === statusFilter);
    }

    // Market filter
    if (marketFilter !== 'all') {
      filtered = filtered.filter(deal => deal.market === marketFilter);
    }

    setFilteredDeals(filtered);
  }, [deals, searchTerm, statusFilter, marketFilter]);

  const stats = {
    totalDeals: deals.length,
    inProgress: deals.filter(d => !['closed', 'dead'].includes(d.deal_status)).length,
    closed: deals.filter(d => d.deal_status === 'closed').length,
    totalProfit: deals
      .filter(d => d.deal_status === 'closed')
      .reduce((sum, d) => sum + d.estimated_profit, 0),
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-6">Deal Tracker</h1>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Active Deals</p>
              <p className="text-3xl font-bold text-blue-600">{stats.inProgress}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Closed Deals</p>
              <p className="text-3xl font-bold text-green-600">{stats.closed}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Profit from Closed</p>
              <p className="text-3xl font-bold text-emerald-600">${(stats.totalProfit / 1000).toFixed(0)}k</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Total Deals</p>
              <p className="text-3xl font-bold text-slate-600">{stats.totalDeals}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by address or buyer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="assigned">Assigned</option>
              <option value="negotiating">Negotiating</option>
              <option value="contract_sent">Contract Sent</option>
              <option value="contract_signed">Contract Signed</option>
              <option value="closing">Closing</option>
              <option value="closed">Closed</option>
              <option value="dead">Dead</option>
            </select>

            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Markets</option>
              <option value="Birmingham, AL">Birmingham, AL</option>
              <option value="Kansas City, MO">Kansas City, MO</option>
            </select>
          </div>
        </div>

        {/* Deals List */}
        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-slate-500 text-lg">Loading deals...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 rounded-lg shadow p-6 border border-red-200">
              <p className="text-red-700 font-medium">Error loading deals:</p>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          ) : filteredDeals.length > 0 ? (
            filteredDeals.map((deal) => (
              <div key={deal.id} className="bg-white rounded-lg shadow hover:shadow-md transition overflow-hidden">
                <div className="p-6">
                  {/* Deal Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <Link to={`/leads/${deal.id}`} className="hover:text-blue-600">
                        <h3 className="text-xl font-bold text-slate-900">{deal.property_address}</h3>
                      </Link>
                      <p className="text-slate-600 text-sm">
                        {deal.property_city} • {deal.market}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-3xl font-bold text-slate-900 mb-1">
                        ${(deal.contract_price || deal.asking_price) / 1000}k
                      </div>
                      <p className="text-xs text-slate-500">
                        {deal.contract_price ? 'Contract Price' : 'Asking Price'}
                      </p>
                    </div>
                  </div>

                  {/* Buyer & Status */}
                  <div className="mb-4 pb-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-600 mb-1">Assigned Buyer</p>
                      <p className="font-semibold text-slate-900">{deal.assigned_buyer_name}</p>
                    </div>

                    <div className={`px-4 py-2 rounded-full border flex items-center gap-2 font-medium text-sm ${getDealStatusColor(deal.deal_status)}`}>
                      {getDealStatusIcon(deal.deal_status)}
                      {deal.deal_status.replace('_', ' ')}
                    </div>
                  </div>

                  {/* Workflow Progress */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600">DEAL PROGRESS</span>
                      {deal.closing_date && deal.deal_status !== 'dead' && (
                        <span className="text-xs text-slate-500">
                          {deal.deal_status === 'closed' ? 'Closed' : 'Target'}: {new Date(deal.closing_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {STATUS_WORKFLOW.map((step, index) => {
                        const currentStep = getStatusStepPosition(deal.deal_status);
                        const isCompleted = index + 1 <= currentStep;
                        const isCurrent = index + 1 === currentStep;

                        return (
                          <div key={step} className="flex-1 flex items-center">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition ${
                                isCompleted
                                  ? 'bg-green-600 text-white'
                                  : isCurrent
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {isCompleted ? '✓' : index + 1}
                            </div>
                            {index < STATUS_WORKFLOW.length - 1 && (
                              <div
                                className={`flex-1 h-1 mx-1 transition ${
                                  isCompleted ? 'bg-green-600' : 'bg-slate-200'
                                }`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-between mt-2">
                      {STATUS_WORKFLOW.map((step) => (
                        <span key={step} className="text-xs text-slate-500 w-12 text-center">
                          {step.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Financial Details */}
                  <div className="grid grid-cols-4 gap-4 mb-4 pt-4 border-t border-slate-200">
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Asking Price</p>
                      <p className="font-semibold text-slate-900">${(deal.asking_price / 1000).toFixed(0)}k</p>
                    </div>
                    {deal.contract_price && (
                      <div>
                        <p className="text-xs text-slate-600 mb-1">Contract Price</p>
                        <p className="font-semibold text-slate-900">${(deal.contract_price / 1000).toFixed(0)}k</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Est. Profit</p>
                      <p className="font-semibold text-green-600">${(deal.estimated_profit / 1000).toFixed(0)}k</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Assigned</p>
                      <p className="font-semibold text-slate-900">
                        {new Date(deal.assignment_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link
                      to={`/leads/${deal.id}`}
                      className="flex-1 px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium rounded-lg transition text-center text-sm"
                    >
                      View Lead Details
                    </Link>
                    <button className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition text-sm">
                      Update Status
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <p className="text-slate-500 text-lg">
                {deals.length === 0 ? 'No assigned deals yet' : 'No deals found matching your filters'}
              </p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
