import { useState } from 'react';
import { AppLayout } from '@/components/common/AppLayout';
import { useImportedLeads } from '@/hooks/useImportedLeads';
import { Phone, Mail, CheckCircle, Clock, AlertCircle, RefreshCw } from 'lucide-react';

export default function BatchLeadsDashboard() {
  const { leads, loading, error, refresh } = useImportedLeads();
  const [filter, setFilter] = useState<'all' | 'VERY HIGH' | 'HIGH' | 'MODERATE' | 'LOW'>('all');

  const filteredLeads = filter === 'all' 
    ? leads 
    : leads.filter(l => l.motivation === filter);

  const stats = {
    veryHigh: leads.filter(l => l.motivation === 'VERY HIGH').length,
    high: leads.filter(l => l.motivation === 'HIGH').length,
    moderate: leads.filter(l => l.motivation === 'MODERATE').length,
    low: leads.filter(l => l.motivation === 'LOW').length,
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-blue-600" />
            <p className="text-gray-600">Loading leads...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <AlertCircle className="w-6 h-6 text-red-600 mb-2" />
          <h3 className="font-semibold text-red-900 mb-2">Error Loading Leads</h3>
          <p className="text-red-700 text-sm">{error}</p>
          <p className="text-red-600 text-sm mt-2">
            Make sure API server is running: <code className="bg-red-100 px-2 py-1 rounded">python3 dashboard/api_server.py</code>
          </p>
          <button 
            onClick={refresh}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">BatchLeads Pipeline</h1>
            <p className="text-gray-600 mt-1">{leads.length} leads processed and scored</p>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <button
            onClick={() => setFilter('VERY HIGH')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'VERY HIGH'
                ? 'border-red-500 bg-red-50'
                : 'border-gray-200 bg-white hover:border-red-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">VERY HIGH Priority</div>
            <div className="text-3xl font-bold text-red-600">{stats.veryHigh}</div>
            <div className="text-xs text-gray-500 mt-1">Contact TODAY</div>
          </button>

          <button
            onClick={() => setFilter('HIGH')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'HIGH'
                ? 'border-orange-500 bg-orange-50'
                : 'border-gray-200 bg-white hover:border-orange-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">HIGH Priority</div>
            <div className="text-3xl font-bold text-orange-600">{stats.high}</div>
            <div className="text-xs text-gray-500 mt-1">Contact this week</div>
          </button>

          <button
            onClick={() => setFilter('MODERATE')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'MODERATE'
                ? 'border-yellow-500 bg-yellow-50'
                : 'border-gray-200 bg-white hover:border-yellow-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">MODERATE Priority</div>
            <div className="text-3xl font-bold text-yellow-600">{stats.moderate}</div>
            <div className="text-xs text-gray-500 mt-1">Contact in 2 weeks</div>
          </button>

          <button
            onClick={() => setFilter('all')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'all'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-blue-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">All Leads</div>
            <div className="text-3xl font-bold text-gray-900">{leads.length}</div>
            <div className="text-xs text-gray-500 mt-1">Total pipeline</div>
          </button>
        </div>

        {/* Leads List */}
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Property</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Owner</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Signals</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredLeads.map((lead, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        lead.priority === 1 ? 'bg-red-100 text-red-800' :
                        lead.priority === 2 ? 'bg-orange-100 text-orange-800' :
                        lead.priority === 3 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        P{lead.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">{lead.address}</div>
                      <div className="text-xs text-gray-500">{lead.city}, {lead.state} {lead.zip}</div>
                      <div className="text-xs text-gray-500">${lead.assessed_value.toLocaleString()}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{lead.owner_name || 'N/A'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {lead.owner_phone && !lead.owner_phone.includes('555') ? (
                          <div className="flex items-center gap-1 text-xs text-gray-700">
                            <Phone className="w-3 h-3" />
                            {lead.owner_phone}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400">No phone</div>
                        )}
                        {lead.owner_email ? (
                          <div className="flex items-center gap-1 text-xs text-gray-700">
                            <Mail className="w-3 h-3" />
                            {lead.owner_email}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-lg font-bold text-gray-900">{lead.distress_score}</div>
                      <div className={`text-xs font-semibold ${
                        lead.motivation === 'VERY HIGH' ? 'text-red-600' :
                        lead.motivation === 'HIGH' ? 'text-orange-600' :
                        lead.motivation === 'MODERATE' ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {lead.motivation}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {lead.tax_delinquent && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 text-xs rounded">Tax</span>
                        )}
                        {lead.violations && (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-800 text-xs rounded">Violations</span>
                        )}
                        {lead.probate && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded">Probate</span>
                        )}
                        {lead.lis_pendens && (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded">Lis Pendens</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {lead.owner_phone && !lead.owner_phone.includes('555') && (
                          <button
                            onClick={() => window.location.href = `tel:${lead.owner_phone}`}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            title="Call"
                          >
                            <Phone className="w-4 h-4" />
                          </button>
                        )}
                        {lead.owner_email && (
                          <button
                            onClick={() => window.location.href = `mailto:${lead.owner_email}`}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            title="Email"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {filteredLeads.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No leads match this filter
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
