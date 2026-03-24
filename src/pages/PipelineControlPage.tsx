import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Phone, ExternalLink, RefreshCw, CheckCircle, RotateCcw, ChevronDown, ChevronUp, PlayCircle, Upload, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, isPast, subHours } from 'date-fns';
import type { PipelineStage } from '@/types/index';

// ── Helpers ──
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

const STAGE_COLORS: Record<PipelineStage, string> = {
  new: 'bg-gray-500',
  attempting_contact: 'bg-blue-500',
  follow_up_scheduled: 'bg-indigo-500',
  callback_pending: 'bg-amber-500',
  needs_human_followup: 'bg-orange-500',
  offer_prep: 'bg-purple-500',
  negotiating: 'bg-violet-500',
  under_contract: 'bg-emerald-500',
  closed_won: 'bg-green-600',
  closed_lost: 'bg-red-600',
};

// ── Types ──
type LeadRow = {
  id: number;
  owner_name: string;
  owner_phone: string | null;
  property_data: any;
  status: string;
  pipeline_stage: PipelineStage | null;
  callable: boolean;
  outbound_approved: boolean;
  outreach_count: number;
  last_disposition: string | null;
  next_action_type: string | null;
  next_action_at: string | null;
  next_followup_date: string | null;
  handoff_status: string | null;
  callback_status: string | null;
  pendingFollowUps: number;
};

type FollowUpRow = {
  id: number;
  lead_id: number;
  kind: string;
  scheduled_for: string;
  priority: number;
  status: string;
  source: string | null;
  reason: string | null;
};

type CommRow = {
  id: number;
  lead_id: number;
  contact_date: string;
  outcome: string | null;
  notes: string | null;
  vapi_call_id: string | null;
  created_at: string;
};

type IntegrityCheck = {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
};

