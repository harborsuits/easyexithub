import { Home } from 'lucide-react';

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="p-1.5 bg-accent rounded-lg">
        <Home className="h-5 w-5 text-accent-foreground" />
      </div>
      <div className="flex flex-col">
        <span className="font-bold text-lg leading-tight text-sidebar-foreground">Easy Exit</span>
        <span className="text-xs text-sidebar-foreground/70 leading-tight">Homes</span>
      </div>
    </div>
  );
}
