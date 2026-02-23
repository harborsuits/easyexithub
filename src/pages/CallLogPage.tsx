import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, PhoneCall, Clock } from 'lucide-react';
import { FormattedSummary } from '@/utils/formatSummary';

const OUTCOME_COLORS: Record<string, string> = {
  interested: 'bg-green-100 text-green-800',
  callback: 'bg-blue-100 text-blue-800',
  not_interested: 'bg-red-100 text-red-800',
  no_answer: 'bg-slate-100 text-slate-700',
  voicemail: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-indigo-100 text-indigo-800',
};

export default function CallLogPage() {
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: calls, isLoading } = useQuery({
    queryKey: ['call-log', outcomeFilter, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('communications')
        .select('id, lead_id, contact_date, contact_time, outcome, summary, duration_minutes, notes, created_at')
        .eq('communication_type_id', 1)
        .order('created_at', { ascending: false });

      if (outcomeFilter !== 'all') query = query.eq('outcome', outcomeFilter);
      if (dateFrom) query = query.gte('contact_date', dateFrom);
      if (dateTo) query = query.lte('contact_date', dateTo);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) return [];

      const leadIds = [...new Set(data.map(c => c.lead_id).filter(Boolean))];
      const { data: leads } = await supabase.from('leads').select('id, owner_name, property_data, owner_address').in('id', leadIds);
      const leadMap: Record<number, any> = {};
      leads?.forEach(l => { leadMap[l.id] = l; });

      return data.map(c => {
        const lead = leadMap[c.lead_id];
        const name = lead?.owner_name || `Lead #${c.lead_id}`;
        let pd: any = {};
        try { pd = typeof lead?.property_data === 'string' ? JSON.parse(lead.property_data) : (lead?.property_data || {}); } catch {}
        const addr = pd.address || lead?.owner_address || '';
        const arv = pd.arv || pd.estimated_value || '';
        return { ...c, lead_name: name, property_address: addr, arv };
      });
    },
  });

  const outcomes = ['interested', 'callback', 'not_interested', 'no_answer', 'voicemail', 'scheduled'];

  const parseNotes = (notes: any) => {
    if (!notes) return null;
    if (typeof notes === 'string') {
      try { return JSON.parse(notes); } catch { return { text: notes }; }
    }
    return notes;
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Call Log</h1>
          <p className="text-muted-foreground">{calls?.length ?? '...'} calls recorded</p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Outcome</label>
                <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="all">All Outcomes</option>
                  {outcomes.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              {(outcomeFilter !== 'all' || dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setOutcomeFilter('all'); setDateFrom(''); setDateTo(''); }}>Clear</Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Call List */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading calls...</div>
            ) : !calls || calls.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No calls found</div>
            ) : (
              <div className="divide-y">
                {calls.map((call: any) => {
                  const notes = parseNotes(call.notes);
                  const hasTranscript = notes?.transcript;
                  const cost = notes?.cost;
                  const isExpanded = expandedId === call.id;

                  return (
                    <div key={call.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <PhoneCall className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link to={`/leads/${call.lead_id}`} className="font-medium text-blue-600 hover:underline">
                              {call.lead_name}
                            </Link>
                            {call.outcome && (
                              <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${OUTCOME_COLORS[call.outcome] || 'bg-gray-100 text-gray-700'}`}>
                                {call.outcome.replace(/_/g, ' ')}
                              </span>
                            )}
                            {call.duration_minutes != null && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock className="h-3 w-3" /> {call.duration_minutes}m</span>
                            )}
                            {cost != null && (
                              <span className="text-xs text-muted-foreground">${Number(cost).toFixed(2)}</span>
                            )}
                          </div>
                          {(call.property_address || call.arv) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {call.property_address && <><span className="font-semibold text-foreground">Property:</span> {call.property_address}</>}
                              {call.property_address && call.arv && <span className="mx-1 text-muted-foreground/50">|</span>}
                              {call.arv && <><span className="font-semibold text-foreground">ARV:</span> ${Number(call.arv).toLocaleString()}</>}
                            </p>
                          )}
                          <div className="mt-1"><FormattedSummary text={call.summary || ''} /></div>
                          {hasTranscript && (
                            <>
                              <button
                                onClick={() => setExpandedId(isExpanded ? null : call.id)}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                              >
                                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                {isExpanded ? 'Hide transcript' : 'Show transcript'}
                              </button>
                              {isExpanded && (
                                <div className="mt-2 bg-muted rounded p-3 text-xs max-h-64 overflow-auto whitespace-pre-wrap">
                                  {typeof notes.transcript === 'string' ? notes.transcript : JSON.stringify(notes.transcript, null, 2)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap text-right">
                          {call.contact_date || '—'}
                          {call.contact_time && <><br />{call.contact_time.slice(0, 5)}</>}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
