import { createFileRoute, redirect } from "@tanstack/react-router";
import { homeFor, loadUser } from "@/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    throw redirect({ to: homeFor(await loadUser()) });
  },
});
