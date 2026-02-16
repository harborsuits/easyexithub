import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { Phone, Mail, RefreshCw, Upload, AlertCircle } from 'lucide-react';
import { fetchProcessedLeads, convertToAppLead } from '@/services/csvImporter';

interface Lead {
  id?: number;
  owner_name: string;
  owner_phone: string | null;
  owner_email: string | null;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  assessed_value: number;
  distress_score: number;
  motivation_level: string;
  priority: number;
  tax_delinquent: boolean;
  violations: boolean;
  probate: boolean;
  lis_pendens: boolean;
  lead_source: string;
  deal_stage: string;
  created_at?: string;
}

export default function UnifiedDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<'all' | 'VERY HIGH' | 'HIGH' | 'MODERATE' | 'LOW'>('all');

  const loadFromSupabase = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('priority', { ascending: true });

      if (error) throw error;
      setLeads(data || []);
    } catch (err) {
      console.error('Error loading from Supabase:', err);
    } finally {
      setLoading(false);
    }
  };

  const importFromCSV = async () => {
    setImporting(true);
    try {
      const processedLeads = await fetchProcessedLeads();
      let imported = 0;

      for (const processed of processedLeads) {
        const appLead = convertToAppLead(processed);
        
        // Check if exists
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('property_address', appLead.property_address)
          .single();

        if (!existing) {
          const { error } = await supabase
            .from('leads')
            .insert([appLead]);

          if (!error) imported++;
        }
      }

      alert(`Imported ${imported} new leads`);
      await loadFromSupabase();
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    loadFromSupabase();
  }, []);

  const filteredLeads = filter === 'all' 
    ? leads 
    : leads.filter(l => l.motivation_level === filter);

  const stats = {
    veryHigh: leads.filter(l => l.motivation_level === 'VERY HIGH').length,
    high: leads.filter(l => l.motivation_level === 'HIGH').length,
    moderate: leads.filter(l => l.motivation_level === 'MODERATE').length,
    low: leads.filter(l => l.motivation_level === 'LOW').length,
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Easy Exit Pipeline</h1>
            <p className="text-gray-600 mt-1">{leads.length} leads in database</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadFromSupabase}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              onClick={importFromCSV}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
            >
              <Upload className="w-4 h-4" />
              {importing ? 'Importing...' : 'Import New'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <button
            onClick={() => setFilter('VERY HIGH')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'VERY HIGH' ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">VERY HIGH</div>
            <div className="text-3xl font-bold text-red-600">{stats.veryHigh}</div>
          </button>
          <button
            onClick={() => setFilter('HIGH')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'HIGH' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 bg-white hover:border-orange-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">HIGH</div>
            <div className="text-3xl font-bold text-orange-600">{stats.high}</div>
          </button>
          <button
            onClick={() => setFilter('MODERATE')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'MODERATE' ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200 bg-white hover:border-yellow-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">MODERATE</div>
            <div className="text-3xl font-bold text-yellow-600">{stats.moderate}</div>
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`p-4 rounded-lg border-2 transition ${
              filter === 'all' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'
            }`}
          >
            <div className="text-sm text-gray-600 mb-1">ALL</div>
            <div className="text-3xl font-bold text-gray-900">{leads.length}</div>
          </button>
        </div>

        {/* Leads Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">P</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Property</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Score</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Signals</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${
                      lead.priority === 1 ? 'bg-red-100 text-red-800' :
                      lead.priority === 2 ? 'bg-orange-100 text-orange-800' :
                      lead.priority === 3 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {lead.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{lead.property_address}</div>
                    <div className="text-xs text-gray-500">{lead.property_city}, {lead.property_state}</div>
                    <div className="text-xs text-gray-600">${lead.assessed_value.toLocaleString()}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{lead.owner_name}</td>
                  <td className="px-4 py-3">
                    {lead.owner_phone ? (
                      <div className="text-xs text-gray-700">{lead.owner_phone}</div>
                    ) : (
                      <div className="text-xs text-gray-400">No phone</div>
                    )}
                    {lead.owner_email && (
                      <div className="text-xs text-gray-600">{lead.owner_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xl font-bold text-gray-900">{lead.distress_score}</div>
                    <div className={`text-xs font-semibold ${
                      lead.motivation_level === 'VERY HIGH' ? 'text-red-600' :
                      lead.motivation_level === 'HIGH' ? 'text-orange-600' :
                      lead.motivation_level === 'MODERATE' ? 'text-yellow-600' :
                      'text-green-600'
                    }`}>
                      {lead.motivation_level}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {lead.tax_delinquent && <span className="px-1.5 py-0.5 bg-red-100 text-red-800 text-xs rounded">Tax</span>}
                      {lead.violations && <span className="px-1.5 py-0.5 bg-orange-100 text-orange-800 text-xs rounded">Viol</span>}
                      {lead.probate && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 text-xs rounded">Prob</span>}
                      {lead.lis_pendens && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded">LP</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {lead.owner_phone && (
                        <a href={`tel:${lead.owner_phone}`} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                          <Phone className="w-4 h-4" />
                        </a>
                      )}
                      {lead.owner_email && (
                        <a href={`mailto:${lead.owner_email}`} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                          <Mail className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredLeads.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {leads.length === 0 ? 'No leads yet - click "Import New" to load from BatchLeads' : 'No leads match this filter'}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
