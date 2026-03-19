import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Phone, Pause, Calendar, X, ExternalLink, Flame, ThermometerSun, Snowflake, Skull, Ban, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const ENGAGEMENT_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  hot: { icon: Flame, color: 'text-red-600', label: '🔥 Hot' },
  warm: { icon: ThermometerSun, color: 'text-orange-600', label: '🌡️ Warm' },
  cold: { icon: Snowflake, color: 'text-blue-500', label: '❄️ Cold' },
  dead: { icon: Skull, color: 'text-gray-500', label: '💀 Dead' },
  dnc: { icon: Ban, color: 'text-red-800', label: '🚫 DNC' },
};

type FollowUpRow = {
  id: number;
  lead_id: number;
  kind: string;
  reason: string | null;
  scheduled_for: string;
  priority: number;
  status: string;
  lead_name: string;
  owner_phone: string | null;
  property_address: string;
  engagement_level: string | null;
  cold_attempts: number;
  callable: boolean;
  outbound_approved: boolean;
  last_outcome: string | null;
  band: 'ready' | 'upcoming' | 'held' | 'blocked';
};

const TZ = 'America/New_York';

// Call window logic: 10:30-12:00 ET and 16:30-18:30 ET
function isInsideCallWindow(now: Date): boolean {
  const hour = parseInt(formatInTimeZone(now, TZ, 'HH'));
  const minute = parseInt(formatInTimeZone(now, TZ, 'mm'));
  const mins = hour * 60 + minute;
  
  // 10:30 = 630, 12:00 = 720
  // 16:30 = 990, 18:30 = 1110
  return (mins >= 630 && mins < 720) || (mins >= 990 && mins < 1110);
}

function getNextWindowTime(now: Date): string {
  const hour = parseInt(formatInTimeZone(now, TZ, 'HH'));
  const minute = parseInt(formatInTimeZone(now, TZ, 'mm'));
  const mins = hour * 60 + minute;
  
  if (mins < 630) return '10:30 AM ET';
  if (mins >= 720 && mins < 990) return '4:30 PM ET';
  if (mins >= 1110) return 'Tomorrow 10:30 AM ET';
  return 'Now';
}

function classifyBand(
  followUp: any,
  lead: any,
  now: Date
): 'ready' | 'upcoming' | 'held' | 'blocked' {
  // Blocked: lead not callable or not outbound_approved or dead/dnc
  if (!lead.callable || !lead.outbound_approved || 
      lead.engagement_level === 'dead' || lead.engagement_level === 'dnc') {
    return 'blocked';
  }
  
  if (followUp.status === 'held') return 'held';
  
  // Ready Now: pending AND scheduled_for <= now AND inside call window
  if (followUp.status === 'pending') {
    const scheduledDate = new Date(followUp.scheduled_for);
    if (scheduledDate <= now && isInsideCallWindow(now)) {
      return 'ready';
    }
  }
  
  return 'upcoming';
}

