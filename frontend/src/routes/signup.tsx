import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Atom, User, Mail, Lock, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "@/components/ui/card";
import { setUser } from "@/lib/auth";
import { toast } from "sonner";
import { APP_NAME, BrandLockup } from "@/components/brand";
// Swap this import to replace the background image.
import bgImage from "@/assets/quantum-bg.jpg";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign Up — LabEnvironment" },
      { name: "description", content: "Create your LabEnvironment account to monitor laboratory temperature and humidity." },
      { property: "og:title", content: "Sign Up — LabEnvironment" },
      { property: "og:description", content: "Register to monitor six sensor points inside your laboratory room." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "", confirm: "" });

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.username || !form.password) {
      toast.error("Please fill in all fields");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setUser({ name: form.name, email: form.email, username: form.username });
    toast.success("Account created");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgImage})` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#080d2b]/90 via-[#101a4d]/85 to-[#2a1252]/90" aria-hidden="true" />

      <div className="absolute top-5 left-5 sm:top-7 sm:left-8 z-10">
        <BrandLockup nameClassName="text-white text-lg" subtitle="Quantum Lab Monitoring" subtitleClassName="text-xs text-blue-100/70" />
      </div>

      <Card className="relative z-10 w-full max-w-md p-7 sm:p-8 rounded-2xl border-white/40 bg-white/95 backdrop-blur-xl shadow-2xl shadow-indigo-950/40">
        <div className="flex flex-col items-center text-center">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 text-white grid place-items-center shadow-lg shadow-indigo-600/30">
            <Atom className="w-6 h-6" />
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Create account</h1>
          <p className="text-sm text-muted-foreground mt-1">Set up your {APP_NAME} monitoring access</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3.5">
          <Field id="name" label="Full Name" icon={<User className="w-4 h-4" />} value={form.name} onChange={update("name")} placeholder="Jane Doe" />
          <Field id="email" label="Email" icon={<Mail className="w-4 h-4" />} value={form.email} onChange={update("email")} placeholder="you@lab.com" type="email" />
          <Field id="username" label="Username" icon={<AtSign className="w-4 h-4" />} value={form.username} onChange={update("username")} placeholder="janedoe" />
          <Field id="password" label="Password" icon={<Lock className="w-4 h-4" />} value={form.password} onChange={update("password")} type="password" placeholder="••••••••" />
          <Field id="confirm" label="Confirm Password" icon={<Lock className="w-4 h-4" />} value={form.confirm} onChange={update("confirm")} type="password" placeholder="••••••••" />

          <Button
            type="submit"
            className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-600/25"
          >
            Sign Up
          </Button>
        </form>

        <p className="text-sm text-center mt-5 text-muted-foreground">
          Already have an account?{" "}
          <Link to="/signin" className="text-indigo-600 font-medium hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}

function Field({ id, label, icon, ...props }: { id: string; label: string; icon: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-slate-700">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
        <Input id={id} className="pl-9 rounded-xl border-slate-200 focus-visible:ring-indigo-500" {...props} />
      </div>
    </div>
  );
}
