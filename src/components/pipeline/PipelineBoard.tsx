import { useState, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { Lead, PipelineStage, PIPELINE_STAGES } from '@/types';
import { useCRM } from '@/context/CRMContext';
import { PipelineColumn } from './PipelineColumn';
import { LeadCard } from './LeadCard';

interface PipelineBoardProps {
  onLeadClick: (lead: Lead) => void;
}

export function PipelineBoard({ onLeadClick }: PipelineBoardProps) {
  const { leads, updateLeadStage } = useCRM();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const leadId = active.id as string;
      const newStage = over.id as PipelineStage;

      // Check if dropped on a valid stage
      if (PIPELINE_STAGES.some((s) => s.id === newStage)) {
        updateLeadStage(leadId, newStage);
      }
    },
    [updateLeadStage]
  );

  const getLeadsByStage = (stage: PipelineStage) => {
    return leads.filter((lead) => lead.stage === stage);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
        {PIPELINE_STAGES.map((stage) => (
          <PipelineColumn
            key={stage.id}
            stage={stage.id}
            leads={getLeadsByStage(stage.id)}
            onLeadClick={onLeadClick}
          />
        ))}
      </div>

      <DragOverlay>
        {activeLead && (
          <div className="rotate-3 scale-105">
            <LeadCard lead={activeLead} onClick={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
