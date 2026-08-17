import { Atom } from "lucide-react";
import { cn } from "@/lib/utils";

export const APP_NAME = "LabEnvironment";

export function BrandMark({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 text-white shadow-lg shadow-indigo-900/20",
        className ?? "w-10 h-10",
      )}
    >
      <Atom className={iconClassName ?? "w-5 h-5"} />
    </div>
  );
}

export function BrandLockup({
  className,
  markClassName,
  nameClassName,
  subtitle,
  subtitleClassName,
}: {
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BrandMark className={markClassName} />
      <div className="min-w-0">
        <div className={cn("font-semibold tracking-tight leading-tight", nameClassName)}>{APP_NAME}</div>
        {subtitle ? (
          <div className={cn("text-xs leading-tight", subtitleClassName ?? "text-muted-foreground")}>{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "w-4 h-4"} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 13.7 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4.1H24v7.8h12.7c-.3 2.1-1.6 5.3-4.7 7.4l7.3 5.6c4.3-4 7.2-9.9 7.2-16.7z" />
      <path fill="#FBBC05" d="M10.4 28.2a14.5 14.5 0 0 1 0-8.4l-7.8-6.1a24 24 0 0 0 0 20.6l7.8-6.1z" />
      <path fill="#34A853" d="M24 47.5c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.6c-2 1.4-4.7 2.4-8.6 2.4-6.4 0-11.7-4.2-13.6-10.3l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z" />
    </svg>
  );
}