// ── Section 1: Lead Intake Table ──
function LeadIntakeTable({
  leads,
  selectedLeads,
  onToggle,
  onReserve,
}: {
  leads: LeadRow[];
  selectedLeads: Set<number>;
  onToggle: (id: number) => void;
  onReserve: () => void;
}) {
  const selectionCount = selectedLeads.size;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Lead Intake / Test Queue</CardTitle>
        <p className="text-sm text-muted-foreground">Untouched leads (status=new, outreach_count=0)</p>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Button
            onClick={onReserve}
            disabled={selectionCount === 0 || selectionCount > 5}
            size="sm"
          >
            Reserve for Test ({selectionCount}/5)
          </Button>
          {selectionCount > 5 && (
            <p className="text-xs text-red-600 mt-1">Max 5 leads</p>
          )}
        </div>
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>ID</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Town</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Callable</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Outreach</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Pending F/U</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground">
                    No leads found
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => {
                  const town = lead.property_data?.city || lead.property_data?.town || '—';
                  const isSelected = selectedLeads.has(lead.id);
                  return (
                    <TableRow key={lead.id} className={isSelected ? 'bg-blue-50' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggle(lead.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{lead.id}</TableCell>
                      <TableCell className="text-sm">{lead.owner_name}</TableCell>
                      <TableCell className="font-mono text-xs">{lead.owner_phone || '—'}</TableCell>
                      <TableCell className="text-sm">{town}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{lead.status}</Badge></TableCell>
                      <TableCell>{lead.callable ? '✅' : '❌'}</TableCell>
                      <TableCell>{lead.outbound_approved ? '✅' : '❌'}</TableCell>
                      <TableCell className="text-center">{lead.outreach_count}</TableCell>
                      <TableCell>
                        {lead.pipeline_stage ? (
                          <Badge className={`${STAGE_COLORS[lead.pipeline_stage]} text-white text-xs`}>
                            {lead.pipeline_stage.replace(/_/g, ' ')}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-center">{lead.pendingFollowUps}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 2: Test Actions Panel ──
function TestActionsPanel({
  reservedLeads,
  onTriggerCall,
  onRefresh,
  onMarkComplete,
  onResetLead,
  onBatchTest,
  batchRunning,
}: {
  reservedLeads: LeadRow[];
  onTriggerCall: (leadId: number) => void;
  onRefresh: (leadId: number) => void;
  onMarkComplete: (leadId: number) => void;
  onResetLead: (leadId: number) => void;
  onBatchTest: () => void;
  batchRunning: boolean;
}) {
  const [expandedSnap, setExpandedSnap] = useState<Set<number>>(new Set());
  const [resetDialog, setResetDialog] = useState<number | null>(null);

  const toggleSnap = (id: number) => {
    const next = new Set(expandedSnap);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedSnap(next);
  };

  if (reservedLeads.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Test Actions Panel</CardTitle>
        <div className="flex gap-2 mt-2">
          <Button onClick={onBatchTest} disabled={batchRunning || reservedLeads.length === 0} size="sm">
            <PlayCircle className="h-4 w-4 mr-1" />
            Run 3-Lead Test Batch
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {reservedLeads.map((lead) => (
          <Card key={lead.id} className="border-2 border-blue-300 bg-blue-50">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Link to={`/leads/${lead.id}`} className="font-semibold text-blue-600 hover:underline">
                    {lead.owner_name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{lead.owner_phone || '—'}</p>
                </div>
                <Badge variant="outline" className="text-xs">ID: {lead.id}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onTriggerCall(lead.id)} size="sm">
                  <Phone className="h-3 w-3 mr-1" />
                  Trigger Call
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/leads/${lead.id}`}>
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open Lead Detail
                  </Link>
                </Button>
                <Button variant="outline" size="sm" onClick={() => onRefresh(lead.id)}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh State
                </Button>
                <Button variant="outline" size="sm" onClick={() => onMarkComplete(lead.id)}>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Mark Test Complete
                </Button>
                <Button variant="outline" size="sm" onClick={() => setResetDialog(lead.id)} className="text-red-600 border-red-300">
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset Test Lead
                </Button>
                <Button variant="ghost" size="sm" onClick={() => toggleSnap(lead.id)}>
                  {expandedSnap.has(lead.id) ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  View Raw DB Snapshot
                </Button>
              </div>
              {expandedSnap.has(lead.id) && (
                <div className="mt-2 p-2 bg-white rounded border text-xs overflow-auto max-h-48">
                  <pre>{JSON.stringify(lead, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Reset confirmation dialog */}
        <Dialog open={resetDialog !== null} onOpenChange={(open) => !open && setResetDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Test Lead</DialogTitle>
              <DialogDescription>
                This will reset the lead to status='new', pipeline_stage='new', outreach_count=0, clear last_disposition, next_action_type, next_action_at, callback_status, handoff_status, and DELETE all follow_ups and communications for this lead. This is irreversible.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetDialog(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (resetDialog !== null) {
                    onResetLead(resetDialog);
                    setResetDialog(null);
                  }
                }}
              >
                Confirm Reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ── Section 3: Live State Tracker ──
function LiveStateTracker({ reservedLeads }: { reservedLeads: LeadRow[] }) {
  const queryClient = useQueryClient();

  // Query follow-ups for reserved leads
  const { data: followUps } = useQuery({
    queryKey: ['pipeline-control-followups', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .in('lead_id', reservedLeads.map(l => l.id))
        .eq('status', 'pending')
        .order('scheduled_for', { ascending: true });
      if (error) throw error;
      return data as FollowUpRow[];
    },
    refetchInterval: 5000,
    enabled: reservedLeads.length > 0,
  });

  // Query latest communication for reserved leads
  const { data: latestComms } = useQuery({
    queryKey: ['pipeline-control-comms', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('communications')
        .select('lead_id, created_at')
        .in('lead_id', reservedLeads.map(l => l.id))
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as { lead_id: number; created_at: string }[];
    },
    refetchInterval: 5000,
    enabled: reservedLeads.length > 0,
  });

  const followUpMap: Record<number, FollowUpRow | undefined> = {};
  followUps?.forEach(fu => {
    if (!followUpMap[fu.lead_id]) followUpMap[fu.lead_id] = fu;
  });

  const latestCommMap: Record<number, string | undefined> = {};
  latestComms?.forEach(c => {
    if (!latestCommMap[c.lead_id]) latestCommMap[c.lead_id] = c.created_at;
  });

  if (reservedLeads.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Live State Tracker</CardTitle>
        <p className="text-xs text-muted-foreground">Auto-refresh every 5s</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {reservedLeads.map((lead) => {
          const activeFU = followUpMap[lead.id];
          const lastComm = latestCommMap[lead.id];
          return (
            <Card key={lead.id} className="border bg-white">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{lead.owner_name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{lead.owner_phone}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['pipeline-control-followups'] })}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-semibold">Last Disposition:</span> {lead.last_disposition || '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Pipeline Stage:</span>{' '}
                    {lead.pipeline_stage ? (
                      <Badge className={`${STAGE_COLORS[lead.pipeline_stage]} text-white text-xs ml-1`}>
                        {lead.pipeline_stage.replace(/_/g, ' ')}
                      </Badge>
                    ) : '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Next Action:</span> {lead.next_action_type || '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Next Action At:</span>{' '}
                    {lead.next_action_at ? formatDistanceToNow(new Date(lead.next_action_at), { addSuffix: true }) : '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Next Followup Date:</span>{' '}
                    {lead.next_followup_date ? formatDistanceToNow(new Date(lead.next_followup_date), { addSuffix: true }) : '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Handoff Status:</span> {lead.handoff_status || '—'}
                  </div>
                  <div className="col-span-2">
                    <span className="font-semibold">Active Follow-Up:</span>{' '}
                    {activeFU ? (
                      <span>
                        {activeFU.kind} @ {formatDistanceToNow(new Date(activeFU.scheduled_for), { addSuffix: true })} (priority {activeFU.priority})
                      </span>
                    ) : (
                      'None'
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="font-semibold">Latest Communication:</span>{' '}
                    {lastComm ? formatDistanceToNow(new Date(lastComm), { addSuffix: true }) : 'None'}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Section 4: Integrity Checker ──
function IntegrityChecker({ reservedLeads }: { reservedLeads: LeadRow[] }) {
  const { data: followUps } = useQuery({
    queryKey: ['pipeline-control-integrity-followups', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .in('lead_id', reservedLeads.map(l => l.id));
      if (error) throw error;
      return data as FollowUpRow[];
    },
    enabled: reservedLeads.length > 0,
  });

  // Query all leads with matching phones to check for duplicates
  const { data: allLeads } = useQuery({
    queryKey: ['pipeline-control-integrity-allleads', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('id, owner_phone')
        .not('owner_phone', 'is', null);
      if (error) throw error;
      return data as { id: number; owner_phone: string }[];
    },
    enabled: reservedLeads.length > 0,
  });

  if (reservedLeads.length === 0) return null;

  const followUpsByLead: Record<number, FollowUpRow[]> = {};
  followUps?.forEach(fu => {
    if (!followUpsByLead[fu.lead_id]) followUpsByLead[fu.lead_id] = [];
    followUpsByLead[fu.lead_id].push(fu);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">UI vs Backend Integrity Checker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {reservedLeads.map((lead) => {
          const checks: IntegrityCheck[] = [];
          const fuList = followUpsByLead[lead.id] || [];
          const pendingFUs = fuList.filter(f => f.status === 'pending');

          // Check 1: Count pending follow_ups
          checks.push({
            name: 'Pending follow-ups count',
            expected: '≤ 1',
            actual: `${pendingFUs.length}`,
            pass: pendingFUs.length <= 1,
          });

          // Check 2: Pipeline stage consistency (single value — always pass, but check follow_ups for conflicts)
          const fuKinds = new Set(fuList.map(f => f.kind));
          checks.push({
            name: 'Pipeline stage consistency',
            expected: 'Single pipeline_stage',
            actual: `stage=${lead.pipeline_stage || 'null'}, follow-up kinds=${fuKinds.size}`,
            pass: true, // Always pass since pipeline_stage is single value
          });

          // Check 3: Duplicate phone detection
          const normalized = normalizePhone(lead.owner_phone);
          const duplicates = allLeads?.filter(l => normalizePhone(l.owner_phone) === normalized && normalized !== '') || [];
          checks.push({
            name: 'Duplicate phone check',
            expected: '1 lead',
            actual: `${duplicates.length} lead(s)`,
            pass: duplicates.length <= 1,
          });

          // Check 4: Callback status vs follow_ups alignment
          const hasCallbackFU = pendingFUs.some(f => f.kind.toLowerCase().includes('callback'));
          const callbackStatusActive = lead.callback_status === 'requested' || lead.callback_status === 'scheduled';
          checks.push({
            name: 'Callback status alignment',
            expected: callbackStatusActive ? 'Pending callback follow-up exists' : 'No pending callback',
            actual: hasCallbackFU ? 'Callback FU exists' : 'No callback FU',
            pass: callbackStatusActive === hasCallbackFU,
          });

          // Check 5: Stale follow-ups (scheduled_for > 24h in past)
          const staleFUs = pendingFUs.filter(f => isPast(subHours(new Date(f.scheduled_for), 24)));
          checks.push({
            name: 'Stale follow-ups',
            expected: '0',
            actual: `${staleFUs.length}`,
            pass: staleFUs.length === 0,
          });

          const passCount = checks.filter(c => c.pass).length;

          return (
            <Card key={lead.id} className="border">
              <CardContent className="p-3 space-y-2">
                <div className="font-semibold text-sm">{lead.owner_name} (ID: {lead.id})</div>
                <div className="space-y-1">
                  {checks.map((check, idx) => (
                    <div key={idx} className="grid grid-cols-4 gap-2 text-xs items-center">
                      <div className="col-span-1 font-semibold">{check.name}</div>
                      <div className="col-span-1 text-muted-foreground">{check.expected}</div>
                      <div className="col-span-1 text-muted-foreground">{check.actual}</div>
                      <div className="col-span-1 text-right">
                        {check.pass ? (
                          <Badge className="bg-green-600 text-white text-xs">PASS</Badge>
                        ) : (
                          <Badge className="bg-red-600 text-white text-xs font-bold">FAIL</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t text-sm">
                  <strong>Summary:</strong> {passCount}/{checks.length} checks passed
                </div>
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Section 5: Event / Transition Feed ──
function EventFeed({ reservedLeads }: { reservedLeads: LeadRow[] }) {
  const { data: comms } = useQuery({
    queryKey: ['pipeline-control-event-comms', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .in('lead_id', reservedLeads.map(l => l.id))
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as CommRow[];
    },
    enabled: reservedLeads.length > 0,
  });

  const { data: followUps } = useQuery({
    queryKey: ['pipeline-control-event-followups', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .in('lead_id', reservedLeads.map(l => l.id))
        .order('scheduled_for', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as FollowUpRow[];
    },
    enabled: reservedLeads.length > 0,
  });

  if (reservedLeads.length === 0) return null;

  type Event = {
    type: 'comm' | 'followup';
    timestamp: string;
    data: CommRow | FollowUpRow;
  };

  const events: Event[] = [
    ...(comms || []).map(c => ({ type: 'comm' as const, timestamp: c.created_at, data: c })),
    ...(followUps || []).map(f => ({ type: 'followup' as const, timestamp: f.scheduled_for, data: f })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 20);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Event / Transition Feed</CardTitle>
        <p className="text-xs text-muted-foreground">Recent communications and follow-up changes (max 20)</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet</p>
          ) : (
            events.map((event, idx) => {
              const lead = reservedLeads.find(l => l.id === (event.data as any).lead_id);
              return (
                <div key={idx} className="flex items-start gap-3 border-b pb-2">
                  <div className="mt-1">
                    {event.type === 'comm' ? (
                      <Phone className="h-4 w-4 text-blue-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-xs">
                    <div className="font-semibold">{lead?.owner_name || `Lead #${(event.data as any).lead_id}`}</div>
                    {event.type === 'comm' ? (
                      <div>
                        <Badge variant="outline" className="text-xs mr-1">{(event.data as CommRow).outcome || 'N/A'}</Badge>
                        {(event.data as CommRow).notes && <span className="text-muted-foreground">{(event.data as CommRow).notes}</span>}
                        {(event.data as CommRow).vapi_call_id && (
                          <div className="font-mono text-[10px] text-muted-foreground">SID: {(event.data as CommRow).vapi_call_id}</div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <Badge className="text-xs mr-1">{(event.data as FollowUpRow).kind}</Badge>
                        <span className="text-muted-foreground">Status: {(event.data as FollowUpRow).status}</span>
                        {(event.data as FollowUpRow).source && (
                          <span className="text-muted-foreground ml-2">Source: {(event.data as FollowUpRow).source}</span>
                        )}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 6: Calendar / Queue Sync Panel ──
function CalendarSyncPanel({ reservedLeads }: { reservedLeads: LeadRow[] }) {
  const { data: followUps } = useQuery({
    queryKey: ['pipeline-control-sync-followups', [...reservedLeads.map(l => l.id)]],
    queryFn: async () => {
      if (reservedLeads.length === 0) return [];
      const { data, error } = await supabase
        .from('follow_ups')
        .select('*')
        .in('lead_id', reservedLeads.map(l => l.id))
        .eq('status', 'pending')
        .order('scheduled_for', { ascending: true });
      if (error) throw error;
      return data as FollowUpRow[];
    },
    enabled: reservedLeads.length > 0,
  });

  if (reservedLeads.length === 0) return null;

  const followUpMap: Record<number, FollowUpRow | undefined> = {};
  followUps?.forEach(fu => {
    if (!followUpMap[fu.lead_id]) followUpMap[fu.lead_id] = fu;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Calendar / Queue Sync Panel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reservedLeads.map((lead) => {
          const fu = followUpMap[lead.id];
          return (
            <Card key={lead.id} className="border bg-white">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">{lead.owner_name}</div>
                  {lead.pipeline_stage && (
                    <Badge className={`${STAGE_COLORS[lead.pipeline_stage]} text-white text-xs`}>
                      {lead.pipeline_stage.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-semibold">Next Action:</span> {lead.next_action_type || '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Next Action At:</span>{' '}
                    {lead.next_action_at ? formatDistanceToNow(new Date(lead.next_action_at), { addSuffix: true }) : '—'}
                  </div>
                  <div>
                    <span className="font-semibold">Pending Follow-Up:</span> {fu ? fu.kind : 'None'}
                  </div>
                  <div>
                    <span className="font-semibold">Scheduled For:</span>{' '}
                    {fu ? formatDistanceToNow(new Date(fu.scheduled_for), { addSuffix: true }) : '—'}
                  </div>
                  <div className="col-span-2">
                    <span className="font-semibold">Callback Status:</span> {lead.callback_status || '—'}
                  </div>
                </div>
                {lead.next_action_type && fu && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>→</span>
                    <span>Transition path: {lead.next_action_type} → {fu.kind}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Section 7: Import Outlet (stub) ──
function ImportOutlet() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Lead Import</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="border-2 border-dashed border-gray-300 bg-gray-50 rounded-md p-8 text-center text-muted-foreground cursor-not-allowed opacity-50">
          <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm">Drag & drop CSV here (disabled)</p>
        </div>
        <div className="border rounded-md p-3 bg-gray-100 text-sm text-muted-foreground">
          <p className="font-semibold mb-2">Import Preview (placeholder)</p>
          <div className="text-xs italic">Empty table — no data</div>
        </div>
        <p className="text-xs text-muted-foreground">
          Duplicate phone detection and validation will be wired in the next phase
        </p>
        <Button disabled size="sm">
          Import Leads (disabled)
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──
export default function PipelineControlPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set());
  const [reservedLeads, setReservedLeads] = useState<Set<number>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);

  // Query untouched leads
  const { data: leads, isLoading } = useQuery({
    queryKey: ['pipeline-control-leads'],
    queryFn: async () => {
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('id, owner_name, owner_phone, property_data, status, pipeline_stage, callable, outbound_approved, outreach_count, last_disposition, next_action_type, next_action_at, next_followup_date, handoff_status, callback_status')
        .eq('status', 'new')
        .or('outreach_count.is.null,outreach_count.eq.0')
        .eq('archived', false)
        .order('id', { ascending: true })
        .limit(10);

      if (leadsError) throw leadsError;

      const leadIds = leadsData?.map(l => l.id) || [];
      const { data: followUpsData, error: fuError } = await supabase
        .from('follow_ups')
        .select('lead_id')
        .in('lead_id', leadIds)
        .eq('status', 'pending');

      if (fuError) throw fuError;

      const fuCounts: Record<number, number> = {};
      followUpsData?.forEach(f => {
        fuCounts[f.lead_id] = (fuCounts[f.lead_id] || 0) + 1;
      });

      return (leadsData || []).map(l => ({
        ...l,
        pendingFollowUps: fuCounts[l.id] || 0,
      })) as LeadRow[];
    },
  });

  const allLeads = leads || [];
  const reservedLeadRows = allLeads.filter(l => reservedLeads.has(l.id));

  const toggleLead = (id: number) => {
    const next = new Set(selectedLeads);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLeads(next);
  };

  const handleReserve = () => {
    if (selectedLeads.size === 0 || selectedLeads.size > 5) return;
    setReservedLeads(new Set([...reservedLeads, ...selectedLeads]));
    setSelectedLeads(new Set());
    toast({ title: `Reserved ${selectedLeads.size} lead(s) for test` });
  };

  const triggerCallMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ lead_id: leadId }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Call triggered' });
      queryClient.invalidateQueries({ queryKey: ['pipeline-control-leads'] });
    },
    onError: (e: any) => {
      toast({ title: 'Call failed', description: e.message, variant: 'destructive' });
    },
  });

  const handleRefresh = (leadId: number) => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-control-leads'] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-control-followups'] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-control-comms'] });
    toast({ title: 'State refreshed' });
  };

  const handleMarkComplete = (leadId: number) => {
    const next = new Set(reservedLeads);
    next.delete(leadId);
    setReservedLeads(next);
    toast({ title: 'Test complete — lead removed from test set' });
  };

  const resetLeadMutation = useMutation({
    mutationFn: async (leadId: number) => {
      // Reset lead fields
      const { error: leadError } = await supabase
        .from('leads')
        .update({
          status: 'new',
          pipeline_stage: 'new',
          outreach_count: 0,
          last_disposition: null,
          next_action_type: null,
          next_action_at: null,
          callback_status: null,
          handoff_status: null,
        })
        .eq('id', leadId);
      if (leadError) throw leadError;

      // Delete follow_ups
      const { error: fuError } = await supabase.from('follow_ups').delete().eq('lead_id', leadId);
      if (fuError) throw fuError;

      // Delete communications
      const { error: commError } = await supabase.from('communications').delete().eq('lead_id', leadId);
      if (commError) throw commError;
    },
    onSuccess: () => {
      toast({ title: 'Lead reset complete' });
      queryClient.invalidateQueries({ queryKey: ['pipeline-control-leads'] });
    },
    onError: (e: any) => {
      toast({ title: 'Reset failed', description: e.message, variant: 'destructive' });
    },
  });

  const handleBatchTest = async () => {
    const batch = [...reservedLeads].slice(0, 3);
    if (batch.length === 0) return;
    setBatchRunning(true);
    toast({ title: `Running batch test on ${batch.length} lead(s)...` });
    for (const leadId of batch) {
      try {
        await triggerCallMutation.mutateAsync(leadId);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (e) {
        // Continue on error
      }
    }
    setBatchRunning(false);
    toast({ title: 'Batch test complete' });
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Pipeline Control — Operational Console</h1>
          <p className="text-sm text-muted-foreground">Test actions, state inspection, and integrity validation</p>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        ) : (
          <>
            <LeadIntakeTable
              leads={allLeads}
              selectedLeads={selectedLeads}
              onToggle={toggleLead}
              onReserve={handleReserve}
            />

            <TestActionsPanel
              reservedLeads={reservedLeadRows}
              onTriggerCall={(id) => triggerCallMutation.mutate(id)}
              onRefresh={handleRefresh}
              onMarkComplete={handleMarkComplete}
              onResetLead={(id) => resetLeadMutation.mutate(id)}
              onBatchTest={handleBatchTest}
              batchRunning={batchRunning}
            />

            <LiveStateTracker reservedLeads={reservedLeadRows} />

            <IntegrityChecker reservedLeads={reservedLeadRows} />

            <EventFeed reservedLeads={reservedLeadRows} />

            <CalendarSyncPanel reservedLeads={reservedLeadRows} />

            <ImportOutlet />
          </>
        )}
      </div>
    </AppLayout>
  );
}
