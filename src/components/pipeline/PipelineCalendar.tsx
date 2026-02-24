import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Flame, Snowflake, ThermometerSun, Skull, Phone, ChevronLeft, ChevronRight, X } from 'lucide-react';
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
  const pd = lead.property_data as Record<string, any> | null;
  if (pd?.lead_temperature) return pd.lead_temperature;
  if (lead.viability_score >= 70) return 'hot';
  if (lead.viability_score >= 40) return 'warm';
  return 'cold';
}

function getCallType(lead: any): string {
  if (lead.outreach_count === 0) return 'cold call';
  const pd = lead.property_data as Record<string, any> | null;
  if (pd?.next_action?.toLowerCase().includes('offer')) return 'offer';
  return 'follow-up';
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
}

export function PipelineCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const { data: leads } = useQuery({
    queryKey: ['calendar-leads'],
    queryFn: async () => {
      const { data } = await supabase
        .from('leads')
        .select('id, owner_name, owner_phone, next_followup_date, deal_stage_id, viability_score, status, property_data, outreach_count')
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

  const calendarLeads: CalendarLead[] = useMemo(() => {
    if (!leads) return [];
    return leads.map(lead => {
      const pd = lead.property_data as Record<string, any> | null;
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
      };
    });
  }, [leads, latestComms]);

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
  const today = startOfDay(new Date());

  const selectedLeads = selectedDay
    ? leadsByDate[format(selectedDay, 'yyyy-MM-dd')] || []
    : [];

  return (
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

            // Count by temperature
            const tempCounts: Record<string, number> = {};
            dayLeads.forEach(l => {
              tempCounts[l.temperature] = (tempCounts[l.temperature] || 0) + 1;
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
      <div className="w-80 flex-shrink-0">
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
                  return (
                    <div key={lead.id} className={`border rounded-md p-3 ${cfg ? `border-l-4 border-l-${lead.temperature === 'hot' ? 'red-500' : lead.temperature === 'warm' ? 'orange-400' : lead.temperature === 'cold' ? 'blue-400' : 'gray-400'}` : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/leads/${lead.id}`} className="font-medium text-sm text-blue-600 hover:underline">
                          {lead.owner_name}
                        </Link>
                        {cfg && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        )}
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
  );
}
