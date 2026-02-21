import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

const PAGE_SIZE = 50;

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color = score >= 50 ? 'bg-green-100 text-green-800' : score >= 30 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{score}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

export default function PropertiesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<'lead_score' | 'assessed_value' | 'city'>('lead_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [filters, setFilters] = useState({ city: '', minValue: '', maxValue: '', minScore: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['properties', page, sortBy, sortAsc, search, filters],
    queryFn: async () => {
      let query = supabase
        .from('properties')
        .select('*, property_sources(raw_data)', { count: 'exact' })
        .order(sortBy, { ascending: sortAsc, nullsFirst: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search) {
        query = query.or(`address.ilike.%${search}%,city.ilike.%${search}%`);
      }
      if (filters.city) query = query.ilike('city', `%${filters.city}%`);
      if (filters.minValue) query = query.gte('assessed_value', parseInt(filters.minValue));
      if (filters.maxValue) query = query.lte('assessed_value', parseInt(filters.maxValue));
      if (filters.minScore) query = query.gte('lead_score', parseInt(filters.minScore));

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data || [], total: count || 0 };
    },
  });

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(false); }
    setPage(0);
  };

  const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE);

  const SortIcon = ({ col }: { col: typeof sortBy }) => {
    if (sortBy !== col) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />;
  };

  const getRawData = (p: any) => {
    if (!p.property_sources) return null;
    // property_sources is an array from the join
    const sources = Array.isArray(p.property_sources) ? p.property_sources : [p.property_sources];
    return sources[0]?.raw_data || null;
  };

  const handleRowClick = (p: any) => {
    if (p.lead_id) {
      navigate(`/leads/${p.lead_id}`);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Properties</h1>
            <p className="text-muted-foreground">{data?.total.toLocaleString() ?? '...'} total properties</p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-medium text-muted-foreground">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Address or city..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="w-32">
                <label className="text-xs font-medium text-muted-foreground">City</label>
                <Input placeholder="City" value={filters.city} onChange={(e) => { setFilters({...filters, city: e.target.value}); setPage(0); }} />
              </div>
              <div className="w-28">
                <label className="text-xs font-medium text-muted-foreground">Min Value</label>
                <Input type="number" placeholder="$0" value={filters.minValue} onChange={(e) => { setFilters({...filters, minValue: e.target.value}); setPage(0); }} />
              </div>
              <div className="w-28">
                <label className="text-xs font-medium text-muted-foreground">Max Value</label>
                <Input type="number" placeholder="Any" value={filters.maxValue} onChange={(e) => { setFilters({...filters, maxValue: e.target.value}); setPage(0); }} />
              </div>
              <div className="w-24">
                <label className="text-xs font-medium text-muted-foreground">Min Score</label>
                <Input type="number" placeholder="0" value={filters.minScore} onChange={(e) => { setFilters({...filters, minScore: e.target.value}); setPage(0); }} />
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
                    <th className="text-left px-4 py-3 font-medium">Address</th>
                    <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('city')}>
                      City <SortIcon col="city" />
                    </th>
                    <th className="text-left px-4 py-3 font-medium">Owner</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('assessed_value')}>
                      Assessed Value <SortIcon col="assessed_value" />
                    </th>
                    <th className="text-left px-4 py-3 font-medium">Use Type</th>
                    <th className="text-left px-4 py-3 font-medium">Sale Date</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('lead_score')}>
                      Score <SortIcon col="lead_score" />
                    </th>
                    <th className="text-center px-4 py-3 font-medium">Lead</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-10 ml-auto" /></td>
                        <td className="px-4 py-3"><Skeleton className="h-4 w-10 mx-auto" /></td>
                      </tr>
                    ))
                  ) : data?.rows.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No properties match your filters. Try broadening your search.</td></tr>
                  ) : (
                    data?.rows.map((p: any) => {
                      const raw = getRawData(p);
                      return (
                        <tr
                          key={p.id}
                          className={`border-b hover:bg-muted/30 transition ${p.lead_id ? 'cursor-pointer' : ''}`}
                          onClick={() => handleRowClick(p)}
                        >
                          <td className="px-4 py-3 font-medium">{p.address || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">{p.city || '—'}</td>
                          <td className="px-4 py-3 text-sm">{raw?.owner || '—'}</td>
                          <td className="px-4 py-3 text-right">{p.assessed_value ? `$${p.assessed_value.toLocaleString()}` : '—'}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{raw?.use_description || p.property_type || '—'}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{raw?.sale_date || '—'}</td>
                          <td className="px-4 py-3 text-right"><ScoreBadge score={p.lead_score} /></td>
                          <td className="px-4 py-3 text-center">
                            {p.lead_id ? (
                              <Badge variant="default" className="text-[10px]">
                                <ExternalLink className="h-3 w-3 mr-1" />Lead
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
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
              Page {page + 1} of {totalPages} · Showing {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, data?.total || 0).toLocaleString()} of {data?.total.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
