import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Clock, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { BrandLockup } from "@/components/brand";
import { useLogout } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { homeFor, refreshUser, requirePending, useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/pending")({
  head: () => ({ meta: [{ title: "Waiting for approval — LabEnvironment" }] }),
  beforeLoad: requirePending,
  component: PendingPage,
});

function PendingPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const logout = useLogout();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    const latest = await refreshUser();
    setChecking(false);
    if (latest?.status === "active") {
      toast.success("Your account has been approved");
      navigate({ to: homeFor(latest) });
    } else {
      toast.info("Still waiting for an admin to approve your account");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <Card className="w-full max-w-md p-8 rounded-2xl shadow-xl border-indigo-100 text-center">
        <div className="flex justify-center mb-6">
          <BrandLockup markClassName="w-9 h-9" nameClassName="text-slate-900" />
        </div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Waiting for approval</h1>
        <p className="mt-2 text-sm text-slate-600">
          Hi {user?.name}, your account has been created. A lab admin needs to approve it
          before you can see the dashboard.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={logout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
          <Button onClick={checkAgain} disabled={checking} className="gap-2 bg-blue-600 hover:bg-blue-700">
            <RefreshCw className={checking ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Check again
          </Button>
        </div>
      </Card>
    </div>
  );
}
