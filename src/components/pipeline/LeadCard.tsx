import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Lead } from '@/types';
import { formatCurrency } from '@/data/mockData';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, DollarSign, Calculator } from 'lucide-react';

interface LeadCardProps {
  lead: Lead;
  onClick: () => void;
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="p-3 cursor-grab active:cursor-grabbing bg-card hover:shadow-md transition-shadow border border-border"
      onClick={onClick}
    >
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium text-sm text-foreground truncate">{lead.address}</p>
            <p className="text-xs text-muted-foreground">
              {lead.city}, {lead.state}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="font-normal">
            {lead.beds}bd / {lead.baths}ba
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {lead.sqft.toLocaleString()} sqft
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          {lead.arv > 0 && (
            <div className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-accent" />
              <span className="text-xs font-medium text-foreground">
                ARV: {formatCurrency(lead.arv)}
              </span>
            </div>
          )}
          {lead.mao > 0 && (
            <div className="flex items-center gap-1">
              <Calculator className="h-3 w-3 text-accent" />
              <span className="text-xs font-medium text-foreground">
                MAO: {formatCurrency(lead.mao)}
              </span>
            </div>
          )}
        </div>

        {lead.offerAmount && lead.offerAmount > 0 && (
          <div className="pt-1 border-t border-border">
            <Badge className="bg-accent text-accent-foreground text-xs">
              Offer: {formatCurrency(lead.offerAmount)}
            </Badge>
          </div>
        )}
      </div>
    </Card>
  );
}
