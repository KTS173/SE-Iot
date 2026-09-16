import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutDashboard, LogOut, Radio, Settings, Users } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { clearUser, getUser, type User } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { mockRole, permissions } from "@/lib/roles";

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, visible: true },
  { label: "Sensors", to: "/sensors", icon: Radio, visible: permissions.canManageSensors },
  { label: "Members", to: "/members", icon: Users, visible: permissions.canViewMembers },
] as const;

export function AppShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const current = getUser();
    if (!current) navigate({ to: "/signin" });
    else setUser(current);
  }, [navigate]);
  if (!user) return null;
  const logout = () => { clearUser(); toast.success("Signed out"); navigate({ to: "/signin" }); };
  const linkClass = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";
  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#0b1739] text-white xl:flex">
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5"><BrandMark className="h-10 w-10 rounded-lg shadow-none" iconClassName="h-5 w-5"/><div><p className="text-sm font-bold">Lab Environment</p><p className="text-xs text-blue-200/70">Monitor</p></div></div>
      <nav className="flex-1 space-y-1.5 px-3 py-6" aria-label="Main navigation">{navigation.filter(item => item.visible).map(({label,to,icon:Icon})=><Link key={to} to={to} className={linkClass} activeProps={{className: cn(linkClass,"bg-blue-600 text-white shadow-sm")}} inactiveProps={{className: cn(linkClass,"text-slate-300 hover:bg-white/10 hover:text-white")}}><Icon className="h-[18px] w-[18px]"/>{label}</Link>)}</nav>
      <div className="border-t border-white/10 px-3 py-4"><Link to="/settings" className={linkClass} activeProps={{className:cn(linkClass,"bg-blue-600 text-white")}} inactiveProps={{className:cn(linkClass,"text-slate-300 hover:bg-white/10 hover:text-white")}}><Settings className="h-[18px] w-[18px]"/>Settings</Link></div>
    </aside>
    <div className="min-w-0 xl:ml-60">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6"><div><h1 className="text-xl font-bold tracking-tight">{title}</h1><p className="hidden text-xs text-slate-500 sm:block">{subtitle}</p></div><div className="flex items-center gap-3"><div className="hidden text-right leading-tight sm:block"><p className="text-sm font-semibold">{user.name}</p><p className="text-[11px] capitalize text-slate-500">{mockRole}</p></div><div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{user.name.charAt(0).toUpperCase()}</div><Button variant="ghost" size="sm" onClick={logout} aria-label="Log out"><LogOut className="h-4 w-4"/></Button></div></header>
      <main className="p-3 pb-20 sm:p-4 sm:pb-20 xl:p-5 xl:pb-5">{children}</main>
    </div>
    <MobileNavigation />
  </div>;
}

export function MobileNavigation() {
  const mobileLinkClass = "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-2 py-2 text-[10px] font-medium transition-colors";
  return <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-[#0b1739] px-1 pb-[env(safe-area-inset-bottom)] xl:hidden" aria-label="Mobile navigation">{navigation.filter(item => item.visible).map(({label,to,icon:Icon})=><Link key={to} to={to} className={mobileLinkClass} activeProps={{className:cn(mobileLinkClass,"bg-blue-600 text-white")}} inactiveProps={{className:cn(mobileLinkClass,"text-slate-300")}}><Icon className="h-5 w-5"/><span className="truncate">{label}</span></Link>)}<Link to="/settings" className={mobileLinkClass} activeProps={{className:cn(mobileLinkClass,"bg-blue-600 text-white")}} inactiveProps={{className:cn(mobileLinkClass,"text-slate-300")}}><Settings className="h-5 w-5"/><span>Settings</span></Link></nav>;
}
