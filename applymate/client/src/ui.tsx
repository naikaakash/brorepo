import { cloneElement, useId } from "react";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { AlertCircle, Check, LoaderCircle, Sparkles } from "lucide-react";
import type { Workspace } from "@applymate/contracts";

export interface PageProps { data: Workspace; refresh: () => Promise<void>; navigate: (path: string) => void }
export function Brand() {
  return <span className="brand"><span className="brand-mark"><Sparkles size={24} aria-hidden="true" /></span>apply<span className="brand-accent">mate</span><span className="brand-dot">.</span></span>;
}
export function Button({ children, loading, className = "", onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return <button type="button" {...props} className={`button ${className}`} aria-disabled={loading || props.disabled || undefined}
    onClick={(event) => { if (loading) { event.preventDefault(); return; } onClick?.(event); }}>
    {loading && <LoaderCircle className="spin" size={17} aria-hidden="true" />}{children}
  </button>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<{ id?: string; "aria-describedby"?: string }> }) {
  const generated = useId();
  const id = children.props.id ?? generated;
  return <div className="field"><label htmlFor={id}>{label}</label>
    {cloneElement(children, { id, "aria-describedby": hint ? `${id}-hint` : children.props["aria-describedby"] })}
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </div>;
}
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" | "warning" }) {
  return <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
    {tone === "success" ? <Check size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
    <div>{children}</div>
  </div>;
}
export function Badge({ children, tone = "" }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1 tabIndex={-1}>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Sparkles aria-hidden="true" /></span><h2>{title}</h2><p>{children}</p>{action}</div>;
}
