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
import { Phone, Pause, Calendar, ExternalLink, Flame, ThermometerSun, Snowflake, Skull, Ban, Clock, ChevronDown, ChevronUp, AlertCircle, UserCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatInTimeZone } from 'date-fns-tz';
import { formatDistanceToNow, format } from 'date-fns';
import type { PipelineStage } from '@/types/index';

const ENGAGEMENT_CONFIG: Record<string, { icon: any; color: string; label: string; bgClass: string }> = {
  hot: { icon: Flame, color: 'text-red-600', label: '🔥 Hot', bgClass: 'bg-red-50 border-red-300' },
  warm: { icon: ThermometerSun, color: 'text-orange-600', label: '🌡️ Warm', bgClass: 'bg-orange-50 border-orange-300' },
  cold: { icon: Snowflake, color: 'text-blue-500', label: '❄️ Cold', bgClass: 'bg-blue-50 border-blue-300' },
  dead: { icon: Skull, color: 'text-gray-500', label: '💀 Dead', bgClass: 'bg-gray-100 border-gray-400' },
  dnc: { icon: Ban, color: 'text-red-800', label: '🚫 DNC', bgClass: 'bg-red-100 border-red-500' },
};

type TabBucket = 'due_now' | 'upcoming_today' | 'callbacks' | 'fresh' | 'retries' | 'blocked';

type FollowUpRow = {
  id: number;
  lead_id: number;
  kind: string;
  reason: string | null;
  scheduled_for: string;
  priority: number;
  status: string;
  source: string | null;
  lead_name: string;
  owner_phone: string | null;
  property_address: string;
  engagement_level: string | null;
  cold_attempts: number;
  callable: boolean;
  outbound_approved: boolean;
  dnc_listed: boolean;
  pipeline_stage: PipelineStage | null;
  last_disposition: string | null;
  next_action_type: string | null;
  outreach_count: number;
  motivation_type: string | null;
  property_data: any;
  lead_source: string | null;
  last_comm_at: string | null;
  bucket: TabBucket;
  queue_reason: string;
  data_hygiene_status: string | null;
  sensitive_flag: boolean;
  exhaustion_status: string | null;
  callback_status: string | null;
};

const TZ = 'America/New_York';

// Call window logic: 10:30-12:00 ET and 16:30-18:30 ET
function isInsideCallWindow(now: Date): boolean {
  const hour = parseInt(formatInTimeZone(now, TZ, 'HH'));
  const minute = parseInt(formatInTimeZone(now, TZ, 'mm'));
  const mins = hour * 60 + minute;
  return (mins >= 630 && mins < 720) || (mins >= 990 && mins < 1110);
}

function isTodayET(dateStr: string): boolean {
  const todayET = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
  const dateET = formatInTimeZone(new Date(dateStr), TZ, 'yyyy-MM-dd');
  return todayET === dateET;
}

function deriveQueueReason(followUp: any, lead: any): string {
  if (followUp.kind.includes('callback')) return 'callback_due';
  if (followUp.kind.includes('retry')) return 'retry_due';
  if (followUp.kind === 'initial_outreach' || followUp.kind === 'cold_call') return 'fresh_lead';
  if (lead?.outbound_approved) return 'manual_test_approved';
  return followUp.reason || followUp.kind;
}

function classifyBucket(followUp: any, lead: any, now: Date): TabBucket {
  // Blocked first
  if (lead?.data_hygiene_status === 'hold_review' || lead?.data_hygiene_status === 'dirty_legacy') {
    return 'blocked';
  }
  if (lead?.sensitive_flag === true) {
    return 'blocked';
  }
  if (lead?.exhaustion_status === 'exhausted') {
    return 'blocked';
  }
  if (!lead?.callable || !lead?.outbound_approved ||
      lead?.engagement_level === 'dead' || lead?.engagement_level === 'dnc' ||
      lead?.status === 'dead' || lead?.status === 'dnc' || lead?.status === 'suppressed') {
    return 'blocked';
  }

  if (followUp.status !== 'pending') return 'upcoming_today';

  const scheduledDate = new Date(followUp.scheduled_for);
  const isDue = scheduledDate <= now;
  const isToday = isTodayET(followUp.scheduled_for);
  const inWindow = isInsideCallWindow(now);

  if (isDue && inWindow && isToday) return 'due_now';
  if (followUp.kind.includes('callback') || followUp.kind === 'scheduled_callback') return 'callbacks';
  if (followUp.kind === 'initial_outreach' || followUp.kind === 'cold_call' || followUp.kind.includes('first_contact')) return 'fresh';
  if (followUp.kind.includes('retry')) return 'retries';
  return 'upcoming_today';
}

