import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Flame, Snowflake, ThermometerSun, Skull, Phone, Mail, Clock, ArrowRight, LayoutGrid, CalendarDays } from 'lucide-react';
import { PipelineCalendar } from '@/components/pipeline/PipelineCalendar';

const STAGE_COLORS: Record<string, string> = {
  raw_lead: 'bg-slate-100 border-slate-300',
  contacted: 'bg-blue-50 border-blue-300',
  interested: 'bg-purple-50 border-purple-300',
  offer_made: 'bg-yellow-50 border-yellow-300',
  under_contract: 'bg-green-50 border-green-300',
  assigned: 'bg-emerald-50 border-emerald-300',
  closed_won: 'bg-green-100 border-green-400',
  closed_lost: 'bg-red-50 border-red-300',
  dead: 'bg-gray-100 border-gray-300',
};

const TEMP_CONFIG: Record<string, { icon: any; color: string; bg: string; border: string; label: string }> = {
  hot: { icon: Flame, color: 'text-red-600', bg: 'bg-red-50', border: 'border-l-red-500', label: '🔥 Hot' },
  warm: { icon: ThermometerSun, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-l-orange-400', label: '🌡️ Warm' },
  cold: { icon: Snowflake, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-l-blue-400', label: '❄️ Cold' },
  dead: { icon: Skull, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-l-gray-400', label: '💀 Dead' },
};

function getTemperature(lead: any, latestComm: any): string {
  const pd = lead.property_data as Record<string, any> | null;
  // Explicit temperature set by pipeline
  if (pd?.lead_temperature) return pd.lead_temperature;

  // Derive from latest communication outcome
  if (latestComm) {
    const outcome = latestComm.outcome;
    if (outcome === 'interested' || outcome === 'callback') return 'warm';
    if (outcome === 'not_interested') return 'cold';
    if (outcome === 'no_answer' || outcome === 'voicemail') return 'cold';
  }

  // Derive from lead status
  if (lead.status === 'dead' || lead.status === 'closed_lost') return 'dead';
  if (lead.status === 'interested' || lead.status === 'offer_made') return 'hot';
  if (lead.status === 'contacted') return 'warm';

  return ''; // no temperature for unworked leads
}

function getNextAction(lead: any, latestComm: any): string {
  const pd = lead.property_data as Record<string, any> | null;
  if (pd?.next_action) return pd.next_action;

  if (!latestComm && lead.owner_phone) return 'Initial outreach needed';
  if (latestComm?.outcome === 'interested') return 'Send offer / follow up';
  if (latestComm?.outcome === 'callback') return 'Scheduled callback';
  if (latestComm?.outcome === 'no_answer') return 'Try again';
  if (latestComm?.outcome === 'voicemail') return 'Follow up call';
  if (lead.next_followup_date) {
    const d = new Date(lead.next_followup_date);
    const now = new Date();
    if (d <= now) return 'Follow-up overdue!';
    return `Follow up ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  return '';
}

function getCallSummary(lead: any, latestComm: any): string {
  const pd = lead.property_data as Record<string, any> | null;
  if (pd?.last_call_summary) return pd.last_call_summary;
  if (latestComm?.summary) {
    // Truncate to ~80 chars
    const s = latestComm.summary;
    return s.length > 80 ? s.substring(0, 77) + '...' : s;
  }
  return '';
}

export function PipelinePage() {
  const queryClient = useQueryClient();
  const [draggedLead, setDraggedLead] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'board' | 'calendar'>('board');

  const { data: stages } = useQuery({
    queryKey: ['deal-stages'],
    queryFn: async () => {
      const { data } = await supabase.from('deal_stages').select('id, name').order('id');
      return data || [];
    },
  });

  const { data: leads } = useQuery({
    queryKey: ['leads-pipeline'],
    queryFn: async () => {
      const { data } = await supabase.from('leads').select(
        'id, owner_name, owner_phone, owner_email, deal_stage_id, viability_score, status, property_data, next_followup_date, last_contact_date, outreach_count, motivation_type'
      );
      return data || [];
    },
  });

  // Fetch latest communication per lead (for leads that have been contacted)
  const contactedLeadIds = leads?.filter(l => l.deal_stage_id && l.deal_stage_id > 6).map(l => l.id) || [];
  const { data: latestComms } = useQuery({
    queryKey: ['latest-comms-pipeline', contactedLeadIds.join(',')],
    queryFn: async () => {
      if (contactedLeadIds.length === 0) return {};
      const { data } = await supabase
        .from('communications')
        .select('id, lead_id, outcome, summary, communication_type_id, contact_date')
        .in('lead_id', contactedLeadIds)
        .order('created_at', { ascending: false });
      // Group by lead_id, take latest
      const map: Record<number, any> = {};
      data?.forEach(c => { if (!map[c.lead_id]) map[c.lead_id] = c; });
      return map;
    },
    enabled: contactedLeadIds.length > 0,
  });

  const moveLead = useMutation({
    mutationFn: async ({ leadId, stageId }: { leadId: number; stageId: number }) => {
      const { error } = await supabase.from('leads').update({ deal_stage_id: stageId }).eq('id', leadId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads-pipeline'] }),
  });

  const handleDrop = (stageId: number) => {
    if (draggedLead) {
      moveLead.mutate({ leadId: draggedLead, stageId });
      setDraggedLead(null);
    }
  };

  const commTypeIcon = (typeId: number) => {
    if (typeId === 1) return <Phone className="h-3 w-3" />;
    if (typeId === 2) return <Phone className="h-3 w-3" />;
    if (typeId === 3) return <Mail className="h-3 w-3" />;
    return <Clock className="h-3 w-3" />;
  };

  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pipeline</h1>
            <p className="text-muted-foreground">
              {activeTab === 'board'
                ? 'Drag leads between stages · Temperature shows conversation direction'
                : 'Scheduled follow-ups and callbacks'}
            </p>
          </div>
          <div className="flex items-center bg-muted rounded-lg p-1">
            <button
              onClick={() => setActiveTab('board')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'board' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              Board
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'calendar' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              Calendar
            </button>
          </div>
        </div>

        {activeTab === 'calendar' && <PipelineCalendar />}

        {activeTab === 'board' && <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '70vh' }}>
          {stages?.map((stage) => {
            const stageLeads = leads?.filter((l) => l.deal_stage_id === stage.id) || [];
            const colorClass = STAGE_COLORS[stage.name] || 'bg-muted border-border';

            return (
              <div
                key={stage.id}
                className={`flex-shrink-0 w-72 rounded-lg border-2 ${colorClass} flex flex-col`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage.id)}
              >
                <div className="p-3 border-b font-semibold text-sm flex items-center justify-between">
                  <span className="capitalize">{stage.name.replace(/_/g, ' ')}</span>
                  <Badge variant="secondary">{stageLeads.length}</Badge>
                </div>

                <div className="p-2 space-y-2 flex-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                  {stageLeads.slice(0, 25).map((lead: any) => {
                    const comm = latestComms?.[lead.id];
                    const temp = getTemperature(lead, comm);
                    const tempCfg = temp ? TEMP_CONFIG[temp] : null;
                    const nextAction = getNextAction(lead, comm);
                    const callSummary = getCallSummary(lead, comm);
                    const pd = lead.property_data as Record<string, any> | null;
                    const addr = pd?.address || pd?.property_address || '';
                    const city = pd?.city || pd?.town || '';

                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => setDraggedLead(lead.id)}
                        className={`bg-white rounded-md border p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition ${tempCfg ? `border-l-4 ${tempCfg.border}` : ''}`}
                      >
                        {/* Header: Name + Temperature */}
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/leads/${lead.id}`} className="font-medium text-sm text-blue-600 hover:underline block leading-tight">
                            {lead.owner_name || `Lead #${lead.id}`}
                          </Link>
                          {tempCfg && (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${tempCfg.bg} ${tempCfg.color}`}>
                              {tempCfg.label}
                            </span>
                          )}
                        </div>

                        {/* Property address */}
                        {(addr || city) && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {addr}{city ? `, ${city}` : ''}
                          </p>
                        )}

                        {/* Call summary - the meat */}
                        {callSummary && (
                          <p className="text-[11px] text-gray-600 mt-1.5 leading-snug line-clamp-2">
                            {callSummary}
                          </p>
                        )}

                        {/* Latest comm indicator */}
                        {comm && (
                          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                            {commTypeIcon(comm.communication_type_id)}
                            <span>{comm.contact_date}</span>
                            {comm.outcome && (
                              <span className={`px-1 py-0.5 rounded font-medium ${
                                comm.outcome === 'interested' ? 'bg-green-100 text-green-700' :
                                comm.outcome === 'callback' ? 'bg-blue-100 text-blue-700' :
                                comm.outcome === 'not_interested' ? 'bg-red-100 text-red-700' :
                                comm.outcome === 'no_answer' ? 'bg-slate-100 text-slate-600' :
                                'bg-gray-100 text-gray-600'
                              }`}>{comm.outcome.replace(/_/g, ' ')}</span>
                            )}
                          </div>
                        )}

                        {/* Next action */}
                        {nextAction && (
                          <div className="flex items-center gap-1 mt-1.5 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            <ArrowRight className="h-2.5 w-2.5" />
                            <span className="truncate">{nextAction}</span>
                          </div>
                        )}

                        {/* Footer: Score + contact info indicators */}
                        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-gray-100">
                          <div className="flex items-center gap-1.5">
                            {lead.viability_score != null && (
                              <Badge variant="outline" className={`text-[10px] ${
                                lead.viability_score >= 70 ? 'border-green-300 text-green-700' :
                                lead.viability_score >= 40 ? 'border-amber-300 text-amber-700' :
                                'border-gray-300 text-gray-500'
                              }`}>
                                {lead.viability_score}
                              </Badge>
                            )}
                            {lead.outreach_count > 0 && (
                              <span className="text-[10px] text-muted-foreground">{lead.outreach_count}× contacted</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {lead.owner_phone && <Phone className="h-3 w-3 text-green-500" />}
                            {lead.owner_email && <Mail className="h-3 w-3 text-blue-500" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {stageLeads.length > 25 && (
                    <Link to="/leads" className="block text-xs text-blue-600 hover:underline text-center py-2">
                      +{stageLeads.length - 25} more → View in Leads
                    </Link>
                  )}
                  {stageLeads.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No leads</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>}
      </div>
    </AppLayout>
  );
}
