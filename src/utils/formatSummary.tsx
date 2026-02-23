import React from 'react';

/**
 * Parse a structured communication summary into bold-labeled lines.
 * Input format (from edge function):
 *   "Outcome: callback (hot)\nWants $330,000 | Owes $120,000\nCondition: ..."
 * Output: JSX with bold labels before the colon.
 */
export function FormattedSummary({ text }: { text: string }) {
  if (!text) return <span className="text-muted-foreground">—</span>;

  const lines = text.split('\n').filter(l => l.trim());

  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        // Check for "Label: value" pattern
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
          const label = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim();
          
          // Handle "Wants $X | Owes $Y" lines (no label prefix)
          if (label.startsWith('Wants') || label.startsWith('$')) {
            return <p key={i} className="text-xs text-muted-foreground">{formatPriceSegments(line)}</p>;
          }

          return (
            <p key={i} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{label}:</span> {value}
            </p>
          );
        }
        
        // Lines with pipe separators (e.g. "Wants $330,000 | Owes $120,000")
        if (line.includes(' | ')) {
          return <p key={i} className="text-xs text-muted-foreground">{formatPriceSegments(line)}</p>;
        }

        // Plain text line
        return <p key={i} className="text-xs text-muted-foreground">{line}</p>;
      })}
    </div>
  );
}

function formatPriceSegments(line: string): React.ReactNode {
  const segments = line.split(' | ');
  return (
    <>
      {segments.map((seg, i) => {
        const trimmed = seg.trim();
        const colIdx = trimmed.indexOf(' ');
        // Try to bold the first word as a label (e.g. "Wants", "Owes")
        if (colIdx > 0 && /^[A-Z]/.test(trimmed)) {
          const label = trimmed.slice(0, colIdx);
          const rest = trimmed.slice(colIdx);
          return (
            <React.Fragment key={i}>
              {i > 0 && <span className="mx-1 text-muted-foreground/50">|</span>}
              <span className="font-semibold text-foreground">{label}</span>{rest}
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className="mx-1 text-muted-foreground/50">|</span>}
            {trimmed}
          </React.Fragment>
        );
      })}
    </>
  );
}
