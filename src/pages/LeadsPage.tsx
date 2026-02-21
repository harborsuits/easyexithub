import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, Phone, PhoneOff, ChevronLeft, ChevronRight, Check, X, ArrowUpDown } from 'lucide-react';

const PAGE_SIZE = 50;

const STAGE_BADGE_COLORS: Record<string, string> = {
  raw_lead: 'bg-slate-100 text-slate-700',
  contacted: 'bg-blue-100 text-blue-700',
  qualified: 'bg-purple-100 text-purple-700',
  offer_made: 'bg-amber-100 text-amber-700',
  under_contract: 'bg-green-100 text-green-700',
  assigned: 'bg-cyan-100 text-cyan-700',
  closed_won: 'bg-emerald-100 text-emerald-800',
  closed_lost: 'bg-red-100 text-red-700',
  dead: 'bg-gray-100 text-gray-600',
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color = score >= 50 ? 'bg-green-100 text-green-800' : score >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{score}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

type SortField = 'viability_score' | 'last_contact_date' | 'next_followup_date';

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [hasPhoneFilter, setHasPhoneFilter] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [needsFollowup, setNeedsFollowup] = useState(false);
  const [sortField, setSortField] = useState<SortField>('viability_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);

  // Read URL params on mount
  useEffect(() => {
    if (searchParams.get('has_phone') === 'true') setHasPhoneFilter(true);
    if (searchParams.get('needs_followup') === 'true') setNeedsFollowup(true);
    const ms = searchParams.get('min_score');
    if (ms) setMinScore(parseInt(ms));
  }, [searchParams]);

  const { data: dealStages } = useQuery({
    queryKey: ['deal-stages'],
    queryFn: async () => {
      const { data } = await supabase.from('deal_stages').select('id, name').order('id');
      return data || [];
    },
  });

  const { data: sources } = useQuery({
    queryKey: ['lead-sources'],
    queryFn: async () => {
      const { data } = await supabase.from('leads').select('lead_source');
      if (!data) return [];
      const unique = [...new Set(data.map((d) => d.lead_source).filter(Boolean))];
      return unique.sort() as string[];
    },
  });

  const today = new Date().toISOString().split('T')[0];

  const { data, isLoading } = useQuery({
    queryKey: ['leads', search, stageFilter, sourceFilter, hasPhoneFilter, minScore, needsFollowup, sortField, sortAsc, page],
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select('id, owner_name, owner_address, owner_phone, viability_score, deal_stage_id, last_contact_date, next_followup_date, outreach_count, lead_source, property_data, dnc_listed', { count: 'exact' })
        .order(sortField, { ascending: sortAsc, nullsFirst: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search) query = query.or(`owner_name.ilike.%${search}%,owner_email.ilike.%${search}%,owner_phone.ilike.%${search}%`);
      if (stageFilter !== 'all') query = query.eq('deal_stage_id', parseInt(stageFilter));
      if (sourceFilter !== 'all') query = query.eq('lead_source', sourceFilter);
      if (hasPhoneFilter) query = query.not('owner_phone', 'is', null).neq('owner_phone', '');
      if (minScore > 0) query = query.gte('viability_score', minScore);
      if (needsFollowup) query = query.lte('next_followup_date', today).not('next_followup_date', 'is', null);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data || [], total: count || 0 };
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE);

  const getStageName = (id: number) => dealStages?.find((s) => s.id === id)?.name || '—';

  const getAddress = (lead: any) => {
    if (lead.property_data?.property_address) return lead.property_data.property_address;
    if (lead.property_data?.address) return lead.property_data.address;
    return lead.owner_address || '—';
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
    setPage(0);
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 font-medium">
      {label}
      <ArrowUpDown className={`h-3 w-3 ${sortField === field ? 'text-blue-600' : 'text-muted-foreground'}`} />
    </button>
  );

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Leads</h1>
          <p className="text-muted-foreground">{data?.total ?? '...'} total leads</p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-medium text-muted-foreground">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Name, email, phone..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-8" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Stage</label>
                <select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(0); }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="all">All Stages</option>
                  {dealStages?.map((s) => <option key={s.id} value={s.id}>{s.name.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Source</label>
                <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="all">All Sources</option>
                  {sources?.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Min Score</label>
                <Input type="number" min={0} max={100} value={minScore || ''} placeholder="0" onChange={(e) => { setMinScore(parseInt(e.target.value) || 0); setPage(0); }} className="w-20" />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant={hasPhoneFilter ? 'default' : 'outline'} onClick={() => { setHasPhoneFilter(!hasPhoneFilter); setPage(0); }} className="gap-1">
                  <Phone className="h-3 w-3" /> Has Phone
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant={needsFollowup ? 'default' : 'outline'} onClick={() => { setNeedsFollowup(!needsFollowup); setPage(0); }} className="gap-1">
                  Needs Follow-up
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Address</th>
                    <th className="text-center px-4 py-3"><SortHeader field="viability_score" label="Score" /></th>
                    <th className="text-left px-4 py-3 font-medium">Stage</th>
                    <th className="text-center px-4 py-3 font-medium">Phone</th>
                    <th className="text-left px-4 py-3"><SortHeader field="last_contact_date" label="Last Contact" /></th>
                    <th className="text-left px-4 py-3"><SortHeader field="next_followup_date" label="Next Follow-up" /></th>
                    <th className="text-center px-4 py-3 font-medium">#Out</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                        ))}
                      </tr>
                    ))
                  ) : data?.rows.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No leads match your filters.</td></tr>
                  ) : (
                    data?.rows.map((lead: any) => {
                      const stageName = getStageName(lead.deal_stage_id);
                      const stageColor = STAGE_BADGE_COLORS[stageName] || 'bg-slate-100 text-slate-700';
                      const isOverdue = lead.next_followup_date && new Date(lead.next_followup_date) <= new Date();
                      return (
                        <tr key={lead.id} className="border-b hover:bg-muted/30 transition cursor-pointer" onClick={() => window.location.href = `/leads/${lead.id}`}>
                          <td className="px-4 py-3">
                            <Link to={`/leads/${lead.id}`} className="font-medium text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                              {lead.owner_name || '—'}
                            </Link>
                            {lead.dnc_listed && <Badge variant="destructive" className="ml-2 text-[10px]">DNC</Badge>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">{getAddress(lead)}</td>
                          <td className="px-4 py-3 text-center"><ScoreBadge score={lead.viability_score} /></td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${stageColor}`}>
                              {stageName.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {lead.owner_phone ? <Check className="h-4 w-4 text-green-500 mx-auto" /> : <X className="h-4 w-4 text-gray-300 mx-auto" />}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{lead.last_contact_date ? new Date(lead.last_contact_date).toLocaleDateString() : '—'}</td>
                          <td className={`px-4 py-3 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            {lead.next_followup_date ? new Date(lead.next_followup_date).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-center text-xs">{lead.outreach_count ?? 0}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages} · {data?.total.toLocaleString()} leads
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
