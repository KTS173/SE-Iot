import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { setUser } from "@/lib/auth";
import { toast } from "sonner";
import { BrandLockup, GoogleIcon } from "@/components/brand";
// Swap this import to replace the left panel background image.
import panelImage from "@/assets/quantum-panel.jpg";

export const Route = createFileRoute("/signin")({
  head: () => ({
    meta: [
      { title: "Sign In — LabEnvironment" },
      { name: "description", content: "Sign in to LabEnvironment, the laboratory temperature and humidity monitoring system." },
      { property: "og:title", content: "Sign In — LabEnvironment" },
      { property: "og:description", content: "Secure access to real-time laboratory sensor monitoring." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) {
      toast.error("Please fill in all fields");
      return;
    }
    setUser({
      name: identifier.includes("@") ? identifier.split("@")[0] : identifier,
      email: identifier.includes("@") ? identifier : `${identifier}@lab.local`,
      username: identifier,
    });
    toast.success("Welcome back");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Left branded panel */}
      <div className="hidden lg:flex flex-1 relative flex-col justify-between p-12 text-white overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${panelImage})` }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#080d2b]/90 via-[#141c55]/80 to-[#33165e]/90" aria-hidden="true" />

        <div className="relative z-10">
          <BrandLockup markClassName="w-11 h-11" nameClassName="text-white text-lg" subtitle="Quantum Lab Monitoring" subtitleClassName="text-xs text-blue-100/70" />
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl font-bold leading-tight">Real-time laboratory<br />climate intelligence.</h1>
          <p className="mt-4 text-blue-50/85 max-w-md">
            Monitor temperature and humidity across six sensor points within a single laboratory room from one secure dashboard.
          </p>
        </div>
        <div className="relative z-10 text-sm text-blue-50/60">© {new Date().getFullYear()} LabEnvironment</div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 rounded-2xl shadow-xl border-indigo-100">
          <div className="lg:hidden mb-6">
            <BrandLockup markClassName="w-9 h-9" nameClassName="text-slate-900" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-1">Access your monitoring dashboard</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="id" className="text-slate-700">Email or Username</Label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@lab.com" className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw" className="text-slate-700">Password</Label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
                Remember me
              </label>
              <a href="#" className="text-sm text-indigo-600 hover:underline">Forgot password?</a>
            </div>
            <Button
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-600/25"
            >
              Sign In
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200" /></div>
            <div className="relative flex justify-center">
              <span className="bg-card px-3 text-xs uppercase tracking-wide text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl gap-2 border-slate-200"
            onClick={() => toast.info("Google sign-in is not configured yet")}
          >
            <GoogleIcon /> Continue with Google
          </Button>

          <p className="text-sm text-center mt-6 text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" className="text-indigo-600 font-medium hover:underline">Sign up</Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