/* ── Per-card component (avoids hooks-in-map violation) ── */
function QueueCard({
  row,
  now,
  onCallNow,
  onSkipOnce,
  onSuppressDNC,
  onMarkHumanFollowup,
  onReschedule,
  callPending,
}: {
  row: FollowUpRow;
  now: Date;
  onCallNow: (leadId: number) => void;
  onSkipOnce: (followUpId: number) => void;
  onSuppressDNC: (leadId: number) => void;
  onMarkHumanFollowup: (leadId: number) => void;
  onReschedule: (followUpId: number, currentTime: string) => void;
  callPending: boolean;
}) {
  const [explainOpen, setExplainOpen] = useState(false);
  const [confirmDNC, setConfirmDNC] = useState(false);

  const engConfig = row.engagement_level ? ENGAGEMENT_CONFIG[row.engagement_level] : null;
  const scheduledDate = new Date(row.scheduled_for);
  const isPast = scheduledDate < now;

  // Distress chips from multiple real DB sources
  const distressChips: string[] = [];
  if (row.motivation_type) distressChips.push(row.motivation_type);
  const distressSignals = Array.isArray(row.property_data?.distress_signals) ? row.property_data.distress_signals : [];
  if (distressSignals.length > 0) distressChips.push(...distressSignals);
  if (row.property_data?.tax_delinquent) distressChips.push('tax delinquent');
  if (row.property_data?.vacant) distressChips.push('vacant');
  if (row.property_data?.probate) distressChips.push('probate');
  if (row.property_data?.foreclosure) distressChips.push('foreclosure');
  const uniqueDistress = [...new Set(distressChips)];

  return (
    <>
      <Card className={`border-2 ${
        row.sensitive_flag ? 'bg-red-50 border-red-500 ring-2 ring-red-300' :
        row.data_hygiene_status === 'dirty_legacy' ? 'bg-red-50 border-red-600' :
        row.data_hygiene_status === 'hold_review' ? 'bg-yellow-50 border-yellow-500' :
        row.exhaustion_status === 'exhausted' ? 'bg-gray-100 border-gray-500' :
        engConfig?.bgClass || 'bg-white border-gray-200'
      }`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            {/* Left: Owner + Property + Phone */}
            <div className="flex-1 min-w-0">
              <Link to={`/leads/${row.lead_id}`} className="text-lg font-semibold text-blue-600 hover:underline block truncate">
                {row.lead_name}
              </Link>
              <p className="text-sm text-muted-foreground truncate">{row.property_address}</p>
              <p className="text-sm font-mono text-gray-700 mt-1">{row.owner_phone || '—'}</p>
            </div>

            {/* Center: Badges */}
            <div className="flex flex-col gap-1.5 items-start">
              <Badge className="bg-purple-600 text-white text-xs font-bold whitespace-nowrap">
                {row.queue_reason.replace(/_/g, ' ')}
              </Badge>
              {row.pipeline_stage && (
                <Badge variant="outline" className="text-xs capitalize whitespace-nowrap">
                  {row.pipeline_stage.replace(/_/g, ' ')}
                </Badge>
              )}
              {row.last_disposition && (
                <Badge variant="secondary" className="text-xs whitespace-nowrap">
                  {row.last_disposition.replace(/_/g, ' ')}
                </Badge>
              )}
              {row.next_action_type && (
                <Badge className="bg-amber-100 text-amber-800 text-xs whitespace-nowrap">
                  Next: {row.next_action_type.replace(/_/g, ' ')}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {row.outreach_count} attempt{row.outreach_count !== 1 ? 's' : ''}
              </span>
              {engConfig && (
                <Badge variant="outline" className={`${engConfig.color} text-xs whitespace-nowrap`}>
                  {engConfig.label}
                </Badge>
              )}
              {uniqueDistress.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {uniqueDistress.slice(0, 4).map((signal, idx) => (
                    <Badge key={idx} variant="destructive" className="text-[10px]">{signal}</Badge>
                  ))}
                </div>
              )}
              {/* Trust Gate / Blocking Badges */}
              {row.data_hygiene_status === 'hold_review' && (
                <Badge className="bg-yellow-500 text-black text-xs font-bold animate-pulse">⚠️ HOLD — Review Required</Badge>
              )}
              {row.data_hygiene_status === 'dirty_legacy' && (
                <Badge className="bg-red-700 text-white text-xs font-bold">🚨 DIRTY LEGACY</Badge>
              )}
              {row.data_hygiene_status === 'unverified' && (
                <Badge className="bg-orange-500 text-white text-xs font-bold">❓ Unverified</Badge>
              )}
              {row.sensitive_flag && (
                <Badge className="bg-red-600 text-white text-xs font-bold animate-pulse">🔒 SENSITIVE</Badge>
              )}
              {row.exhaustion_status === 'exhausted' && (
                <Badge className="bg-gray-700 text-white text-xs font-bold">💤 EXHAUSTED</Badge>
              )}
              {row.exhaustion_status === 'cooling' && (
                <Badge className="bg-blue-700 text-white text-xs font-bold">🧊 COOLING</Badge>
              )}
              {row.callback_status && row.callback_status !== 'none' && (
                <Badge className={`text-xs font-bold ${
                  row.callback_status === 'requested' ? 'bg-indigo-600 text-white' :
                  row.callback_status === 'scheduled' ? 'bg-blue-500 text-white' :
                  row.callback_status === 'attempted' ? 'bg-amber-600 text-white' :
                  row.callback_status === 'completed' ? 'bg-green-600 text-white' : 'bg-gray-500 text-white'
                }`}>
                  📞 Callback: {row.callback_status}
                </Badge>
              )}
              {row.pipeline_stage === 'needs_human_followup' && (
                <Badge className="bg-orange-500 text-white text-xs">👤 Human Follow-Up</Badge>
              )}
              {row.kind.includes('callback') && (
                <Badge className="bg-blue-500 text-white text-xs">🔔 Callback</Badge>
              )}
              {(row.engagement_level === 'dnc' || row.engagement_level === 'dead') && (
                <Badge variant="destructive" className="text-xs">🚫 Blocked</Badge>
              )}
            </div>

            {/* Right: Metadata */}
            <div className="text-right text-xs space-y-1 min-w-[180px]">
              <div className={`font-semibold ${isPast ? 'text-red-600' : 'text-gray-700'}`}>
                🕐 {formatInTimeZone(scheduledDate, TZ, 'h:mm a')} ET
              </div>
              <div className="text-muted-foreground">
                {formatInTimeZone(scheduledDate, TZ, 'MMM d')} · {formatDistanceToNow(scheduledDate, { addSuffix: true })}
              </div>
              {row.last_comm_at && (
                <div className="text-muted-foreground">
                  Last call: {formatDistanceToNow(new Date(row.last_comm_at), { addSuffix: true })}
                </div>
              )}
              <div className="flex items-center justify-end gap-1">
                <span className="text-muted-foreground">Priority:</span>
                <Badge variant={row.priority >= 8 ? 'destructive' : row.priority >= 5 ? 'default' : 'secondary'} className="text-xs">
                  {row.priority}
                </Badge>
              </div>
              {row.lead_source && (
                <div className="text-muted-foreground text-[10px]">Source: {row.lead_source}</div>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap">
            {row.bucket === 'due_now' && (
              <Button
                size="sm"
                onClick={() => onCallNow(row.lead_id)}
                disabled={callPending}
                className="bg-green-600 hover:bg-green-700"
              >
                <Phone className="h-3 w-3 mr-1" />
                Call Now
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link to={`/leads/${row.lead_id}`}>
                <ExternalLink className="h-3 w-3 mr-1" />
                Open Lead
              </Link>
            </Button>
            {row.bucket !== 'blocked' && (
              <>
                <Button size="sm" variant="outline" onClick={() => onReschedule(row.id, row.scheduled_for)}>
                  <Calendar className="h-3 w-3 mr-1" />
                  Reschedule
                </Button>
                <Button size="sm" variant="outline" onClick={() => onSkipOnce(row.id)}>
                  <Pause className="h-3 w-3 mr-1" />
                  Skip Once
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDNC(true)}>
                  <Ban className="h-3 w-3 mr-1" />
                  Suppress / DNC
                </Button>
                <Button size="sm" variant="outline" onClick={() => onMarkHumanFollowup(row.lead_id)}>
                  <UserCheck className="h-3 w-3 mr-1" />
                  Mark for Human Follow-up
                </Button>
              </>
            )}
            <div className="ml-auto">
              <Collapsible open={explainOpen} onOpenChange={setExplainOpen}>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-xs">
                    {explainOpen ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                    Explain why queued
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 p-3 bg-gray-50 rounded text-xs space-y-1 border">
                  <div><strong>Follow-up kind:</strong> {row.kind}</div>
                  <div><strong>Scheduled for:</strong> {formatInTimeZone(scheduledDate, TZ, 'MMM d, yyyy h:mm a')} ET</div>
                  {row.reason && <div><strong>Reason:</strong> {row.reason}</div>}
                  <div className="border-t pt-1 mt-1">
                    <strong>Manual approval status:</strong> follow_up.status = <code>{row.status}</code> · outbound_approved = {row.outbound_approved ? '✅' : '❌'}
                  </div>
                  <div><strong>Timezone eligibility:</strong> ET — eligible (Maine)</div>
                  <div><strong>Callable:</strong> {row.callable ? '✅ Yes' : '❌ No'} · <strong>Outbound approved:</strong> {row.outbound_approved ? '✅ Yes' : '❌ No'}</div>
                  <div><strong>Blocked phone result:</strong> {row.dnc_listed ? '🚫 DNC Listed' : '✅ Clear'}</div>
                  <div className="border-t pt-1 mt-1">
                    <strong>Spacing / retry summary:</strong> {row.cold_attempts} cold attempts / {row.outreach_count} total outreach
                    {row.last_comm_at && <> / last contact {format(new Date(row.last_comm_at), 'MMM d')}</>}
                  </div>
                  <div><strong>Engagement level:</strong> {row.engagement_level || 'N/A'}</div>
                  <div><strong>Priority:</strong> {row.priority}</div>
                  {row.source && <div><strong>Follow-up source:</strong> {row.source}</div>}
                  <div className="border-t pt-1 mt-1">
                    <strong>Data hygiene:</strong> {row.data_hygiene_status || 'N/A'} · <strong>Sensitive:</strong> {row.sensitive_flag ? '🔒 Yes' : '✅ No'} · <strong>Exhaustion:</strong> {row.exhaustion_status || 'N/A'} · <strong>Callback:</strong> {row.callback_status || 'none'}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* DNC confirm dialog */}
      <Dialog open={confirmDNC} onOpenChange={setConfirmDNC}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suppress / DNC — {row.lead_name}</DialogTitle>
            <DialogDescription>
              This will mark the lead as suppressed, set DNC listed = true, and block future outbound calls. This cannot be easily undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDNC(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                onSuppressDNC(row.lead_id);
                setConfirmDNC(false);
              }}
            >
              Confirm Suppress / DNC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Main page ── */
export default function DialQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabBucket>('due_now');
  const [rescheduleDialog, setRescheduleDialog] = useState<{ open: boolean; followUpId: number | null; currentTime: string }>({
    open: false, followUpId: null, currentTime: '',
  });
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('09:00');

  // Main query: follow_ups + leads + latest communications
  const { data, isLoading } = useQuery({
    queryKey: ['dial-queue'],
    queryFn: async () => {
      const { data: followUps, error: fuError } = await supabase
        .from('follow_ups')
        .select('id, lead_id, kind, reason, scheduled_for, priority, status, source')
        .in('status', ['pending', 'held', 'dialing', 'scheduled'])
        .order('priority', { ascending: false })
        .order('scheduled_for', { ascending: true });

      if (fuError) throw fuError;
      if (!followUps || followUps.length === 0) {
        return { rows: [], buckets: { due_now: 0, upcoming_today: 0, callbacks: 0, fresh: 0, retries: 0, blocked: 0 } };
      }

      const leadIds = [...new Set(followUps.map(f => f.lead_id))];

      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, owner_name, owner_phone, property_data, engagement_level, cold_attempts, callable, outbound_approved, status, pipeline_stage, last_disposition, lead_source, next_action_type, motivation_type, outreach_count, dnc_listed, data_hygiene_status, sensitive_flag, exhaustion_status, callback_status')
        .in('id', leadIds)
        .eq('archived', false);
      if (leadsError) throw leadsError;

      const leadMap: Record<number, any> = {};
      leads?.forEach(l => { leadMap[l.id] = l; });

      const { data: comms, error: commsError } = await supabase
        .from('communications')
        .select('lead_id, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false });
      if (commsError) throw commsError;

      const latestCommMap: Record<number, string | null> = {};
      comms?.forEach(c => { if (!latestCommMap[c.lead_id]) latestCommMap[c.lead_id] = c.created_at; });

      const now = new Date();
      const rows: FollowUpRow[] = followUps.map(fu => {
        const lead = leadMap[fu.lead_id] || {};
        const pd = (typeof lead.property_data === 'object' ? lead.property_data : {}) as any;
        const address = pd.address || pd.property_address || '';
        return {
          id: fu.id,
          lead_id: fu.lead_id,
          kind: fu.kind,
          reason: fu.reason,
          scheduled_for: fu.scheduled_for,
          priority: fu.priority,
          status: fu.status,
          source: fu.source ?? null,
          lead_name: lead.owner_name || `Lead #${fu.lead_id}`,
          owner_phone: lead.owner_phone || null,
          property_address: address,
          engagement_level: lead.engagement_level || null,
          cold_attempts: lead.cold_attempts || 0,
          callable: lead.callable ?? true,
          outbound_approved: lead.outbound_approved ?? false,
          dnc_listed: lead.dnc_listed ?? false,
          pipeline_stage: lead.pipeline_stage || null,
          last_disposition: lead.last_disposition || null,
          next_action_type: lead.next_action_type || null,
          outreach_count: lead.outreach_count || 0,
          motivation_type: lead.motivation_type || null,
          property_data: pd,
          lead_source: lead.lead_source || pd.lead_source || null,
          last_comm_at: latestCommMap[fu.lead_id] || null,
          bucket: classifyBucket(fu, lead, now),
          queue_reason: deriveQueueReason(fu, lead),
          data_hygiene_status: lead.data_hygiene_status || null,
          sensitive_flag: lead.sensitive_flag ?? false,
          exhaustion_status: lead.exhaustion_status || null,
          callback_status: lead.callback_status || null,
        };
      });

      const buckets = {
        due_now: rows.filter(r => r.bucket === 'due_now').length,
        upcoming_today: rows.filter(r => r.bucket === 'upcoming_today').length,
        callbacks: rows.filter(r => r.bucket === 'callbacks').length,
        fresh: rows.filter(r => r.bucket === 'fresh').length,
        retries: rows.filter(r => r.bucket === 'retries').length,
        blocked: rows.filter(r => r.bucket === 'blocked').length,
      };
      return { rows, buckets };
    },
    refetchInterval: 30000,
  });

  const rows = data?.rows || [];
  const buckets = data?.buckets || { due_now: 0, upcoming_today: 0, callbacks: 0, fresh: 0, retries: 0, blocked: 0 };
  const filteredRows = rows.filter(r => r.bucket === activeTab);

  // ── Mutations ──
  const callNowMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ lead_id: leadId }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => { toast({ title: 'Call initiated', description: 'Dialing...' }); queryClient.invalidateQueries({ queryKey: ['dial-queue'] }); },
    onError: (e: any) => { toast({ title: 'Call failed', description: e.message, variant: 'destructive' }); },
  });

  const skipOnceMutation = useMutation({
    mutationFn: async (followUpId: number) => {
      const { error } = await supabase.from('follow_ups').update({ status: 'skipped', status_update_source: 'operator', state_change_reason: 'Operator skipped follow-up from dial queue' }).eq('id', followUpId);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: 'Follow-up skipped' }); queryClient.invalidateQueries({ queryKey: ['dial-queue'] }); },
  });

  const suppressDNCMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const { error } = await supabase.from('leads').update({ status: 'suppressed', dnc_listed: true, engagement_level: 'dnc', status_update_source: 'operator', pipeline_update_source: 'operator', state_change_reason: 'Operator suppressed / marked DNC from dial queue', last_state_change_at: new Date().toISOString() }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: 'Lead suppressed / DNC' }); queryClient.invalidateQueries({ queryKey: ['dial-queue'] }); },
  });

  const markHumanFollowupMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const { error } = await supabase.from('leads').update({ next_action_type: 'human_followup', handoff_status: 'pending', status_update_source: 'operator', pipeline_update_source: 'operator', state_change_reason: 'Operator marked for human follow-up from dial queue', last_state_change_at: new Date().toISOString() }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: 'Marked for human follow-up' }); queryClient.invalidateQueries({ queryKey: ['dial-queue'] }); },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({ followUpId, newDateTime }: { followUpId: number; newDateTime: string }) => {
      const { error } = await supabase.from('follow_ups').update({ scheduled_for: newDateTime, status_update_source: 'operator', state_change_reason: `Operator rescheduled follow-up to ${newDateTime}` }).eq('id', followUpId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Follow-up rescheduled' });
      setRescheduleDialog({ open: false, followUpId: null, currentTime: '' });
      setRescheduleDate(''); setRescheduleTime('09:00');
      queryClient.invalidateQueries({ queryKey: ['dial-queue'] });
    },
  });

  const handleReschedule = (followUpId: number, currentTime: string) => {
    setRescheduleDialog({ open: true, followUpId, currentTime });
    const dt = new Date(currentTime);
    setRescheduleDate(formatInTimeZone(dt, TZ, 'yyyy-MM-dd'));
    setRescheduleTime(formatInTimeZone(dt, TZ, 'HH:mm'));
  };

  const submitReschedule = () => {
    if (!rescheduleDialog.followUpId || !rescheduleDate || !rescheduleTime) return;
    rescheduleMutation.mutate({ followUpId: rescheduleDialog.followUpId, newDateTime: `${rescheduleDate}T${rescheduleTime}:00` });
  };

  const now = new Date();

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Dial Queue — Operator Console</h1>
          <p className="text-muted-foreground">Outbound call scheduling &amp; dispatch · Auto-refresh every 30s</p>
        </div>

        {/* Bucket Tabs */}
        <div className="flex gap-2 flex-wrap">
          {([
            { key: 'due_now' as TabBucket, icon: <Phone className="h-4 w-4 mr-1" />, label: 'Due Now' },
            { key: 'upcoming_today' as TabBucket, icon: <Clock className="h-4 w-4 mr-1" />, label: 'Upcoming Today' },
            { key: 'callbacks' as TabBucket, icon: null, label: '🔔 Callbacks' },
            { key: 'fresh' as TabBucket, icon: null, label: '✨ Fresh' },
            { key: 'retries' as TabBucket, icon: null, label: '🔄 Retries' },
            { key: 'blocked' as TabBucket, icon: <Ban className="h-4 w-4 mr-1" />, label: 'Blocked / Filtered' },
          ]).map(tab => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon}{tab.label}
              <Badge variant="secondary" className="ml-2">{buckets[tab.key]}</Badge>
            </Button>
          ))}
        </div>

        {/* Cards */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading queue...</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No leads in this bucket.</div>
          ) : (
            filteredRows.map(row => (
              <QueueCard
                key={row.id}
                row={row}
                now={now}
                onCallNow={(id) => callNowMutation.mutate(id)}
                onSkipOnce={(id) => skipOnceMutation.mutate(id)}
                onSuppressDNC={(id) => suppressDNCMutation.mutate(id)}
                onMarkHumanFollowup={(id) => markHumanFollowupMutation.mutate(id)}
                onReschedule={handleReschedule}
                callPending={callNowMutation.isPending}
              />
            ))
          )}
        </div>

        {/* Reschedule Dialog */}
        <Dialog open={rescheduleDialog.open} onOpenChange={(open) => {
          if (!open) { setRescheduleDialog({ open: false, followUpId: null, currentTime: '' }); setRescheduleDate(''); setRescheduleTime('09:00'); }
        }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Reschedule Follow-Up</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="reschedule-date">Date</Label>
                <Input id="reschedule-date" type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="reschedule-time">Time (ET)</Label>
                <Input id="reschedule-time" type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRescheduleDialog({ open: false, followUpId: null, currentTime: '' })}>Cancel</Button>
              <Button onClick={submitReschedule} disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
