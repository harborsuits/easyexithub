import { useState } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader, RefreshCw, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { fetchProcessedLeads, fetchLeadStats, convertToAppLead, ProcessedLead } from '@/services/csvImporter';
import { supabase } from '@/integrations/supabase/client';

export default function ImportLeadsPage() {
  const [leads, setLeads] = useState<ProcessedLead[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLeads = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedLeads, fetchedStats] = await Promise.all([
        fetchProcessedLeads(),
        fetchLeadStats()
      ]);
      setLeads(fetchedLeads);
      setStats(fetchedStats);
    } catch (err: any) {
      setError(err.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  const importLeads = async () => {
    if (leads.length === 0) {
      setError('No leads to import');
      return;
    }

    setImporting(true);
    setError(null);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const processed of leads) {
        try {
          const appLead = convertToAppLead(processed);
          
          // Check if lead already exists by address
          const { data: existing } = await supabase
            .from('leads')
            .select('id')
            .eq('property_address', appLead.property_address)
            .single();

          if (!existing) {
            // Insert new lead
            const { error: insertError } = await supabase
              .from('leads')
              .insert([appLead]);

            if (insertError) {
              console.error('Insert error:', insertError);
              errorCount++;
            } else {
              successCount++;
            }
          } else {
            // Skip duplicate
            console.log('Skipping duplicate:', appLead.property_address);
          }
        } catch (err) {
          console.error('Error processing lead:', err);
          errorCount++;
        }
      }

      setResult({ success: successCount, errors: errorCount });
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link 
            to="/leads" 
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Leads
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Import BatchLeads</h1>
          <p className="text-slate-600">Import processed leads from BatchLeads CSV exports</p>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-slate-600 mb-1">Total Leads</p>
              <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
            </div>
            <div className="bg-red-50 rounded-lg shadow p-4 border-l-4 border-red-500">
              <p className="text-sm text-slate-600 mb-1">Very High Priority</p>
              <p className="text-3xl font-bold text-red-600">{stats.very_high}</p>
            </div>
            <div className="bg-orange-50 rounded-lg shadow p-4 border-l-4 border-orange-500">
              <p className="text-sm text-slate-600 mb-1">High Priority</p>
              <p className="text-3xl font-bold text-orange-600">{stats.high}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg shadow p-4 border-l-4 border-yellow-500">
              <p className="text-sm text-slate-600 mb-1">Moderate Priority</p>
              <p className="text-3xl font-bold text-yellow-600">{stats.moderate}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Load Processed CSVs</h2>
              <p className="text-sm text-slate-600">
                Fetch leads from: <code className="bg-slate-100 px-2 py-1 rounded">scrapers/data/exports/</code>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={loadLeads}
                disabled={loading}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-4 py-2 rounded-lg transition"
              >
                {loading ? <Loader className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                {loading ? 'Loading...' : 'Load Leads'}
              </button>
              
              {leads.length > 0 && (
                <button
                  onClick={importLeads}
                  disabled={importing}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white px-4 py-2 rounded-lg transition"
                >
                  {importing ? <Loader className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                  {importing ? 'Importing...' : `Import ${leads.length} Leads`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900 mb-1">Error</h3>
              <p className="text-sm text-red-700">{error}</p>
              <p className="text-sm text-red-600 mt-2">
                Make sure the API server is running: <code className="bg-red-100 px-2 py-1 rounded">python3 dashboard/api_server.py</code>
              </p>
            </div>
          </div>
        )}

        {/* Success Result */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900 mb-1">Import Complete</h3>
              <p className="text-sm text-green-700">
                Successfully imported <strong>{result.success}</strong> leads.
                {result.errors > 0 && ` ${result.errors} errors encountered.`}
              </p>
            </div>
          </div>
        )}

        {/* Leads Preview */}
        {leads.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Preview ({leads.length} leads)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Priority</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Address</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Owner</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Phone</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Score</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Motivation</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-900">Signals</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {leads.slice(0, 20).map((lead, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          lead.priority === 1 ? 'bg-red-100 text-red-800' :
                          lead.priority === 2 ? 'bg-orange-100 text-orange-800' :
                          lead.priority === 3 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {lead.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-900">{lead.address}</div>
                        <div className="text-xs text-slate-500">{lead.city}, {lead.state}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{lead.owner_name || 'N/A'}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {lead.owner_phone && !lead.owner_phone.includes('555') ? lead.owner_phone : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">{lead.distress_score}</td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-semibold ${
                          lead.motivation === 'VERY HIGH' ? 'text-red-600' :
                          lead.motivation === 'HIGH' ? 'text-orange-600' :
                          lead.motivation === 'MODERATE' ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {lead.motivation}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {lead.tax_delinquent && <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded">Tax</span>}
                          {lead.violations && <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">Viol</span>}
                          {lead.probate && <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded">Prob</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leads.length > 20 && (
              <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-600">
                Showing 20 of {leads.length} leads
              </div>
            )}
          </div>
        )}

        {/* No Leads State */}
        {!loading && !error && leads.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Upload className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No Leads Loaded</h3>
            <p className="text-slate-600 mb-4">Click "Load Leads" to fetch processed BatchLeads CSVs</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
