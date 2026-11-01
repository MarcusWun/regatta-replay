// Right-side collapsible panel container for Phase 2b analytics cards.
//
// Open/closed state is persisted via localStorage so the panel's layout
// survives app restarts. Width is fixed at 360 px (matches PRD §2.1); when
// collapsed the panel becomes a thin rail with a chevron button so the map
// gets the full width.
import type { ReactNode } from 'react';

export interface AnalyticsPanelProps {
  open: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
  children: ReactNode;
}

export function AnalyticsPanel({
  open,
  onToggle,
  onOpenSettings,
  children,
}: AnalyticsPanelProps) {
  if (!open) {
    return (
      <aside className="flex w-8 flex-col items-center border-l border-slate-800 bg-slate-900 py-2">
        <button
          onClick={onToggle}
          data-testid="analytics-panel-toggle"
          title="Show analytics"
          className="rounded px-1 py-2 text-slate-300 hover:bg-slate-800"
        >
          ‹
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-testid="analytics-panel"
      className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-800 bg-slate-900 p-3 text-slate-100"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-sky-300">Analytics</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            title="Settings"
            data-testid="analytics-settings"
            className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            ⚙
          </button>
          <button
            onClick={onToggle}
            title="Hide analytics"
            data-testid="analytics-panel-toggle"
            className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            ›
          </button>
        </div>
      </header>
      {children}
    </aside>
  );
}
