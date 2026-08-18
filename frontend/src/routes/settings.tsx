import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Camera, KeyRound, Save, Trash2, UserRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/modal";
import { getUser, setUser } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({ component: SettingsPage });
type ProfileForm = { name: string; email: string; username: string };
type ProfileErrors = Partial<Record<keyof ProfileForm | "avatar", string>>;
type PasswordForm = { current: string; next: string; confirm: string };
type PasswordErrors = Partial<Record<keyof PasswordForm, string>>;

function SettingsPage() {
  const currentUser = getUser();
  const fileInput = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<ProfileForm>({ name: currentUser?.name ?? "", email: currentUser?.email ?? "", username: currentUser?.username ?? "" });
  const [avatar, setAvatar] = useState<string | null>(null);
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [password, setPassword] = useState<PasswordForm>({ current: "", next: "", confirm: "" });
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const updateProfile = (key: keyof ProfileForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setProfile({ ...profile, [key]: event.target.value });
    setProfileErrors({ ...profileErrors, [key]: undefined });
  };
  const updatePassword = (key: keyof PasswordForm) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setPassword({ ...password, [key]: event.target.value });
    setPasswordErrors({ ...passwordErrors, [key]: undefined });
  };
  const chooseAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setProfileErrors({ ...profileErrors, avatar: "Please select an image file" }); return; }
    if (file.size > 2 * 1024 * 1024) { setProfileErrors({ ...profileErrors, avatar: "Image must be smaller than 2 MB" }); return; }
    if (avatar) URL.revokeObjectURL(avatar);
    setAvatar(URL.createObjectURL(file));
    setProfileErrors({ ...profileErrors, avatar: undefined });
  };
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: ProfileErrors = {};
    if (!profile.name.trim()) errors.name = "Name is required";
    if (!profile.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) errors.email = "Enter a valid email address";
    if (!profile.username.trim()) errors.username = "Username is required";
    setProfileErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingProfile(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    setUser({ name: profile.name.trim(), email: profile.email.trim(), username: profile.username.trim() });
    setSavingProfile(false);
    toast.success("Profile updated");
  };
  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: PasswordErrors = {};
    if (!password.current) errors.current = "Current password is required";
    if (!password.next) errors.next = "New password is required";
    else if (password.next.length < 8) errors.next = "Password must contain at least 8 characters";
    else if (password.next === password.current) errors.next = "New password must be different";
    if (!password.confirm) errors.confirm = "Confirm your new password";
    else if (password.next !== password.confirm) errors.confirm = "Passwords do not match";
    setPasswordErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingPassword(true);
    await new Promise(resolve => setTimeout(resolve, 600));
    setSavingPassword(false);
    setPassword({ current: "", next: "", confirm: "" });
    toast.info("Password flow is ready, but no password was changed because a backend API is not connected yet");
  };

  return <AppShell title="Settings" subtitle="Manage your profile and account security"><div className="mx-auto max-w-4xl space-y-4">
    <form onSubmit={saveProfile}><Card className="overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-blue-600"/>Personal Information</h2><p className="mt-1 text-sm text-slate-500">Update your photo and personal details</p></div><div className="p-5"><div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center"><div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-blue-100 text-3xl font-bold text-blue-700 shadow">{avatar ? <img src={avatar} alt="Profile preview" className="h-full w-full object-cover"/> : profile.name.charAt(0).toUpperCase() || <UserRound className="h-8 w-8"/>}</div><div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => fileInput.current?.click()} className="gap-2"><Camera className="h-4 w-4"/>Change Photo</Button>{avatar && <Button type="button" variant="ghost" onClick={() => { URL.revokeObjectURL(avatar); setAvatar(null); if (fileInput.current) fileInput.current.value = ""; }} className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4"/>Remove</Button>}</div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} className="hidden"/><p className="mt-2 text-xs text-slate-500">JPG, PNG or WebP. Maximum size 2 MB. Preview is temporary until a profile API is connected.</p><FieldError>{profileErrors.avatar}</FieldError></div></div><div className="grid gap-4 sm:grid-cols-2"><ProfileField label="Full name" error={profileErrors.name}><Input value={profile.name} onChange={updateProfile("name")} placeholder="Your name"/></ProfileField><ProfileField label="Username" error={profileErrors.username}><Input value={profile.username} onChange={updateProfile("username")} placeholder="username"/></ProfileField><div className="sm:col-span-2"><ProfileField label="Email address" error={profileErrors.email}><Input type="email" value={profile.email} onChange={updateProfile("email")} placeholder="you@lab.com"/></ProfileField></div></div></div><div className="flex justify-end border-t bg-slate-50 px-5 py-3"><Button type="submit" disabled={savingProfile} className="gap-2 bg-blue-600 hover:bg-blue-700"><Save className="h-4 w-4"/>{savingProfile ? "Saving..." : "Save Profile"}</Button></div></Card></form>
    <form onSubmit={changePassword}><Card className="overflow-hidden"><div className="border-b px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-blue-600"/>Password & Security</h2><p className="mt-1 text-sm text-slate-500">Prepare a secure password change</p></div><div className="grid gap-4 p-5 sm:grid-cols-2"><div className="sm:col-span-2"><ProfileField label="Current password" error={passwordErrors.current}><Input type="password" autoComplete="current-password" value={password.current} onChange={updatePassword("current")} placeholder="Enter current password"/></ProfileField></div><ProfileField label="New password" error={passwordErrors.next}><Input type="password" autoComplete="new-password" value={password.next} onChange={updatePassword("next")} placeholder="At least 8 characters"/></ProfileField><ProfileField label="Confirm new password" error={passwordErrors.confirm}><Input type="password" autoComplete="new-password" value={password.confirm} onChange={updatePassword("confirm")} placeholder="Repeat new password"/></ProfileField><div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">Password changes require a secure backend endpoint. This form validates the frontend flow but will not modify your actual password yet.</div></div><div className="flex justify-end border-t bg-slate-50 px-5 py-3"><Button type="submit" disabled={savingPassword} className="gap-2 bg-blue-600 hover:bg-blue-700"><KeyRound className="h-4 w-4"/>{savingPassword ? "Updating..." : "Update Password"}</Button></div></Card></form>
  </div></AppShell>;
}
function ProfileField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) { return <div><Label className="mb-1.5 block text-slate-700">{label}</Label>{children}<FieldError>{error}</FieldError></div>; }
