import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Modal({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; className?: string }) {
  useEffect(() => { if (!open) return; const close=(event:KeyboardEvent)=>{if(event.key==="Escape") onClose()}; document.addEventListener("keydown",close); return()=>document.removeEventListener("keydown",close); },[open,onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} aria-label="Close dialog"/><div className={cn("relative z-10 max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-white shadow-2xl",className)}><div className="flex items-start justify-between border-b px-5 py-4"><div><h2 id="modal-title" className="font-semibold text-slate-900">{title}</h2>{description&&<p className="mt-1 text-xs text-slate-500">{description}</p>}</div><Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0"><X className="h-4 w-4"/></Button></div>{children}</div></div>;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel="Delete", loading=false }: { open:boolean; onClose:()=>void; onConfirm:()=>void; title:string; description:string; confirmLabel?:string; loading?:boolean }) {
  return <Modal open={open} onClose={onClose} title={title} className="max-w-md"><div className="px-5 py-4 text-sm text-slate-600">{description}</div><div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3"><Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button><Button variant="destructive" onClick={onConfirm} disabled={loading}>{loading?"Processing...":confirmLabel}</Button></div></Modal>;
}

export function FieldError({ children }: { children?: string }) { return children ? <p className="mt-1 text-xs text-red-600">{children}</p> : null; }
