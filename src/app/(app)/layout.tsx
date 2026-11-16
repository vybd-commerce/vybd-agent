import { auth } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import { listBrands } from "@/lib/services/brands";
import { requireCtx } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireCtx();
  const [session, brands] = await Promise.all([auth(), listBrands(ctx)]);
  return (
    <div className="flex h-full flex-col md:flex-row">
      <Sidebar
        brands={brands.map((b) => ({ id: b.id, name: b.name, stage: b.stage, shared: b.ownerId !== ctx.userId }))}
        name={session?.user?.name ?? ""}
        email={session?.user?.email ?? ""}
        isOperator={ctx.role === "operator"}
      />
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
