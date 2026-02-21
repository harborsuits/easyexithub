import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Phone, PhoneCall, CalendarClock, ArrowRight, Flame, PhoneMissed, Clock } from 'lucide-react';

const STAGE_COLORS: Record<string, string> = {
  raw_lead: '#94a3b8',
  contacted: '#3b82f6',
  qualified: '#8b5cf6',
  offer_made: '#f59e0b',
  under_contract: '#10b981',
  assigned: '#06b6d4',
  closed_won: '#22c55e',
  closed_lost: '#ef4444',
  dead: '#6b7280',
};

const OUTCOME_COLORS: Record<string, string> = {
  interested: 'bg-green-100 text-green-800',
  callback: 'bg-blue-100 text-blue-800',
  not_interested: 'bg-red-100 text-red-800',
  no_answer: 'bg-slate-100 text-slate-700',
  voicemail: 'bg-amber-100 text-amber-800',
  note: 'bg-gray-100 text-gray-700',
};

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

export default function UnifiedDashboard() {
  const today = new Date().toISOString().split('T')[0];

  const { data: totalLeads, isLoading: l1 } = useQuery({
    queryKey: ['kpi-total-leads'],
    queryFn: async () => {
      const { count } = await supabase.from('leads').select('*', { count: 'exact', head: true });
      return count || 0;
    },
  });

  const { data: leadsWithPhone, isLoading: l2 } = useQuery({
    queryKey: ['kpi-leads-phone'],
    queryFn: async () => {
      const { count } = await supabase.from('leads').select('*', { count: 'exact', head: true }).not('owner_phone', 'is', null).neq('owner_phone', '');
      return count || 0;
    },
  });

  const { data: callsMade, isLoading: l3 } = useQuery({
    queryKey: ['kpi-calls-made'],
    queryFn: async () => {
      const { count } = await supabase.from('communications').select('*', { count: 'exact', head: true }).eq('communication_type_id', 1);
      return count || 0;
    },
  });

  const { data: followupsDue, isLoading: l4 } = useQuery({
    queryKey: ['kpi-followups-due'],
    queryFn: async () => {
      const { count } = await supabase.from('leads').select('*', { count: 'exact', head: true }).lte('next_followup_date', today).not('next_followup_date', 'is', null);
      return count || 0;
    },
  });

  const { data: dealStages } = useQuery({
    queryKey: ['deal-stages'],
    queryFn: async () => {
      const { data } = await supabase.from('deal_stages').select('id, name').order('id');
      return data || [];
    },
  });

  const { data: leads } = useQuery({
    queryKey: ['leads-stages'],
    queryFn: async () => {
      const { data } = await supabase.from('leads').select('id, deal_stage_id');
      return data || [];
    },
  });

  const { data: recentComms } = useQuery({
    queryKey: ['recent-comms'],
    queryFn: async () => {
      const { data } = await supabase
        .from('communications')
        .select('id, lead_id, contact_date, outcome, summary, communication_type_id, duration_minutes')
        .order('created_at', { ascending: false })
        .limit(10);
      if (!data || data.length === 0) return [];
      const leadIds = [...new Set(data.map(c => c.lead_id).filter(Boolean))];
      const { data: leadNames } = await supabase.from('leads').select('id, owner_name').in('id', leadIds);
      const nameMap: Record<number, string> = {};
      leadNames?.forEach(l => { nameMap[l.id] = l.owner_name || `Lead #${l.id}`; });
      return data.map(c => ({ ...c, lead_name: nameMap[c.lead_id] || `Lead #${c.lead_id}` }));
    },
  });

  const { data: todayFollowups } = useQuery({
    queryKey: ['today-followups'],
    queryFn: async () => {
      const { data } = await supabase
        .from('leads')
        .select('id, owner_name, viability_score, next_followup_date')
        .lte('next_followup_date', today)
        .not('next_followup_date', 'is', null)
        .order('viability_score', { ascending: false, nullsFirst: false })
        .limit(10);
      return data || [];
    },
  });

  const { data: neverContacted } = useQuery({
    queryKey: ['never-contacted-hot'],
    queryFn: async () => {
      const { data } = await supabase
        .from('leads')
        .select('id, owner_name, viability_score')
        .gte('viability_score', 40)
        .is('last_contact_date', null)
        .order('viability_score', { ascending: false, nullsFirst: false })
        .limit(10);
      return data || [];
    },
  });

  const pipelineCounts = dealStages?.map((stage) => ({
    name: stage.name,
    count: leads?.filter((l) => l.deal_stage_id === stage.id).length || 0,
    color: STAGE_COLORS[stage.name] || '#94a3b8',
  })) || [];

  const commTypeIcon = (typeId: number) => {
    if (typeId === 1) return <PhoneCall className="h-4 w-4 text-blue-500" />;
    if (typeId === 2) return <Phone className="h-4 w-4 text-green-500" />;
    return <Clock className="h-4 w-4 text-gray-500" />;
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">Easy Exit Homes — operational overview</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-blue-50/50 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Total Leads</p>
                  {l1 ? <Skeleton className="h-9 w-20 mt-1" /> : <p className="text-3xl font-bold text-blue-900">{totalLeads?.toLocaleString()}</p>}
                </div>
                <Users className="h-8 w-8 text-blue-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-green-50/50 border-green-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-600 font-medium">With Phone</p>
                  {l2 ? <Skeleton className="h-9 w-16 mt-1" /> : <p className="text-3xl font-bold text-green-900">{leadsWithPhone?.toLocaleString()}</p>}
                </div>
                <Phone className="h-8 w-8 text-green-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-orange-50/50 border-orange-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-orange-600 font-medium">Calls Made</p>
                  {l3 ? <Skeleton className="h-9 w-12 mt-1" /> : <p className="text-3xl font-bold text-orange-900">{callsMade?.toLocaleString()}</p>}
                </div>
                <PhoneCall className="h-8 w-8 text-orange-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-purple-50/50 border-purple-200">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-600 font-medium">Follow-ups Due</p>
                  {l4 ? <Skeleton className="h-9 w-12 mt-1" /> : <p className="text-3xl font-bold text-purple-900">{followupsDue?.toLocaleString()}</p>}
                </div>
                <CalendarClock className="h-8 w-8 text-purple-500 opacity-60" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Funnel */}
        <Card>
          <CardHeader><CardTitle>Pipeline Funnel</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {pipelineCounts.map((stage) => (
                <div
                  key={stage.name}
                  className="flex-1 min-w-[110px] text-center p-4 rounded-lg border-2 transition-shadow hover:shadow-md"
                  style={{ backgroundColor: stage.color + '15', borderColor: stage.color + '40' }}
                >
                  <p className="text-2xl font-bold" style={{ color: stage.color }}>{stage.count}</p>
                  <p className="text-xs font-medium text-gray-600 capitalize mt-1">{stage.name.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Activity */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <Link to="/calls" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                All calls <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {recentComms && recentComms.length > 0 ? (
                <div className="space-y-3">
                  {recentComms.map((c: any) => (
                    <div key={c.id} className="flex items-start gap-3 text-sm">
                      <div className="mt-0.5">{commTypeIcon(c.communication_type_id)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link to={`/leads/${c.lead_id}`} className="font-medium text-blue-600 hover:underline truncate">{c.lead_name}</Link>
                          {c.outcome && (
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${OUTCOME_COLORS[c.outcome] || 'bg-gray-100 text-gray-700'}`}>
                              {c.outcome.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs truncate">{c.summary || '—'}</p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{c.contact_date || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">No activity yet</p>
              )}
            </CardContent>
          </Card>

          {/* Today's Tasks */}
          <Card>
            <CardHeader><CardTitle>Today's Tasks</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {todayFollowups && todayFollowups.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Follow-ups Due</p>
                  <div className="space-y-2">
                    {todayFollowups.map((l: any) => (
                      <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-sm">
                        <span className="font-medium">{l.owner_name || `Lead #${l.id}`}</span>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${l.viability_score >= 50 ? 'bg-green-100 text-green-800' : l.viability_score >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{l.viability_score ?? '—'}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {neverContacted && neverContacted.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Hot Leads — Never Contacted</p>
                  <div className="space-y-2">
                    {neverContacted.map((l: any) => (
                      <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 text-sm">
                        <span className="font-medium">{l.owner_name || `Lead #${l.id}`}</span>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{l.viability_score}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {(!todayFollowups || todayFollowups.length === 0) && (!neverContacted || neverContacted.length === 0) && (
                <p className="text-muted-foreground text-center py-4">All caught up! 🎉</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link to="/leads?min_score=50" className="block p-4 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-red-500" />
              <p className="font-semibold text-red-900">View Hot Leads</p>
            </div>
            <p className="text-sm text-red-700 mt-1">Score ≥ 50, ready to work</p>
          </Link>
          <Link to="/leads?has_phone=true&min_score=30" className="block p-4 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition">
            <div className="flex items-center gap-2">
              <PhoneMissed className="h-5 w-5 text-blue-500" />
              <p className="font-semibold text-blue-900">Leads Needing Calls</p>
            </div>
            <p className="text-sm text-blue-700 mt-1">Has phone, score ≥ 30</p>
          </Link>
          <Link to="/leads?needs_followup=true" className="block p-4 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-purple-500" />
              <p className="font-semibold text-purple-900">Follow-ups Due</p>
            </div>
            <p className="text-sm text-purple-700 mt-1">Overdue or due today</p>
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
