"use client";
import { type ReactNode } from "react";

// KPI Card
export function KpiCard({
  label,
  value,
  color = "blue",
  icon,
  subtitle,
}: {
  label: string;
  value: string | number;
  color?: string;
  icon?: string;
  subtitle?: string;
}) {
  const colorClass = `kpi-card-${color}`;
  return (
    <div className={`kpi-card ${colorClass} group hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {icon && (
          <div className="text-3xl opacity-30 group-hover:opacity-50 transition-opacity">{icon}</div>
        )}
      </div>
    </div>
  );
}

// Page Header
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// Data Table
export function DataTable({
  headers,
  children,
  emptyMessage,
}: {
  headers: string[];
  children: ReactNode;
  emptyMessage?: string;
}) {
  return (
    <div className="erp-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="erp-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
        {emptyMessage && (
          <div className="text-center py-8 text-slate-400 text-sm">{emptyMessage}</div>
        )}
      </div>
    </div>
  );
}

// Modal
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}) {
  if (!isOpen) return null;
  const sizeClass = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    "2xl": "max-w-6xl",
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${sizeClass} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

// Filter Bar
export function FilterBar({
  children,
  onClear,
  clearLabel,
}: {
  children: ReactNode;
  onClear: () => void;
  clearLabel: string;
}) {
  return (
    <div className="erp-card mb-6">
      <div className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          {children}
          <button onClick={onClear} className="erp-btn-ghost text-xs">
            ✕ {clearLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Badge
export function Badge({ children, color = "blue" }: { children: ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    purple: "bg-purple-100 text-purple-700",
    grey: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.blue}`}>
      {children}
    </span>
  );
}

// Empty State
export function EmptyState({ message, icon }: { message: string; icon?: string }) {
  return (
    <div className="text-center py-12">
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  );
}
