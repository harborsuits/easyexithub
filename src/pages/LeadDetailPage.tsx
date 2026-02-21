import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Phone, Mail, User, Building2, MessageSquare, Star,
  Brain, Search, PhoneCall, Clock, FileText, ChevronDown, ChevronUp,
  CalendarClock,
} from 'lucide-react';

const OUTCOME_COLORS: Record<string, string> = {
  interested: 'bg-green-100 text-green-800',
  callback: 'bg-blue-100 text-blue-800',
  not_interested: 'bg-red-100 text-red-800',
  no_answer: 'bg-slate-100 text-slate-700',
  voicemail: 'bg-amber-100 text-amber-800',
  note: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-indigo-100 text-indigo-800',
};

const DISTRESS_COLORS: Record<string, string> = {
  tax_delinquent: 'bg-red-100 text-red-700 border-red-200',
  vacant: 'bg-orange-100 text-orange-700 border-orange-200',
  code_violations: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  pre_foreclosure: 'bg-rose-100 text-rose-700 border-rose-200',
  probate: 'bg-purple-100 text-purple-700 border-purple-200',
  high_equity: 'bg-green-100 text-green-700 border-green-200',
  absentee_owner: 'bg-blue-100 text-blue-700 border-blue-200',
  tired_landlord: 'bg-amber-100 text-amber-700 border-amber-200',
};

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-4 w-4 ${i <= count ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
      ))}
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const leadId = parseInt(id || '0');
  const [newNote, setNewNote] = useState('');
  const [editFollowup, setEditFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState('');
  const [expandedComm, setExpandedComm] = useState<number | null>(null);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: stages } = useQuery({
    queryKey: ['deal-stages'],
    queryFn: async () => {
      const { data } = await supabase.from('deal_stages').select('id, name').order('id');
      return data || [];
    },
  });

  const { data: markets } = useQuery({
    queryKey: ['markets'],
    queryFn: async () => {
      const { data } = await supabase.from('markets').select('id, name');
      return data || [];
    },
  });

  const { data: communications } = useQuery({
    queryKey: ['lead-communications', leadId],
    queryFn: async () => {
      const { data } = await supabase
        .from('communications')
        .select('*')
        .eq('lead_id', leadId)
        .order('contact_date', { ascending: false, nullsFirst: false });
      return data || [];
    },
    enabled: !!leadId,
  });

  const { data: commTypes } = useQuery({
    queryKey: ['communication-types'],
    queryFn: async () => {
      const { data } = await supabase.from('communication_types').select('id, name');
      return data || [];
    },
  });

  const updateStage = useMutation({
    mutationFn: async (stageId: number) => {
      const { error } = await supabase.from('leads').update({ deal_stage_id: stageId }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead', leadId] }),
  });

  const updateFollowup = useMutation({
    mutationFn: async (date: string) => {
      const { error } = await supabase.from('leads').update({ next_followup_date: date || null }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditFollowup(false);
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
    },
  });

  const addCommunication = useMutation({
    mutationFn: async (note: string) => {
      const today = new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('communications').insert({
        lead_id: leadId,
        communication_type_id: 3,
        contact_date: today,
        contacted_party: 'Atlas (system)',
        summary: note,
        outcome: 'note',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewNote('');
      queryClient.invalidateQueries({ queryKey: ['lead-communications', leadId] });
    },
  });

  const getStageName = (stageId: number) => stages?.find((s) => s.id === stageId)?.name || '—';
  const getMarketName = (mId: number) => markets?.find((m) => m.id === mId)?.name || '—';
  const getCommTypeName = (typeId: number) => commTypes?.find((t) => t.id === typeId)?.name || 'Note';

  const commTypeIcon = (typeId: number) => {
    if (typeId === 1) return <PhoneCall className="h-4 w-4 text-blue-500" />;
    if (typeId === 2) return <Mail className="h-4 w-4 text-green-500" />;
    return <FileText className="h-4 w-4 text-gray-500" />;
  };

  // Parse property_data
  const pd = lead?.property_data as Record<string, any> | null;
  const propFields = pd ? {
    address: pd.property_address || pd.address || pd.street_address,
    city: pd.property_city || pd.city || pd.town,
    beds: pd.bedrooms || pd.beds || pd.bed_count,
    baths: pd.bathrooms || pd.baths || pd.bath_count,
    sqft: pd.square_feet || pd.sqft || pd.living_area || pd.total_sqft,
    year: pd.year_built || pd.year,
    value: pd.assessed_value || pd.total_value || pd.market_value || pd.value,
    condition: pd.condition || pd.property_condition,
    lot_size: pd.lot_size || pd.lot_acres || pd.acreage,
    type: pd.property_type || pd.type,
  } : null;

  // Parse skip_trace_data
  const st = lead?.skip_trace_data as Record<string, any> | null;
  const skipPhones = st?.phones || st?.phone_numbers || (st?.phone ? [{ number: st.phone }] : []);
  const skipEmails = st?.emails || st?.email_addresses || (st?.email ? [{ address: st.email }] : []);
  const skipDate = st?.traced_date || st?.date || st?.created_at;
  const skipSource = st?.source || st?.provider;

  // Parse comm notes
  const parseCommNotes = (notes: any) => {
    if (!notes) return null;
    if (typeof notes === 'string') {
      try { return JSON.parse(notes); } catch { return { text: notes }; }
    }
    return notes;
  };

  if (isLoading) {
    return <AppLayout><div className="flex items-center justify-center h-96 text-muted-foreground">Loading...</div></AppLayout>;
  }
  if (!lead) {
    return <AppLayout><div className="text-center py-12">Lead not found</div></AppLayout>;
  }

  const distressSignals: string[] = Array.isArray(lead.distress_signals)
    ? lead.distress_signals
    : (lead.distress_signals && typeof lead.distress_signals === 'object')
      ? Object.keys(lead.distress_signals).filter((k) => (lead.distress_signals as any)[k])
      : [];

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/leads')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{lead.owner_name || `Lead #${lead.id}`}</h1>
            <p className="text-muted-foreground">{getMarketName(lead.market_id)} · {getStageName(lead.deal_stage_id)}</p>
          </div>
          {lead.dnc_listed && <Badge variant="destructive">DNC</Badge>}
          {lead.opt_out && <Badge variant="outline" className="border-red-300 text-red-600">Opted Out</Badge>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Owner Info */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-4 w-4" /> Owner Information</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{lead.owner_name || '—'}</span></div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>{' '}
                    {lead.owner_phone ? <a href={`tel:${lead.owner_phone}`} className="text-blue-600 font-medium hover:underline">{lead.owner_phone}</a> : '—'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>{' '}
                    {lead.owner_email ? <a href={`mailto:${lead.owner_email}`} className="text-blue-600 font-medium hover:underline">{lead.owner_email}</a> : '—'}
                  </div>
                  <div><span className="text-muted-foreground">Address:</span> {lead.owner_address || '—'}</div>
                  <div><span className="text-muted-foreground">Source:</span> {lead.lead_source || '—'}</div>
                  <div><span className="text-muted-foreground">Outreach Count:</span> {lead.outreach_count ?? 0}</div>
                </div>
                <div className="flex gap-2 mt-4">
                  {lead.owner_phone && (
                    <a href={`tel:${lead.owner_phone}`}>
                      <Button size="sm" variant="outline" className="gap-1"><Phone className="h-3 w-3" /> Call</Button>
                    </a>
                  )}
                  {lead.owner_email && (
                    <a href={`mailto:${lead.owner_email}`}>
                      <Button size="sm" variant="outline" className="gap-1"><Mail className="h-3 w-3" /> Email</Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Property Details */}
            {propFields && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Property Details</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                    {propFields.address && <div><span className="text-muted-foreground">Address:</span> <span className="font-medium">{propFields.address}</span></div>}
                    {propFields.city && <div><span className="text-muted-foreground">City:</span> <span className="font-medium">{propFields.city}</span></div>}
                    {propFields.beds && <div><span className="text-muted-foreground">Beds:</span> <span className="font-medium">{propFields.beds}</span></div>}
                    {propFields.baths && <div><span className="text-muted-foreground">Baths:</span> <span className="font-medium">{propFields.baths}</span></div>}
                    {propFields.sqft && <div><span className="text-muted-foreground">Sqft:</span> <span className="font-medium">{Number(propFields.sqft).toLocaleString()}</span></div>}
                    {propFields.year && <div><span className="text-muted-foreground">Year Built:</span> <span className="font-medium">{propFields.year}</span></div>}
                    {propFields.value && <div><span className="text-muted-foreground">Value:</span> <span className="font-medium">${Number(propFields.value).toLocaleString()}</span></div>}
                    {propFields.condition && <div><span className="text-muted-foreground">Condition:</span> <span className="font-medium">{propFields.condition}</span></div>}
                    {propFields.lot_size && <div><span className="text-muted-foreground">Lot:</span> <span className="font-medium">{propFields.lot_size}</span></div>}
                    {propFields.type && <div><span className="text-muted-foreground">Type:</span> <span className="font-medium">{propFields.type}</span></div>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Score & Distress */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="h-4 w-4" /> Score & Distress Signals</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-center">
                    <div className={`text-4xl font-bold ${(lead.viability_score ?? 0) >= 50 ? 'text-green-600' : (lead.viability_score ?? 0) >= 30 ? 'text-amber-600' : 'text-slate-500'}`}>
                      {lead.viability_score ?? '—'}
                    </div>
                    <p className="text-xs text-muted-foreground">Viability Score</p>
                  </div>
                  {lead.estimated_arv && (
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">${Number(lead.estimated_arv).toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">Est. ARV</p>
                    </div>
                  )}
                  {lead.estimated_equity && (
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">${Number(lead.estimated_equity).toLocaleString()}</div>
                      <p className="text-xs text-muted-foreground">Est. Equity</p>
                    </div>
                  )}
                </div>
                {distressSignals.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {distressSignals.map((signal: string) => (
                      <span key={signal} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${DISTRESS_COLORS[signal] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                        {signal.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No distress signals</p>
                )}
              </CardContent>
            </Card>

            {/* Motivation */}
            {(lead.motivation_type || lead.motivation_notes || lead.urgency_level) && (
              <Card>
                <CardHeader><CardTitle>Motivation</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {lead.motivation_type && (
                    <div className="text-sm"><span className="text-muted-foreground">Type:</span> <Badge variant="outline">{lead.motivation_type}</Badge></div>
                  )}
                  {lead.urgency_level != null && (
                    <div className="text-sm flex items-center gap-2">
                      <span className="text-muted-foreground">Urgency:</span>
                      <Stars count={lead.urgency_level} />
                    </div>
                  )}
                  {lead.motivation_notes && (
                    <div className="text-sm"><span className="text-muted-foreground">Notes:</span> <p className="mt-1">{lead.motivation_notes}</p></div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Skip Trace */}
            {st && Object.keys(st).length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Search className="h-4 w-4" /> Skip Trace Data</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {skipPhones.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Phones</p>
                      <div className="flex flex-wrap gap-2">
                        {skipPhones.map((p: any, i: number) => {
                          const num = typeof p === 'string' ? p : p.number || p.phone;
                          return num ? (
                            <a key={i} href={`tel:${num}`} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-sm hover:bg-blue-100">
                              <Phone className="h-3 w-3" /> {num} {p.type && <span className="text-[10px] text-muted-foreground">({p.type})</span>}
                            </a>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                  {skipEmails.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Emails</p>
                      <div className="flex flex-wrap gap-2">
                        {skipEmails.map((e: any, i: number) => {
                          const addr = typeof e === 'string' ? e : e.address || e.email;
                          return addr ? (
                            <a key={i} href={`mailto:${addr}`} className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-sm hover:bg-green-100">
                              <Mail className="h-3 w-3" /> {addr}
                            </a>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {skipDate && <span>Traced: {new Date(skipDate).toLocaleDateString()}</span>}
                    {skipSource && <span>Source: {skipSource}</span>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Communication Timeline */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Communication History</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input placeholder="Add a note..." value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newNote) addCommunication.mutate(newNote); }} />
                  <Button onClick={() => newNote && addCommunication.mutate(newNote)} disabled={!newNote || addCommunication.isPending}>Add</Button>
                </div>
                {communications && communications.length > 0 ? (
                  <div className="space-y-3">
                    {communications.map((comm: any) => {
                      const notes = parseCommNotes(comm.notes);
                      const hasTranscript = notes?.transcript;
                      const isExpanded = expandedComm === comm.id;
                      return (
                        <div key={comm.id} className="border rounded-lg p-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5">{commTypeIcon(comm.communication_type_id)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">{getCommTypeName(comm.communication_type_id)}</span>
                                {comm.outcome && (
                                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${OUTCOME_COLORS[comm.outcome] || 'bg-gray-100 text-gray-700'}`}>
                                    {comm.outcome.replace(/_/g, ' ')}
                                  </span>
                                )}
                                {comm.duration_minutes && (
                                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="h-3 w-3" /> {comm.duration_minutes}m</span>
                                )}
                                {notes?.cost != null && (
                                  <span className="text-[10px] text-muted-foreground">${Number(notes.cost).toFixed(2)}</span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{comm.summary || '—'}</p>
                              {comm.contacted_party && (
                                <p className="text-xs text-muted-foreground mt-0.5">by {comm.contacted_party}</p>
                              )}
                              {comm.response_received && comm.response_summary && (
                                <p className="text-xs mt-1"><span className="text-muted-foreground">Response:</span> {comm.response_summary}</p>
                              )}
                              {hasTranscript && (
                                <button
                                  onClick={() => setExpandedComm(isExpanded ? null : comm.id)}
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                                >
                                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  {isExpanded ? 'Hide transcript' : 'Show transcript'}
                                </button>
                              )}
                              {isExpanded && hasTranscript && (
                                <div className="mt-2 bg-muted rounded p-3 text-xs max-h-64 overflow-auto whitespace-pre-wrap">
                                  {typeof notes.transcript === 'string' ? notes.transcript : JSON.stringify(notes.transcript, null, 2)}
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {comm.contact_date || (comm.created_at ? new Date(comm.created_at).toLocaleDateString() : '—')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No communications yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Follow-up Date */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Next Follow-up</CardTitle></CardHeader>
              <CardContent>
                {editFollowup ? (
                  <div className="flex gap-2">
                    <Input type="date" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} />
                    <Button size="sm" onClick={() => updateFollowup.mutate(followupDate)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditFollowup(false)}>✕</Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${lead.next_followup_date && new Date(lead.next_followup_date) <= new Date() ? 'text-red-600' : ''}`}>
                      {lead.next_followup_date ? new Date(lead.next_followup_date).toLocaleDateString() : 'Not set'}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => { setFollowupDate(lead.next_followup_date || ''); setEditFollowup(true); }}>Edit</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Deal Stage */}
            <Card>
              <CardHeader><CardTitle>Deal Stage</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {stages?.map((stage) => (
                  <button
                    key={stage.id}
                    onClick={() => updateStage.mutate(stage.id)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                      lead.deal_stage_id === stage.id
                        ? 'bg-blue-100 text-blue-800 font-semibold border border-blue-300'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {stage.name.replace(/_/g, ' ')}
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card>
              <CardHeader><CardTitle>Quick Stats</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Viability Score</span><span className="font-bold">{lead.viability_score ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline">{lead.status || '—'}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Contact</span><span>{lead.last_contact_date ? new Date(lead.last_contact_date).toLocaleDateString() : '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Outreach</span><span>{lead.last_outreach_type || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Consent</span><span>{lead.consent_given ? '✓ Yes' : '✗ No'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Opt Out</span><span>{lead.opt_out ? '✓ Yes' : '✗ No'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '—'}</span></div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {lead.owner_phone && (
                  <a href={`tel:${lead.owner_phone}`}>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <Phone className="h-4 w-4" /> Call Owner
                    </Button>
                  </a>
                )}
                {lead.owner_email && (
                  <a href={`mailto:${lead.owner_email}`}>
                    <Button variant="outline" className="w-full justify-start gap-2 mt-2">
                      <Mail className="h-4 w-4" /> Email Owner
                    </Button>
                  </a>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
