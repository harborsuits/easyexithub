import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Flame, Snowflake, ThermometerSun, Skull, Phone, ChevronLeft, ChevronRight, X, Pause, Play, CalendarDays, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isBefore,
  startOfDay,
  addMonths,
  subMonths,
} from 'date-fns';

const TEMP_CONFIG: Record<string, { icon: any; color: string; bg: string; dotColor: string; label: string }> = {
  hot: { icon: Flame, color: 'text-red-600', bg: 'bg-red-50', dotColor: 'bg-red-500', label: '🔥 Hot' },
  warm: { icon: ThermometerSun, color: 'text-orange-600', bg: 'bg-orange-50', dotColor: 'bg-orange-400', label: '🌡️ Warm' },
  cold: { icon: Snowflake, color: 'text-blue-500', bg: 'bg-blue-50', dotColor: 'bg-blue-400', label: '❄️ Cold' },
  dead: { icon: Skull, color: 'text-gray-500', bg: 'bg-gray-50', dotColor: 'bg-gray-400', label: '💀 Dead' },
};

function getLeadTemperature(lead: any): string {
  const pd = parsePropertyData(lead.property_data);
  if (pd?.lead_temperature) return pd.lead_temperature;
  if (lead.viability_score >= 70) return 'hot';
  if (lead.viability_score >= 40) return 'warm';
  return 'cold';
}

function parsePropertyData(raw: any): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function needsBen(lead: any): boolean {
  const pd = parsePropertyData(lead.property_data);
  if ((lead.estimated_arv ?? 0) >= 200000) return true;
  if (pd?.escalate_to_ben) return true;
  if ((lead.deal_stage_id ?? 0) >= 9) return true;
  if (pd?.lead_temperature === 'hot' && (lead.viability_score ?? 0) >= 80) return true;
  return false;
}

function isOnHold(lead: any): boolean {
  const pd = parsePropertyData(lead.property_data);
  return pd?.on_hold === true || pd?.on_hold === 'true';
}

function getCallType(lead: any): string {
  if (lead.outreach_count === 0) return 'cold call';
  const pd = parsePropertyData(lead.property_data);
  if (pd?.next_action?.toLowerCase().includes('offer')) return 'offer';
  return 'follow-up';
}

function getPriorityTier(lead: any, today: Date): number {
  // 0 = needs ben (top), 1 = hot, 2 = overdue, 3 = warm, 4 = cold/other
  if (needsBen(lead)) return 0;
  const temp = getLeadTemperature(lead);
  if (temp === 'hot') return 1;
  if (lead.next_followup_date && isBefore(new Date(lead.next_followup_date), today) && !isSameDay(new Date(lead.next_followup_date), today)) return 2;
  if (temp === 'warm') return 3;
  return 4;
}

interface CalendarLead {
  id: number;
  owner_name: string;
  owner_phone: string | null;
  next_followup_date: string;
  temperature: string;
  callType: string;
  address: string;
  viability_score: number | null;
  lastCommSummary: string;
  needsBen: boolean;
  onHold: boolean;
  estimated_arv: number | null;
  deal_stage_id: number | null;
  property_data: any;
  _raw: any;
}

