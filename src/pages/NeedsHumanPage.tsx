import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Phone, ExternalLink, UserCheck, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp, AlertTriangle, Flame, ThermometerSun,
  Search, Ban,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/New_York';

// ── Types ──

type ViabilityBucket = 'viable' | 'review' | 'not_viable';

type HandoffLead = {
  id: number;
  full_name: string;
  owner_phone: string | null;
  property_address: string;
  property_type: string | null;
  handoff_status: string;
  handoff_priority: string | null;
  handoff_trigger_phrase: string | null;
  handoff_requested_at: string | null;
  handoff_assigned_to: string | null;
  sla_due_at: string | null;
  engagement_level: string | null;
  viability_status: string | null;
  buy_box_pass: boolean | null;
  estimated_net_spread: number | null;
  disqualify_reason: string | null;
  distress_signals: string[] | null;
  assessed_value: number | null;
  arv: number | null;
  estimated_repairs: number | null;
  last_transcript_snippet: string | null;
  bucket: ViabilityBucket;
};

// ── Priority + Viability badge configs ──

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  hot_interest: { label: '🔥 HOT', className: 'bg-red-600 text-white' },
  warm_interest: { label: '🌡️ WARM', className: 'bg-orange-500 text-white' },
  manual_review: { label: '🔍 REVIEW', className: 'bg-blue-500 text-white' },
};

const VIABILITY_CONFIG: Record<string, { label: string; className: string }> = {
  viable: { label: 'VIABLE', className: 'bg-green-600 text-white' },
  borderline: { label: 'BORDERLINE', className: 'bg-yellow-500 text-black' },
  missing_data: { label: 'MISSING DATA', className: 'bg-gray-500 text-white' },
  not_viable: { label: 'NOT VIABLE', className: 'bg-red-800 text-white' },
};

const HANDOFF_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: 'PENDING', className: 'bg-purple-600 text-white' },
  in_progress: { label: 'IN PROGRESS', className: 'bg-blue-600 text-white' },
};