export default function DialQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bandFilter, setBandFilter] = useState<'all' | 'ready' | 'upcoming'>('all');
  const [rescheduleDialog, setRescheduleDialog] = useState<{ open: boolean; followUpId: number | null; currentTime: string }>({
    open: false,
    followUpId: null,
    currentTime: '',
  });
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');

  // Main query: fetch follow_ups + leads + latest communications
  const { data, isLoading } = useQuery({
    queryKey: ['dial-queue'],
    queryFn: async () => {
      // Fetch follow_ups with status in (pending, held, dialing, scheduled)
      const { data: followUps, error: fuError } = await supabase
        .from('follow_ups')
        .select('id, lead_id, kind, reason, scheduled_for, priority, status')
        .in('status', ['pending', 'held', 'dialing', 'scheduled'])
        .order('priority', { ascending: false })
        .order('scheduled_for', { ascending: true });

      if (fuError) throw fuError;
      if (!followUps || followUps.length === 0) return { rows: [], stats: { ready: 0, upcoming: 0, held: 0, blocked: 0 } };

      // Fetch leads
      const leadIds = [...new Set(followUps.map(f => f.lead_id))];
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, owner_name, owner_phone, property_data, engagement_level, cold_attempts, callable, outbound_approved, status')
        .in('id', leadIds);

      if (leadsError) throw leadsError;

      const leadMap: Record<number, any> = {};
      leads?.forEach(l => { leadMap[l.id] = l; });

      // Fetch latest communication per lead
      const { data: comms, error: commsError } = await supabase
        .from('communications')
        .select('lead_id, outcome, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false });

      if (commsError) throw commsError;

      const latestCommMap: Record<number, string | null> = {};
      comms?.forEach(c => {
        if (!latestCommMap[c.lead_id]) {
          latestCommMap[c.lead_id] = c.outcome;
        }
      });

      const now = new Date();
      const rows: FollowUpRow[] = followUps.map(fu => {
        const lead = leadMap[fu.lead_id];
        const pd = (typeof lead?.property_data === 'object' ? lead.property_data : {}) as any;
        const address = pd.address || '';
        const band = classifyBand(fu, lead, now);

        return {
          id: fu.id,
          lead_id: fu.lead_id,
          kind: fu.kind,
          reason: fu.reason,
          scheduled_for: fu.scheduled_for,
          priority: fu.priority,
          status: fu.status,
          lead_name: lead?.owner_name || `Lead #${fu.lead_id}`,
          owner_phone: lead?.owner_phone || null,
          property_address: address,
          engagement_level: lead?.engagement_level || null,
          cold_attempts: lead?.cold_attempts || 0,
          callable: lead?.callable ?? true,
          outbound_approved: lead?.outbound_approved ?? false,
          last_outcome: latestCommMap[fu.lead_id] || null,
          band,
        };
      });

      const stats = {
        ready: rows.filter(r => r.band === 'ready').length,
        upcoming: rows.filter(r => r.band === 'upcoming').length,
        held: rows.filter(r => r.band === 'held').length,
        blocked: rows.filter(r => r.band === 'blocked').length,
      };

      return { rows, stats };
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const rows = data?.rows || [];
  const stats = data?.stats || { ready: 0, upcoming: 0, held: 0, blocked: 0 };

  const filteredRows = bandFilter === 'all' 
    ? rows 
    : rows.filter(r => r.band === bandFilter);

  // Mutations
  const callNowMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ lead_id: leadId }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to trigger call: ${text}`);
      }

      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Call initiated', description: 'Dialing...' });
      queryClient.invalidateQueries({ queryKey: ['dial-queue'] });
    },
    onError: (error: any) => {
      toast({ title: 'Call failed', description: error.message, variant: 'destructive' });
    },
  });

  const holdMutation = useMutation({
    mutationFn: async (followUpId: number) => {
      const { error } = await supabase
        .from('follow_ups')
        .update({ status: 'held' })
        .eq('id', followUpId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Follow-up held' });
      queryClient.invalidateQueries({ queryKey: ['dial-queue'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (followUpId: number) => {
      const { error } = await supabase
        .from('follow_ups')
        .update({ status: 'canceled', canceled_at: new Date().toISOString() })
        .eq('id', followUpId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Follow-up canceled' });
      queryClient.invalidateQueries({ queryKey: ['dial-queue'] });
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({ followUpId, newDateTime }: { followUpId: number; newDateTime: string }) => {
      const { error } = await supabase
        .from('follow_ups')
        .update({ scheduled_for: newDateTime })
        .eq('id', followUpId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Follow-up rescheduled' });
      setRescheduleDialog({ open: false, followUpId: null, currentTime: '' });
      setRescheduleDate('');
      setRescheduleTime('');
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
    const newDateTime = `${rescheduleDate}T${rescheduleTime}:00`;
    rescheduleMutation.mutate({ followUpId: rescheduleDialog.followUpId, newDateTime });
  };

  const now = new Date();
  const nextWindow = getNextWindowTime(now);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Dial Queue</h1>
          <p className="text-muted-foreground">Outbound call scheduling &amp; dispatch</p>
        </div>

        {/* Summary bar */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-green-600" />
                <div>
                  <div className="text-2xl font-bold text-green-600">{stats.ready}</div>
                  <div className="text-xs text-muted-foreground">Ready Now</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                <div>
                  <div className="text-2xl font-bold text-blue-600">{stats.upcoming}</div>
                  <div className="text-xs text-muted-foreground">Upcoming</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Pause className="h-5 w-5 text-amber-600" />
                <div>
                  <div className="text-2xl font-bold text-amber-600">{stats.held}</div>
                  <div className="text-xs text-muted-foreground">Held</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Ban className="h-5 w-5 text-red-600" />
                <div>
                  <div className="text-2xl font-bold text-red-600">{stats.blocked}</div>
                  <div className="text-xs text-muted-foreground">Blocked</div>
                </div>
              </div>
              {!isInsideCallWindow(now) && (
                <div className="ml-auto flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <div className="text-sm">Next window: <strong>{nextWindow}</strong></div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Filter buttons */}
        <div className="flex gap-2">
          <Button
            variant={bandFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBandFilter('all')}
          >
            All ({rows.length})
          </Button>
          <Button
            variant={bandFilter === 'ready' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBandFilter('ready')}
          >
            Ready Now ({stats.ready})
          </Button>
          <Button
            variant={bandFilter === 'upcoming' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBandFilter('upcoming')}
          >
            Upcoming ({stats.upcoming})
          </Button>
        </div>

        {/* Main table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading queue...</div>
            ) : filteredRows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No follow-ups in this band.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Engagement</TableHead>
                    <TableHead>Cold Attempts</TableHead>
                    <TableHead>Last Outcome</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => {
                    const engConfig = ENGAGEMENT_CONFIG[row.engagement_level || 'cold'];
                    const scheduledDate = new Date(row.scheduled_for);
                    const isPast = scheduledDate < now;

                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <Link to={`/leads/${row.lead_id}`} className="hover:underline text-blue-600">
                            {row.lead_name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {row.property_address}
                        </TableCell>
                        <TableCell className="text-sm font-mono">{row.owner_phone || '—'}</TableCell>
                        <TableCell className="text-sm">
                          <div className={isPast ? 'text-red-600 font-semibold' : ''}>
                            {formatInTimeZone(scheduledDate, TZ, 'MMM d, h:mm a')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDistanceToNow(scheduledDate, { addSuffix: true })}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{row.kind}</div>
                          {row.reason && <div className="text-xs text-muted-foreground">{row.reason}</div>}
                        </TableCell>
                        <TableCell>
                          {engConfig ? (
                            <Badge variant="outline" className={engConfig.color}>
                              {engConfig.label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-center">
                          {row.cold_attempts > 0 ? `${row.cold_attempts}/3` : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.last_outcome ? (
                            <Badge variant="secondary">{row.last_outcome.replace(/_/g, ' ')}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={row.priority >= 8 ? 'destructive' : 'outline'}>
                            {row.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.band === 'ready' && <Badge className="bg-green-600">Ready Now</Badge>}
                          {row.band === 'upcoming' && <Badge variant="secondary">Upcoming</Badge>}
                          {row.band === 'held' && <Badge className="bg-amber-600">Held</Badge>}
                          {row.band === 'blocked' && <Badge variant="destructive">Blocked</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {row.band === 'ready' && (
                              <Button
                                size="sm"
                                className="h-8"
                                onClick={() => callNowMutation.mutate(row.lead_id)}
                                disabled={callNowMutation.isPending}
                              >
                                <Phone className="h-3 w-3 mr-1" />
                                Call
                              </Button>
                            )}
                            {row.band !== 'blocked' && row.band !== 'held' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => holdMutation.mutate(row.id)}
                              >
                                <Pause className="h-3 w-3" />
                              </Button>
                            )}
                            {row.band !== 'blocked' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => handleReschedule(row.id, row.scheduled_for)}
                                >
                                  <Calendar className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => cancelMutation.mutate(row.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              asChild
                            >
                              <Link to={`/leads/${row.lead_id}`}>
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Reschedule Dialog */}
        <Dialog open={rescheduleDialog.open} onOpenChange={(open) => {
          if (!open) {
            setRescheduleDialog({ open: false, followUpId: null, currentTime: '' });
            setRescheduleDate('');
            setRescheduleTime('');
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reschedule Follow-Up</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="reschedule-date">Date</Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="reschedule-time">Time (ET)</Label>
                <Input
                  id="reschedule-time"
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRescheduleDialog({ open: false, followUpId: null, currentTime: '' })}>
                Cancel
              </Button>
              <Button onClick={submitReschedule} disabled={!rescheduleDate || !rescheduleTime || rescheduleMutation.isPending}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
// deploy trigger 1773948583
