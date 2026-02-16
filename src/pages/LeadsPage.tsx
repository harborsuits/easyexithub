import { useState, useEffect } from 'react';
import { MapPin, DollarSign, TrendingUp, Plus, Search, Filter, Loader } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { useLeads, Lead } from '@/context/LeadsContextV2';

const getStatusBadgeColor = (stageName?: string) => {
  if (!stageName) return 'bg-gray-100 text-gray-800';
  const lowerName = stageName.toLowerCase();
  
  if (lowerName.includes('raw')) return 'bg-blue-100 text-blue-800';
  if (lowerName.includes('contacted')) return 'bg-purple-100 text-purple-800';
  if (lowerName.includes('negotiat')) return 'bg-orange-100 text-orange-800';
  if (lowerName.includes('contract')) return 'bg-green-100 text-green-800';
  if (lowerName.includes('closed')) return 'bg-emerald-100 text-emerald-800';
  return 'bg-gray-100 text-gray-800';
};

export default function LeadsPage() {
  const { leads, markets, loading } = useLeads();
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);

  useEffect(() => {
    let filtered = leads;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(lead =>
        (lead.owner_name?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
        (lead.owner_email?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
      );
    }

    // Market filter
    if (marketFilter !== 'all') {
      filtered = filtered.filter(lead => lead.market_id === parseInt(marketFilter));
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(lead => lead.deal_stage_id === parseInt(statusFilter));
    }

    setFilteredLeads(filtered);
  }, [leads, searchTerm, marketFilter, statusFilter, showUnassignedOnly]);

  const statsData = {
    totalLeads: leads.length,
    unassigned: leads.filter(l => l.status !== 'assigned').length,
    totalProfit: leads.reduce((sum, l) => {
      const arv = l.estimated_arv || 0;
      return sum + arv;
    }, 0),
    mainLeads: leads.filter(l => l.market_id === 2).length,
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-4xl font-bold text-slate-900">Leads Pipeline</h1>
            <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">
              <Plus className="w-5 h-5" />
              New Lead
            </button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Total Leads</p>
              <p className="text-3xl font-bold text-slate-900">{statsData.totalLeads}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Est. Profit</p>
              <p className="text-3xl font-bold text-green-600">${(statsData.totalProfit / 1000).toFixed(0)}k</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Loading</p>
              {loading ? <Loader className="w-6 h-6 text-blue-600 animate-spin" /> : <p className="text-3xl font-bold text-slate-900">Ready</p>}
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Maine</p>
              <p className="text-3xl font-bold text-blue-600">{statsData.mainLeads}</p>
            </div>
          </div>
        </div>

        {/* Filters Section */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search */}
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by address or city..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Market Filter */}
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Markets</option>
              {markets.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="negotiating">Negotiating</option>
              <option value="under_contract">Under Contract</option>
              <option value="closed">Closed</option>
            </select>

            {/* Unassigned Only */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showUnassignedOnly}
                onChange={(e) => setShowUnassignedOnly(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Unassigned Only</span>
            </label>
          </div>
        </div>

        {/* Leads Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Address</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Market</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-slate-900">ARV</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-slate-900">Est. Profit</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Lead Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Deal Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <Loader className="w-6 h-6 text-blue-600 animate-spin mx-auto mb-2" />
                      <p className="text-slate-500">Loading leads...</p>
                    </td>
                  </tr>
                ) : filteredLeads.length > 0 ? (
                  filteredLeads.map((lead) => {
                    const arv = lead.estimated_arv || 0;
                    const profit = arv * 0.15; // Estimated 15% profit margin for display
                    const marketName = lead.market?.name || `Market ${lead.market_id}`;
                    const stageName = lead.deal_stage?.name || 'Unknown';
                    
                    return (
                      <tr key={lead.id} className="hover:bg-slate-50 transition">
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-medium text-slate-900">{lead.owner_name}</p>
                            <p className="text-sm text-slate-500">{lead.lead_source || 'Direct'}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">{marketName}</td>
                        <td className="px-6 py-4 text-right font-medium text-slate-900">
                          ${(arv / 1000).toFixed(0)}k
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`font-medium ${profit > 0 ? 'text-green-600' : 'text-gray-600'}`}>
                            ${(profit / 1000).toFixed(0)}k
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800`}>
                            {stageName}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${lead.status === 'assigned' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}`}>
                            {lead.status === 'assigned' ? 'Assigned' : 'Unassigned'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <Link
                            to={`/leads/${lead.id}`}
                            className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      No leads found matching your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