function classifyBucket(viabilityStatus: string | null): ViabilityBucket {
  if (viabilityStatus === 'viable') return 'viable';
  if (viabilityStatus === 'borderline' || viabilityStatus === 'missing_data') return 'review';
  return 'not_viable';
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function slaCountdown(slaDueAt: string | null): { text: string; urgent: boolean } {
  if (!slaDueAt) return { text: 'No SLA', urgent: false };
  const due = new Date(slaDueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  if (diffMs < 0) {
    return { text: `⚠️ OVERDUE by ${formatDistanceToNow(due)}`, urgent: true };
  }
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours < 2) return { text: `${hours}h ${mins}m left`, urgent: true };
  return { text: `${hours}h ${mins}m left`, urgent: false };
}

// ── Card component ──

function HandoffCard({
  lead,
  onClaim,
  onComplete,
  onDisqualify,
  onSnooze,
}: {
  lead: HandoffLead;
  onClaim: (id: number) => void;
  onComplete: (id: number) => void;
  onDisqualify: (id: number) => void;
  onSnooze: (id: number, currentSla: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDQ, setConfirmDQ] = useState(false);

  const priorityCfg = lead.handoff_priority ? PRIORITY_CONFIG[lead.handoff_priority] : null;
  const viabilityCfg = lead.viability_status ? VIABILITY_CONFIG[lead.viability_status] : null;
  const statusCfg = HANDOFF_STATUS_CONFIG[lead.handoff_status] || null;
  const sla = slaCountdown(lead.sla_due_at);
  const distress = lead.distress_signals || [];

  const borderClass =
    lead.handoff_priority === 'hot_interest' && lead.viability_status === 'viable'
      ? 'border-red-400 bg-red-50/40'
      : lead.handoff_priority === 'warm_interest' && lead.viability_status === 'viable'
        ? 'border-orange-300 bg-orange-50/30'
        : lead.viability_status === 'not_viable'
          ? 'border-gray-300 bg-gray-50'
          : 'border-gray-200 bg-white';

  return (
    <>
      <Card className={`border-2 ${borderClass}`}>
        <CardContent className="p-4">
          {/* Top row: identity + badges + SLA */}
          <div className="flex items-start justify-between gap-4">
            {/* Left: Identity */}
            <div className="flex-1 min-w-0">
              <Link
                to={`/leads/${lead.id}`}
                className="text-lg font-semibold text-blue-600 hover:underline block truncate"
              >
                {lead.full_name}
              </Link>
              <p className="text-sm text-muted-foreground truncate">{lead.property_address}</p>
              <p className="text-sm font-mono text-gray-700 mt-1">
                {lead.owner_phone ? (
                  <a href={`tel:${lead.owner_phone}`} className="hover:underline">{lead.owner_phone}</a>
                ) : '—'}
              </p>
            </div>

            {/* Center: Badges */}
            <div className="flex flex-col gap-1.5 items-start shrink-0">
              {priorityCfg && (
                <Badge className={`text-xs font-bold ${priorityCfg.className}`}>{priorityCfg.label}</Badge>
              )}
              {viabilityCfg && (
                <Badge className={`text-xs font-bold ${viabilityCfg.className}`}>{viabilityCfg.label}</Badge>
              )}
              {statusCfg && (
                <Badge className={`text-xs font-bold ${statusCfg.className}`}>{statusCfg.label}</Badge>
              )}
              {lead.engagement_level && (
                <Badge variant="outline" className="text-xs capitalize">
                  {lead.engagement_level === 'hot' ? '🔥' : lead.engagement_level === 'warm' ? '🌡️' : '❄️'}{' '}
                  {lead.engagement_level}
                </Badge>
              )}
              {lead.buy_box_pass === true && (
                <Badge className="bg-green-100 text-green-800 text-xs">✅ Buy Box</Badge>
              )}
              {lead.buy_box_pass === false && (
                <Badge className="bg-red-100 text-red-800 text-xs">❌ Buy Box Fail</Badge>
              )}
            </div>

            {/* Right: SLA + financial */}
            <div className="text-right text-xs space-y-1 min-w-[200px] shrink-0">
              <div className={`font-bold text-sm ${sla.urgent ? 'text-red-600 animate-pulse' : 'text-gray-700'}`}>
                <Clock className="inline h-3.5 w-3.5 mr-1" />
                {sla.text}
              </div>
              {lead.sla_due_at && (
                <div className="text-muted-foreground">
                  Due: {formatInTimeZone(new Date(lead.sla_due_at), TZ, 'MMM d, h:mm a')} ET
                </div>
              )}
              {lead.handoff_requested_at && (
                <div className="text-muted-foreground">
                  Requested: {formatDistanceToNow(new Date(lead.handoff_requested_at), { addSuffix: true })}
                </div>
              )}
              {lead.handoff_assigned_to && (
                <div className="text-blue-600 font-medium">
                  <UserCheck className="inline h-3 w-3 mr-1" />
                  {lead.handoff_assigned_to}
                </div>
              )}
            </div>
          </div>

          {/* Operational info row */}
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Property Type</span>
              <span className="font-medium capitalize">{lead.property_type || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Assessed</span>
              <span className="font-medium">{formatCurrency(lead.assessed_value)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">ARV</span>
              <span className="font-medium">{formatCurrency(lead.arv)}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Est. Repairs</span>
              <span className="font-medium">{formatCurrency(lead.estimated_repairs)}</span>
            </div>
          </div>

          {lead.estimated_net_spread != null && (
            <div className="mt-2">
              <Badge className={`text-xs font-bold ${lead.estimated_net_spread > 0 ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                Net Spread: {formatCurrency(lead.estimated_net_spread)}
              </Badge>
            </div>
          )}

          {/* Distress signals */}
          {distress.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {distress.map((s, i) => (
                <Badge key={i} variant="destructive" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          )}

          {/* Trigger phrase / transcript */}
          {lead.handoff_trigger_phrase && (
            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
              <span className="font-semibold text-amber-800">Trigger:</span>{' '}
              <span className="text-amber-900 italic">"{lead.handoff_trigger_phrase}"</span>
            </div>
          )}

          {lead.disqualify_reason && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
              <span className="font-semibold text-red-800">DQ Reason:</span>{' '}
              <span className="text-red-900">{lead.disqualify_reason}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap">
            {lead.handoff_status === 'pending' && (
              <Button size="sm" onClick={() => onClaim(lead.id)} className="bg-blue-600 hover:bg-blue-700">
                <UserCheck className="h-3 w-3 mr-1" />
                Claim
              </Button>
            )}
            <Button size="sm" onClick={() => onComplete(lead.id)} className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Complete
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDQ(true)}>
              <XCircle className="h-3 w-3 mr-1" />
              Disqualify
            </Button>
            <Button size="sm" variant="outline" onClick={() => onSnooze(lead.id, lead.sla_due_at)}>
              <Clock className="h-3 w-3 mr-1" />
              Snooze
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/leads/${lead.id}`}>
                <ExternalLink className="h-3 w-3 mr-1" />
                Open Lead
              </Link>
            </Button>
            {lead.owner_phone && (
              <Button size="sm" variant="outline" asChild>
                <a href={`tel:${lead.owner_phone}`}>
                  <Phone className="h-3 w-3 mr-1" />
                  Call
                </a>
              </Button>
            )}

            <div className="ml-auto">
              <Collapsible open={expanded} onOpenChange={setExpanded}>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-xs">
                    {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                    Details
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 p-3 bg-gray-50 rounded text-xs space-y-1 border">
                  <div><strong>Handoff Priority:</strong> {lead.handoff_priority || 'N/A'}</div>
                  <div><strong>Viability:</strong> {lead.viability_status || 'N/A'}</div>
                  <div><strong>Buy Box:</strong> {lead.buy_box_pass == null ? 'N/A' : lead.buy_box_pass ? '✅ Pass' : '❌ Fail'}</div>
                  <div><strong>Engagement:</strong> {lead.engagement_level || 'N/A'}</div>
                  <div><strong>Status:</strong> {lead.handoff_status}</div>
                  <div><strong>Assigned to:</strong> {lead.handoff_assigned_to || 'Unassigned'}</div>
                  {lead.handoff_requested_at && (
                    <div><strong>Requested:</strong> {formatInTimeZone(new Date(lead.handoff_requested_at), TZ, 'MMM d, yyyy h:mm a')} ET</div>
                  )}
                  {lead.sla_due_at && (
                    <div><strong>SLA Due:</strong> {formatInTimeZone(new Date(lead.sla_due_at), TZ, 'MMM d, yyyy h:mm a')} ET</div>
                  )}
                  <div><strong>Assessed:</strong> {formatCurrency(lead.assessed_value)}</div>
                  <div><strong>ARV:</strong> {formatCurrency(lead.arv)}</div>
                  <div><strong>Est. Repairs:</strong> {formatCurrency(lead.estimated_repairs)}</div>
                  <div><strong>Net Spread:</strong> {formatCurrency(lead.estimated_net_spread)}</div>
                  {lead.last_transcript_snippet && (
                    <div className="border-t pt-1 mt-1">
                      <strong>Last Transcript:</strong>
                      <p className="mt-1 italic text-gray-600">"{lead.last_transcript_snippet}"</p>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disqualify confirm dialog */}
      <Dialog open={confirmDQ} onOpenChange={setConfirmDQ}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disqualify — {lead.full_name}</DialogTitle>
            <DialogDescription>
              This marks the lead out of the handoff queue. The callback history is preserved. Enter a reason below.
            </DialogDescription>
          </DialogHeader>
          <DQForm
            onConfirm={(reason) => {
              onDisqualify(lead.id);
              // reason is handled inside the mutation
              setConfirmDQ(false);
            }}
            onCancel={() => setConfirmDQ(false)}
            leadId={lead.id}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DQForm({ onConfirm, onCancel, leadId }: { onConfirm: (reason: string) => void; onCancel: () => void; leadId: number }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="dq-reason">Reason</Label>
        <Textarea
          id="dq-reason"
          placeholder="Why is this lead being disqualified?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={!reason.trim()}>
          Disqualify
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Section wrapper ──

function QueueSection({
  title,
  icon,
  leads,
  count,
  defaultOpen = true,
  onClaim,
  onComplete,
  onDisqualify,
  onSnooze,
}: {
  title: string;
  icon: React.ReactNode;
  leads: HandoffLead[];
  count: number;
  defaultOpen?: boolean;
  onClaim: (id: number) => void;
  onComplete: (id: number) => void;
  onDisqualify: (id: number) => void;
  onSnooze: (id: number, currentSla: string | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center gap-2 cursor-pointer select-none py-2 px-1 hover:bg-gray-50 rounded">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {icon}
          <h2 className="text-lg font-bold">{title}</h2>
          <Badge variant="secondary" className="ml-2">{count}</Badge>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 mt-2">
        {leads.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No leads in this section.</div>
        ) : (
          leads.map((lead) => (
            <HandoffCard
              key={lead.id}
              lead={lead}
              onClaim={onClaim}
              onComplete={onComplete}
              onDisqualify={onDisqualify}
              onSnooze={onSnooze}
            />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main page ──

export default function NeedsHumanPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [snoozeDialog, setSnoozeDialog] = useState<{ open: boolean; leadId: number | null; currentSla: string | null }>({
    open: false, leadId: null, currentSla: null,
  });
  const [snoozeDate, setSnoozeDate] = useState('');
  const [snoozeTime, setSnoozeTime] = useState('09:00');
  const [dqReason, setDqReason] = useState('');
  const [dqLeadId, setDqLeadId] = useState<number | null>(null);

  // ── Main query ──
  const { data, isLoading } = useQuery({
    queryKey: ['needs-human-queue'],
    queryFn: async () => {
      const { data: leads, error } = await supabase
        .from('leads')
        .select(`
          id,
          owner_name,
          owner_phone,
          property_data,
          handoff_status,
          handoff_priority,
          handoff_trigger_phrase,
          handoff_requested_at,
          handoff_assigned_to,
          sla_due_at,
          engagement_level,
          viability_status,
          buy_box_pass,
          estimated_net_spread,
          disqualify_reason,
          property_type,
          assessed_value,
          arv,
          estimated_repairs
        `)
        .in('handoff_status', ['pending', 'in_progress'])
        .order('sla_due_at', { ascending: true, nullsFirst: false });

      if (error) throw error;
      if (!leads || leads.length === 0) return { viable: [], review: [], not_viable: [] };

      const rows: HandoffLead[] = leads.map((l: any) => {
        const pd = (typeof l.property_data === 'object' && l.property_data) ? l.property_data : {};
        const address = pd.address || pd.property_address || '';
        const distressArr: string[] = [];
        if (Array.isArray(pd.distress_signals)) distressArr.push(...pd.distress_signals);
        if (pd.tax_delinquent) distressArr.push('tax delinquent');
        if (pd.vacant) distressArr.push('vacant');
        if (pd.probate) distressArr.push('probate');
        if (pd.foreclosure) distressArr.push('foreclosure');

        return {
          id: l.id,
          full_name: l.owner_name || `Lead #${l.id}`,
          owner_phone: l.owner_phone || null,
          property_address: address,
          property_type: l.property_type || pd.property_type || null,
          handoff_status: l.handoff_status,
          handoff_priority: l.handoff_priority || null,
          handoff_trigger_phrase: l.handoff_trigger_phrase || null,
          handoff_requested_at: l.handoff_requested_at || null,
          handoff_assigned_to: l.handoff_assigned_to || null,
          sla_due_at: l.sla_due_at || null,
          engagement_level: l.engagement_level || null,
          viability_status: l.viability_status || null,
          buy_box_pass: l.buy_box_pass ?? null,
          estimated_net_spread: l.estimated_net_spread ?? null,
          disqualify_reason: l.disqualify_reason || null,
          distress_signals: [...new Set(distressArr)],
          assessed_value: l.assessed_value || pd.assessed_value || null,
          arv: l.arv || pd.arv || null,
          estimated_repairs: l.estimated_repairs || pd.estimated_repairs || null,
          last_transcript_snippet: pd.last_transcript_snippet || null,
          bucket: classifyBucket(l.viability_status),
        };
      });

      // Sort: handoff_status (pending first) → priority → sla → requested_at
      const priorityOrder: Record<string, number> = { hot_interest: 1, warm_interest: 2, manual_review: 3 };
      const sort = (arr: HandoffLead[]) =>
        arr.sort((a, b) => {
          // pending before in_progress
          const statusA = a.handoff_status === 'pending' ? 0 : 1;
          const statusB = b.handoff_status === 'pending' ? 0 : 1;
          if (statusA !== statusB) return statusA - statusB;
          // priority
          const priA = priorityOrder[a.handoff_priority || ''] ?? 4;
          const priB = priorityOrder[b.handoff_priority || ''] ?? 4;
          if (priA !== priB) return priA - priB;
          // sla_due_at
          const slaA = a.sla_due_at ? new Date(a.sla_due_at).getTime() : Infinity;
          const slaB = b.sla_due_at ? new Date(b.sla_due_at).getTime() : Infinity;
          if (slaA !== slaB) return slaA - slaB;
          // handoff_requested_at
          const reqA = a.handoff_requested_at ? new Date(a.handoff_requested_at).getTime() : Infinity;
          const reqB = b.handoff_requested_at ? new Date(b.handoff_requested_at).getTime() : Infinity;
          return reqA - reqB;
        });

      return {
        viable: sort(rows.filter(r => r.bucket === 'viable')),
        review: sort(rows.filter(r => r.bucket === 'review')),
        not_viable: sort(rows.filter(r => r.bucket === 'not_viable')),
      };
    },
    refetchInterval: 30000,
  });

  const viable = data?.viable || [];
  const review = data?.review || [];
  const notViable = data?.not_viable || [];
  const totalCount = viable.length + review.length + notViable.length;

  // ── Mutations ──

  const claimMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const { error } = await supabase
        .from('leads')
        .update({
          handoff_status: 'in_progress',
          handoff_assigned_to: 'Ben',
          status_update_source: 'operator',
          pipeline_update_source: 'operator',
          state_change_reason: 'Operator claimed lead from Needs Human queue',
          last_state_change_at: new Date().toISOString(),
        })
        .eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Lead claimed' });
      queryClient.invalidateQueries({ queryKey: ['needs-human-queue'] });
    },
    onError: (e: any) => {
      toast({ title: 'Claim failed', description: e.message, variant: 'destructive' });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const { error } = await supabase
        .from('leads')
        .update({
          handoff_status: 'completed',
          handoff_completed_at: new Date().toISOString(),
          status_update_source: 'operator',
          pipeline_update_source: 'operator',
          state_change_reason: 'Operator completed handoff from Needs Human queue',
          last_state_change_at: new Date().toISOString(),
        })
        .eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Handoff completed' });
      queryClient.invalidateQueries({ queryKey: ['needs-human-queue'] });
    },
    onError: (e: any) => {
      toast({ title: 'Complete failed', description: e.message, variant: 'destructive' });
    },
  });

  const disqualifyMutation = useMutation({
    mutationFn: async ({ leadId, reason }: { leadId: number; reason: string }) => {
      const { error } = await supabase
        .from('leads')
        .update({
          handoff_status: 'completed',
          handoff_completed_at: new Date().toISOString(),
          disqualify_reason: reason,
          viability_status: 'not_viable',
          status_update_source: 'operator',
          pipeline_update_source: 'operator',
          state_change_reason: `Operator disqualified from Needs Human queue: ${reason}`,
          last_state_change_at: new Date().toISOString(),
        })
        .eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Lead disqualified' });
      setDqLeadId(null);
      setDqReason('');
      queryClient.invalidateQueries({ queryKey: ['needs-human-queue'] });
    },
    onError: (e: any) => {
      toast({ title: 'Disqualify failed', description: e.message, variant: 'destructive' });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async ({ leadId, newSla }: { leadId: number; newSla: string }) => {
      const { error } = await supabase
        .from('leads')
        .update({
          sla_due_at: newSla,
          status_update_source: 'operator',
          state_change_reason: `Operator snoozed handoff SLA to ${newSla}`,
          last_state_change_at: new Date().toISOString(),
        })
        .eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Lead snoozed' });
      setSnoozeDialog({ open: false, leadId: null, currentSla: null });
      setSnoozeDate('');
      setSnoozeTime('09:00');
      queryClient.invalidateQueries({ queryKey: ['needs-human-queue'] });
    },
    onError: (e: any) => {
      toast({ title: 'Snooze failed', description: e.message, variant: 'destructive' });
    },
  });

  const handleSnooze = (leadId: number, currentSla: string | null) => {
    setSnoozeDialog({ open: true, leadId, currentSla });
    if (currentSla) {
      const dt = new Date(currentSla);
      setSnoozeDate(formatInTimeZone(dt, TZ, 'yyyy-MM-dd'));
      setSnoozeTime(formatInTimeZone(dt, TZ, 'HH:mm'));
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setSnoozeDate(formatInTimeZone(tomorrow, TZ, 'yyyy-MM-dd'));
      setSnoozeTime('09:00');
    }
  };

  const handleDisqualify = (leadId: number) => {
    setDqLeadId(leadId);
  };

  const submitSnooze = () => {
    if (!snoozeDialog.leadId || !snoozeDate || !snoozeTime) return;
    snoozeMutation.mutate({
      leadId: snoozeDialog.leadId,
      newSla: `${snoozeDate}T${snoozeTime}:00`,
    });
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Needs Human</h1>
          <p className="text-muted-foreground">
            Triage board for human callbacks · {totalCount} lead{totalCount !== 1 ? 's' : ''} waiting · Auto-refresh 30s
          </p>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading queue...</div>
        ) : totalCount === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="text-lg font-medium text-gray-700">Queue clear</p>
            <p className="text-muted-foreground text-sm">No leads need human attention right now.</p>
          </div>
        ) : (
          <>
            {/* Section 1: Viable */}
            <QueueSection
              title="Needs Human — Viable"
              icon={<Flame className="h-5 w-5 text-red-500" />}
              leads={viable}
              count={viable.length}
              defaultOpen={true}
              onClaim={(id) => claimMutation.mutate(id)}
              onComplete={(id) => completeMutation.mutate(id)}
              onDisqualify={handleDisqualify}
              onSnooze={handleSnooze}
            />

            {/* Section 2: Review */}
            <QueueSection
              title="Needs Human — Review"
              icon={<Search className="h-5 w-5 text-amber-500" />}
              leads={review}
              count={review.length}
              defaultOpen={review.length > 0 && viable.length === 0}
              onClaim={(id) => claimMutation.mutate(id)}
              onComplete={(id) => completeMutation.mutate(id)}
              onDisqualify={handleDisqualify}
              onSnooze={handleSnooze}
            />

            {/* Section 3: Not Viable — collapsed by default */}
            <QueueSection
              title="Needs Human — Not Viable"
              icon={<Ban className="h-5 w-5 text-gray-500" />}
              leads={notViable}
              count={notViable.length}
              defaultOpen={false}
              onClaim={(id) => claimMutation.mutate(id)}
              onComplete={(id) => completeMutation.mutate(id)}
              onDisqualify={handleDisqualify}
              onSnooze={handleSnooze}
            />
          </>
        )}

        {/* Snooze Dialog */}
        <Dialog
          open={snoozeDialog.open}
          onOpenChange={(open) => {
            if (!open) {
              setSnoozeDialog({ open: false, leadId: null, currentSla: null });
              setSnoozeDate('');
              setSnoozeTime('09:00');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Snooze / Reschedule</DialogTitle>
              <DialogDescription>Set a new follow-up time for this lead.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="snooze-date">Date</Label>
                <Input
                  id="snooze-date"
                  type="date"
                  value={snoozeDate}
                  onChange={(e) => setSnoozeDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="snooze-time">Time (ET)</Label>
                <Input
                  id="snooze-time"
                  type="time"
                  value={snoozeTime}
                  onChange={(e) => setSnoozeTime(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSnoozeDialog({ open: false, leadId: null, currentSla: null })}
              >
                Cancel
              </Button>
              <Button
                onClick={submitSnooze}
                disabled={!snoozeDate || !snoozeTime || snoozeMutation.isPending}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Disqualify Dialog (top-level so reason state works) */}
        <Dialog open={dqLeadId !== null} onOpenChange={(open) => { if (!open) { setDqLeadId(null); setDqReason(''); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disqualify Lead</DialogTitle>
              <DialogDescription>
                This keeps callback history but marks the lead out of the active queue. Enter a reason.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="dq-reason-top">Reason</Label>
              <Textarea
                id="dq-reason-top"
                placeholder="Why is this lead being disqualified?"
                value={dqReason}
                onChange={(e) => setDqReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDqLeadId(null); setDqReason(''); }}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (dqLeadId && dqReason.trim()) {
                    disqualifyMutation.mutate({ leadId: dqLeadId, reason: dqReason.trim() });
                  }
                }}
                disabled={!dqReason.trim() || disqualifyMutation.isPending}
              >
                Disqualify
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
