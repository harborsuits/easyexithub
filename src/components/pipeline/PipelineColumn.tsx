import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Lead, PipelineStage, PIPELINE_STAGES } from '@/types';
import { LeadCard } from './LeadCard';
import { cn } from '@/lib/utils';

interface PipelineColumnProps {
  stage: PipelineStage;
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
}

export function PipelineColumn({ stage, leads, onLeadClick }: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const stageConfig = PIPELINE_STAGES.find((s) => s.id === stage);

  const stageColorClass = {
    'raw': 'bg-stage-raw',
    'researched': 'bg-stage-researched',
    'contact-ready': 'bg-stage-contact-ready',
    'contacted': 'bg-stage-contacted',
    'responding': 'bg-stage-responding',
    'offer-made': 'bg-stage-offer',
    'negotiating': 'bg-stage-negotiating',
    'under-contract': 'bg-stage-contract',
    'buyer-matched': 'bg-stage-matched',
    'assigned': 'bg-stage-assigned',
    'closing': 'bg-stage-closing',
    'closed': 'bg-stage-closed',
    'dead': 'bg-stage-dead',
  }[stage];

  return (
    <div
      className={cn(
        'flex flex-col min-w-[280px] max-w-[280px] rounded-lg bg-secondary/50 transition-colors',
        isOver && 'bg-accent/10 ring-2 ring-accent/30'
      )}
    >
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', stageColorClass)} />
          <h3 className="font-semibold text-sm text-foreground">{stageConfig?.label}</h3>
          <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {leads.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto scrollbar-thin min-h-[200px] max-h-[calc(100vh-220px)]"
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">
            Drop leads here
          </div>
        )}
      </div>
    </div>
  );
}
