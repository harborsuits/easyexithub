import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { ChevronDown, ChevronUp, PhoneCall, PhoneMissed, PhoneIncoming, Voicemail, Ban, AlertCircle, Clock } from 'lucide-react';
import { FormattedSummary } from '@/utils/formatSummary';

interface ActivityCardProps {
  call: {
    id: number;
    lead_id: number;
    lead_name: string;
    property_address?: string;
    contact_date?: string;
    contact_time?: string;
    created_at: string;
    outcome?: string;
    outcome_label?: string;
    disposition?: string;
    disposition_label?: string;
    summary?: string;
    duration_minutes?: number;
    duration_seconds?: number;
    notes?: any;
    transcript?: string;
    direction?: string;
    phone_number?: string;
    owner_name?: string;
    metadata?: any;
  };
  distressSignals?: string[];
  callHistory?: Array<{
    date: string;
    time?: string;
    outcome: string;
    direction: string;
  }>;
  leadTemperature?: string;
  nextAction?: {
    type: string;
    label: string;
    date?: string;
  };
}

const OUTCOME_ICONS: Record<string, any> = {
  dnc: Ban,
  not_interested: AlertCircle,
  voicemail: Voicemail,
  no_answer: PhoneMissed,
  interested: PhoneCall,
  callback: PhoneIncoming,
  connected: PhoneCall,
};

const OUTCOME_COLORS: Record<string, string> = {
  dnc: 'border-red-600 bg-red-50',
  not_interested: 'border-orange-500 bg-orange-50',
  voicemail: 'border-gray-500 bg-gray-50',
  no_answer: 'border-gray-400 bg-gray-50',
  interested: 'border-green-600 bg-green-50',
  callback: 'border-amber-500 bg-amber-50',
  connected: 'border-blue-500 bg-blue-50',
};

const TEMP_ICONS: Record<string, string> = {
  hot: '🔥',
  warm: '🌡️',
  cold: '🧊',
  dnc: '🚫',
  dead: '☠️',
};

const DISTRESS_LABELS: Record<string, string> = {
  probate_open: 'Probate open',
  long_ownership_25plus: 'Long ownership (25+ years)',
  tax_delinquent: 'Tax delinquent',
  code_violations: 'Code violations',
  foreclosure: 'Foreclosure',
  divorce: 'Divorce',
  vacant: 'Vacant property',
  absentee_owner: 'Absentee owner',
};

