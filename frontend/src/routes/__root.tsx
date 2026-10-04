import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Toaster } from "sonner";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <>
      {/* Before the page, so a toast fired while a page mounts is not lost. */}
      <Toaster richColors position="top-right" />
      <Outlet />
    </>
  );
}

function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div>
        <p className="text-sm font-semibold text-blue-600">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">This address does not exist in the lab monitor.</p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
