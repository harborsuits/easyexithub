import { useState } from 'react';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ActivityCard } from '@/components/activity/ActivityCard';



export default function CallLogPage() {
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: calls, isLoading } = useQuery({
    queryKey: ['call-log', outcomeFilter, dateFrom, dateTo],
    queryFn: async () => {
      let query = supabase
        .from('communications')
        .select('*')
        .order('created_at', { ascending: false });

      if (outcomeFilter !== 'all') query = query.eq('outcome', outcomeFilter);
      if (dateFrom) query = query.gte('contact_date', dateFrom);
      if (dateTo) query = query.lte('contact_date', dateTo);

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) return [];

      const leadIds = [...new Set(data.map(c => c.lead_id).filter(Boolean))];
      
      // Fetch lead details
      const { data: leads } = await supabase
        .from('leads')
        .select('id, owner_name, property_data, owner_address, distress_signals, engagement_level, status, next_action_type, next_action_at')
        .in('id', leadIds);
      
      const leadMap: Record<number, any> = {};
      leads?.forEach(l => { leadMap[l.id] = l; });

      // Fetch call history for each lead
      const { data: allComms } = await supabase
        .from('communications')
        .select('lead_id, contact_date, contact_time, outcome, direction')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: true });
      
      const callHistoryMap: Record<number, any[]> = {};
      allComms?.forEach(comm => {
        if (!callHistoryMap[comm.lead_id]) callHistoryMap[comm.lead_id] = [];
        callHistoryMap[comm.lead_id].push({
          date: comm.contact_date || '—',
          time: comm.contact_time?.slice(0, 5),
          outcome: comm.outcome || 'unknown',
          direction: comm.direction || 'outbound',
        });
      });

      return data.map(c => {
        const lead = leadMap[c.lead_id];
        const name = lead?.owner_name || `Lead #${c.lead_id}`;
        let pd: any = {};
        try { pd = typeof lead?.property_data === 'string' ? JSON.parse(lead.property_data) : (lead?.property_data || {}); } catch {}
        const addr = pd.property_address || pd.address || lead?.owner_address || '';
        
        // Determine next action
        let nextAction = null;
        if (lead?.status === 'dnc') {
          nextAction = { type: 'dnc', label: 'Lead Closed — Do Not Contact' };
        } else if (lead?.next_action_type === 'callback') {
          const actionDate = lead.next_action_at ? new Date(lead.next_action_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          nextAction = { type: 'callback', label: 'Callback scheduled', date: actionDate };
        } else if (lead?.next_action_type === 'follow_up') {
          const actionDate = lead.next_action_at ? new Date(lead.next_action_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          nextAction = { type: 'follow_up', label: 'Follow-up needed', date: actionDate };
        }
        
        return {
          ...c,
          lead_name: name,
          property_address: addr,
          distressSignals: lead?.distress_signals || [],
          leadTemperature: lead?.engagement_level || 'cold',
          callHistory: callHistoryMap[c.lead_id] || [],
          nextAction,
        };
      });
    },
  });

  const outcomes = ['interested', 'callback', 'not_interested', 'no_answer', 'voicemail', 'dnc', 'scheduled'];

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
        {isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">Loading calls...</CardContent>
          </Card>
        ) : !calls || calls.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">No calls found</CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {calls.map((call: any) => (
              <ActivityCard
                key={call.id}
                call={call}
                distressSignals={call.distressSignals}
                callHistory={call.callHistory}
                leadTemperature={call.leadTemperature}
                nextAction={call.nextAction}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
