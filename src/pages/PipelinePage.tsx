import { AppLayout } from '@/components/common/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { useState } from 'react';

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

export function PipelinePage() {
  const queryClient = useQueryClient();
  const [draggedLead, setDraggedLead] = useState<number | null>(null);

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
      const { data } = await supabase.from('leads').select('id, owner_name, owner_phone, deal_stage_id, viability_score, market_id, status');
      return data || [];
    },
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

  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-4">
        <h1 className="text-3xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground">Drag leads between stages to update</p>

        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '70vh' }}>
          {stages?.map((stage) => {
            const stageLeads = leads?.filter((l) => l.deal_stage_id === stage.id) || [];
            const colorClass = STAGE_COLORS[stage.name] || 'bg-muted border-border';

            return (
              <div
                key={stage.id}
                className={`flex-shrink-0 w-64 rounded-lg border-2 ${colorClass} flex flex-col`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage.id)}
              >
                <div className="p-3 border-b font-semibold text-sm flex items-center justify-between">
                  <span className="capitalize">{stage.name.replace('_', ' ')}</span>
                  <Badge variant="secondary">{stageLeads.length}</Badge>
                </div>

                <div className="p-2 space-y-2 flex-1 overflow-y-auto" style={{ maxHeight: '60vh' }}>
                  {stageLeads.slice(0, 25).map((lead: any) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDraggedLead(lead.id)}
                      className="bg-white rounded-md border p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition"
                    >
                      <Link to={`/leads/${lead.id}`} className="font-medium text-sm text-blue-600 hover:underline block">
                        {lead.owner_name || `Lead #${lead.id}`}
                      </Link>
                      {lead.owner_phone && <p className="text-xs text-muted-foreground mt-1">{lead.owner_phone}</p>}
                      <div className="flex items-center justify-between mt-2">
                        {lead.viability_score != null && (
                          <Badge variant="outline" className="text-[10px]">Score: {lead.viability_score}</Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground capitalize">{lead.status || '—'}</span>
                      </div>
                    </div>
                  ))}
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
        </div>
      </div>
    </AppLayout>
  );
}