export function PipelineCalendar() {
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [callingLeadId, setCallingLeadId] = useState<number | null>(null);

  const { data: leads } = useQuery({
    queryKey: ['calendar-leads'],
    queryFn: async () => {
      const { data } = await supabase
        .from('leads')
        .select('id, owner_name, owner_phone, next_followup_date, deal_stage_id, viability_score, status, property_data, outreach_count, estimated_arv')
        .not('next_followup_date', 'is', null)
        .not('status', 'eq', 'dead');
      return data || [];
    },
  });

  const leadIds = leads?.map(l => l.id) || [];
  const { data: latestComms } = useQuery({
    queryKey: ['calendar-comms', leadIds.join(',')],
    queryFn: async () => {
      if (leadIds.length === 0) return {};
      const { data } = await supabase
        .from('communications')
        .select('lead_id, summary')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false });
      const map: Record<number, string> = {};
      data?.forEach(c => { if (!map[c.lead_id] && c.summary) map[c.lead_id] = c.summary; });
      return map;
    },
    enabled: leadIds.length > 0,
  });

  // Toggle hold mutation
  const toggleHold = useMutation({
    mutationFn: async ({ leadId, currentPd, currentlyOnHold }: { leadId: number; currentPd: any; currentlyOnHold: boolean }) => {
      const pd = parsePropertyData(currentPd) || {};
      pd.on_hold = !currentlyOnHold;
      const { error } = await supabase.from('leads').update({ property_data: pd }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-leads'] });
      toast.success('Lead updated');
    },
    onError: () => toast.error('Failed to update lead'),
  });

  // Reschedule mutation
  const reschedule = useMutation({
    mutationFn: async ({ leadId, date }: { leadId: number; date: string }) => {
      const { error } = await supabase.from('leads').update({ next_followup_date: date }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-leads'] });
      toast.success('Follow-up rescheduled');
    },
    onError: () => toast.error('Failed to reschedule'),
  });

  // Call now
  const triggerCall = async (leadId: number) => {
    setCallingLeadId(leadId);
    try {
      const { data, error } = await supabase.functions.invoke('trigger-call', { body: { lead_id: leadId } });
      if (error) throw error;
      toast.success(`Call initiated (ID: ${data?.call_id || 'unknown'})`);
    } catch (e: any) {
      toast.error(`Call failed: ${e.message || 'Unknown error'}`);
    } finally {
      setCallingLeadId(null);
    }
  };

  const today = startOfDay(new Date());

  const calendarLeads: CalendarLead[] = useMemo(() => {
    if (!leads) return [];
    return leads.map(lead => {
      const pd = parsePropertyData(lead.property_data);
      const addr = pd?.address || pd?.property_address || '';
      const city = pd?.city || pd?.town || '';
      return {
        id: lead.id,
        owner_name: lead.owner_name || `Lead #${lead.id}`,
        owner_phone: lead.owner_phone,
        next_followup_date: lead.next_followup_date,
        temperature: getLeadTemperature(lead),
        callType: getCallType(lead),
        address: addr + (city ? `, ${city}` : ''),
        viability_score: lead.viability_score,
        lastCommSummary: latestComms?.[lead.id] || '',
        needsBen: needsBen(lead),
        onHold: isOnHold(lead),
        estimated_arv: lead.estimated_arv,
        deal_stage_id: lead.deal_stage_id,
        property_data: lead.property_data,
        _raw: lead,
      };
    });
  }, [leads, latestComms]);

  // Sort function for leads within a day
  const sortLeads = (dayLeads: CalendarLead[]): CalendarLead[] => {
    return [...dayLeads].sort((a, b) => {
      const tierA = getPriorityTier(a._raw, today);
      const tierB = getPriorityTier(b._raw, today);
      if (tierA !== tierB) return tierA - tierB;
      return (b.estimated_arv ?? 0) - (a.estimated_arv ?? 0);
    });
  };

  // Group leads by date string
  const leadsByDate = useMemo(() => {
    const map: Record<string, CalendarLead[]> = {};
    calendarLeads.forEach(lead => {
      const key = lead.next_followup_date;
      if (!map[key]) map[key] = [];
      map[key].push(lead);
    });
    return map;
  }, [calendarLeads]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const selectedLeads = selectedDay
    ? sortLeads(leadsByDate[format(selectedDay, 'yyyy-MM-dd')] || [])
    : [];

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
        <span>👤 = Needs your attention</span>
        <span>⏸ = On hold</span>
        <span>🔥 = Hot</span>
      </div>

      <div className="flex gap-4">
        {/* Calendar Grid */}
        <div className="flex-1 min-w-0">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-muted rounded-md">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-muted rounded-md">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
            {days.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayLeads = leadsByDate[dateKey] || [];
              const inMonth = isSameMonth(day, currentMonth);
              const isSelected = selectedDay && isSameDay(day, selectedDay);
              const overdue = dayLeads.length > 0 && isBefore(day, today) && !isSameDay(day, today);

              // Count by temperature + ben flags
              const tempCounts: Record<string, number> = {};
              let benCount = 0;
              dayLeads.forEach(l => {
                tempCounts[l.temperature] = (tempCounts[l.temperature] || 0) + 1;
                if (l.needsBen) benCount++;
              });

              return (
                <div
                  key={dateKey}
                  onClick={() => setSelectedDay(day)}
                  className={`min-h-[80px] p-1.5 cursor-pointer transition-colors ${
                    !inMonth ? 'bg-muted/50' : 'bg-background'
                  } ${isSelected ? 'ring-2 ring-primary ring-inset' : ''} ${
                    isToday(day) ? 'bg-accent/30' : ''
                  } ${overdue ? 'bg-red-50' : ''} hover:bg-muted/30`}
                >
                  <div className={`text-xs font-medium mb-1 ${
                    !inMonth ? 'text-muted-foreground/50' : isToday(day) ? 'text-primary font-bold' : 'text-foreground'
                  }`}>
                    {format(day, 'd')}
                  </div>

                  {dayLeads.length > 0 && (
                    <div className="space-y-0.5">
                      {benCount > 0 && (
                        <div className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
                          👤 {benCount}
                        </div>
                      )}
                      {Object.entries(tempCounts).map(([temp, count]) => {
                        const cfg = TEMP_CONFIG[temp];
                        if (!cfg) return null;
                        return (
                          <div key={temp} className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
                            {count}
                          </div>
                        );
                      })}
                      {overdue && (
                        <div className="text-[9px] font-semibold text-red-600">OVERDUE</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="w-96 flex-shrink-0">
          {selectedDay ? (
            <div className="border rounded-lg bg-background">
              <div className="p-3 border-b flex items-center justify-between">
                <h3 className="font-semibold text-sm">
                  {format(selectedDay, 'EEEE, MMM d')}
                  {selectedLeads.length > 0 && (
                    <Badge variant="secondary" className="ml-2">{selectedLeads.length}</Badge>
                  )}
                </h3>
                <button onClick={() => setSelectedDay(null)} className="p-1 hover:bg-muted rounded">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                {selectedLeads.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No follow-ups scheduled</p>
                ) : (
                  selectedLeads.map(lead => {
                    const cfg = TEMP_CONFIG[lead.temperature];
                    const borderColor = lead.needsBen
                      ? 'border-l-amber-400'
                      : lead.temperature === 'hot' ? 'border-l-red-500'
                      : lead.temperature === 'warm' ? 'border-l-orange-400'
                      : lead.temperature === 'cold' ? 'border-l-blue-400'
                      : 'border-l-gray-400';

                    return (
                      <div
                        key={lead.id}
                        className={`border rounded-md p-3 border-l-4 ${borderColor} ${
                          lead.onHold ? 'opacity-50 bg-gray-50' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/leads/${lead.id}`} className="font-medium text-sm text-blue-600 hover:underline">
                            {lead.owner_name}
                          </Link>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {lead.needsBen && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                                👤 Ben
                              </span>
                            )}
                            {lead.onHold && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-600">
                                ⏸ On Hold
                              </span>
                            )}
                            {cfg && !lead.onHold && (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}>
                                {cfg.label}
                              </span>
                            )}
                          </div>
                        </div>
                        {lead.address && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{lead.address}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="outline" className="text-[10px]">{lead.callType}</Badge>
                          {lead.owner_phone && (
                            <span className="flex items-center gap-1 text-[11px] text-green-600">
                              <Phone className="h-3 w-3" />
                              {lead.owner_phone}
                            </span>
                          )}
                        </div>
                        {lead.lastCommSummary && (
                          <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2">
                            {lead.lastCommSummary.length > 100 ? lead.lastCommSummary.slice(0, 97) + '...' : lead.lastCommSummary}
                          </p>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                          {/* Call Now */}
                          {lead.owner_phone && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1"
                              disabled={callingLeadId === lead.id}
                              onClick={() => triggerCall(lead.id)}
                            >
                              {callingLeadId === lead.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Phone className="h-3 w-3" />
                              )}
                              Call
                            </Button>
                          )}

                          {/* Hold toggle */}
                          <Button
                            size="sm"
                            variant="outline"
                            className={`h-7 text-[11px] gap-1 ${lead.onHold ? 'bg-amber-50' : ''}`}
                            onClick={() => toggleHold.mutate({
                              leadId: lead.id,
                              currentPd: lead.property_data,
                              currentlyOnHold: lead.onHold,
                            })}
                          >
                            {lead.onHold ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                            {lead.onHold ? 'Resume' : 'Hold'}
                          </Button>

                          {/* Reschedule */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1">
                                <CalendarDays className="h-3 w-3" />
                                Reschedule
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <CalendarPicker
                                mode="single"
                                selected={new Date(lead.next_followup_date)}
                                onSelect={(date) => {
                                  if (date) {
                                    reschedule.mutate({ leadId: lead.id, date: format(date, 'yyyy-MM-dd') });
                                  }
                                }}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="border rounded-lg bg-background p-6 text-center text-sm text-muted-foreground">
              Click a day to see scheduled follow-ups
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