export function ActivityCard({ call, distressSignals, callHistory, leadTemperature, nextAction }: ActivityCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Determine outcome for styling
  const outcome = call.disposition || call.outcome || 'unknown';
  const outcomeLabel = call.disposition_label || call.outcome_label || outcome.replace(/_/g, ' ');
  
  // Parse metadata
  const metadata = call.metadata || {};
  const structuredData = metadata.structured_data || {};
  
  // Parse notes
  const parseNotes = (notes: any) => {
    if (!notes) return {};
    if (typeof notes === 'string') {
      try { return JSON.parse(notes); } catch { return { text: notes }; }
    }
    return notes;
  };
  
  const notes = parseNotes(call.notes);
  const hasTranscript = call.transcript || notes?.transcript;
  const transcript = call.transcript || notes?.transcript;
  
  // Get icon and color
  const OutcomeIcon = OUTCOME_ICONS[outcome] || PhoneCall;
  const cardColor = OUTCOME_COLORS[outcome] || 'border-gray-300 bg-white';
  
  // Determine if this is a collapsed voicemail
  const isVoicemail = outcome === 'voicemail';
  const isDNC = outcome === 'dnc' || outcome === 'not_interested';
  
  // Format timestamp
  const formatTimestamp = () => {
    const date = call.contact_date || new Date(call.created_at).toISOString().split('T')[0];
    const time = call.contact_time?.slice(0, 5) || new Date(call.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const dateObj = new Date(date);
    const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
    const day = dateObj.getDate();
    return `${month} ${day} • ${time}`;
  };
  
  // Get temperature badge
  const tempIcon = TEMP_ICONS[leadTemperature?.toLowerCase() || 'cold'];
  const tempLabel = leadTemperature || (outcome === 'dnc' ? 'DNC' : 'Cold');
  
  // Voicemail collapsed view
  if (isVoicemail && !isExpanded) {
    return (
      <Card className={`border-l-4 ${cardColor} transition-all hover:shadow-md cursor-pointer`} onClick={() => setIsExpanded(true)}>
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Voicemail className="h-5 w-5 text-gray-500" />
              <div>
                <Link to={`/leads/${call.lead_id}`} className="font-semibold text-foreground hover:text-blue-600" onClick={(e) => e.stopPropagation()}>
                  {call.owner_name || call.lead_name}
                </Link>
                <p className="text-xs text-muted-foreground">Voicemail left</p>
                {nextAction && <p className="text-xs text-muted-foreground mt-1">Follow-up {nextAction.label}</p>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{formatTimestamp()}</p>
            </div>
          </div>
        </div>
      </Card>
    );
  }
  
  return (
    <Card className={`border-l-4 ${cardColor} transition-all`}>
      <div className="p-4 space-y-3">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <OutcomeIcon className={`h-5 w-5 flex-shrink-0 ${isDNC ? 'text-red-600' : 'text-blue-500'}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link to={`/leads/${call.lead_id}`} className="font-semibold text-foreground hover:text-blue-600">
                  {call.owner_name || call.lead_name}
                </Link>
                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium uppercase ${
                  isDNC ? 'bg-red-100 text-red-800' :
                  outcome === 'interested' ? 'bg-green-100 text-green-800' :
                  outcome === 'callback' ? 'bg-amber-100 text-amber-800' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {outcomeLabel}
                </span>
              </div>
              {call.property_address && (
                <p className="text-sm text-muted-foreground mt-0.5">{call.property_address}</p>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp()}</p>
            <p className="text-lg mt-1" title={tempLabel}>{tempIcon} {tempLabel}</p>
          </div>
        </div>
        
        {/* What Happened */}
        {call.summary && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What Happened</p>
            <div className="text-sm">
              <FormattedSummary text={call.summary} />
            </div>
          </div>
        )}
        
        {/* Signals Grid */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Signals</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Interest:</span>{' '}
              <span className="font-medium">
                {structuredData.motivation_level ? 
                  structuredData.motivation_level === 0 || structuredData.motivation_level === 1 ? '❌ None' : 
                  structuredData.motivation_level >= 7 ? '🔥 High' :
                  structuredData.motivation_level >= 4 ? '🌡️ Medium' : '🧊 Low'
                : '—'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Timeline:</span>{' '}
              <span className="font-medium">{structuredData.timeline || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Condition:</span>{' '}
              <span className="font-medium">{structuredData.property_condition || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Price:</span>{' '}
              <span className="font-medium">{structuredData.price_expectations || 'Unknown'}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Temperature:</span>{' '}
              <span className="font-medium">{tempIcon} {tempLabel}</span>
            </div>
          </div>
        </div>
        
        {/* Distress Signals */}
        {distressSignals && distressSignals.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Distress Signals</p>
            <ul className="text-sm space-y-0.5">
              {distressSignals.map((signal, idx) => (
                <li key={idx} className="text-orange-700">• {DISTRESS_LABELS[signal] || signal}</li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Call History */}
        {callHistory && callHistory.length > 1 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Call History</p>
            <div className="text-xs space-y-1">
              {callHistory.slice(0, 3).map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-muted-foreground">{entry.date} {entry.time && `• ${entry.time}`}</span>
                  <span>{entry.direction === 'inbound' ? '📞' : '📬'} {entry.outcome.replace(/_/g, ' ')}</span>
                </div>
              ))}
              {callHistory.length > 3 && (
                <p className="text-muted-foreground italic">+ {callHistory.length - 3} more</p>
              )}
            </div>
          </div>
        )}
        
        {/* Next Action */}
        {nextAction && (
          <div className="space-y-1 pt-2 border-t">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Action</p>
            <div className={`inline-flex items-center gap-2 px-3 py-2 rounded font-medium ${
              isDNC ? 'bg-red-100 text-red-800' :
              nextAction.type === 'callback' ? 'bg-amber-100 text-amber-800' :
              'bg-blue-100 text-blue-800'
            }`}>
              {isDNC ? '🚫' : nextAction.type === 'callback' ? '🔁' : '📞'}
              <span>{nextAction.label}</span>
              {nextAction.date && <span className="text-sm opacity-75">• {nextAction.date}</span>}
            </div>
          </div>
        )}
        
        {/* Call Details */}
        {(call.duration_minutes != null || call.duration_seconds != null || notes?.cost != null) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
            {(call.duration_minutes != null || call.duration_seconds != null) && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {call.duration_minutes != null ? `${call.duration_minutes}m` : `${call.duration_seconds}s`}
              </span>
            )}
            {notes?.cost != null && <span>${Number(notes.cost).toFixed(2)}</span>}
            {call.direction && <span className="capitalize">{call.direction}</span>}
          </div>
        )}
        
        {/* Transcript Toggle */}
        {hasTranscript && (
          <>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline pt-2 border-t w-full"
            >
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {isExpanded ? 'Hide transcript' : 'Show transcript'}
            </button>
            {isExpanded && (
              <div className="bg-muted rounded p-3 text-xs max-h-64 overflow-auto whitespace-pre-wrap font-mono">
                {typeof transcript === 'string' ? transcript : JSON.stringify(transcript, null, 2)}
              </div>
            )}
          </>
        )}
        
      </div>
    </Card>
  );
}
