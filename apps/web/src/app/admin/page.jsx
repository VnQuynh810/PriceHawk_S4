import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listUsersWithStats } from "@/server/repositories/userRepository";
import { getCrawlSourcesService } from "@/server/services/crawlSourceService";
import { getPoolDashboardService } from "@/server/services/poolService";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";
import { cn, ui } from "@/components/ui/designSystem";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Control Center — PriceHawk" };

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/");
  }

  const [users, sources, poolStats] = await Promise.all([
    listUsersWithStats().catch(() => []),
    getCrawlSourcesService().catch(() => []),
    getPoolDashboardService().catch(() => null),
  ]);

  return (
    <main className={cn(ui.pageWrap, "py-10")}>
      <div className={ui.container}>
        <AdminDashboardClient
          initialSources={Array.isArray(sources) ? sources : []}
          initialUsers={Array.isArray(users) ? users : []}
          initialPool={poolStats}
        />
      </div>
    </main>
  );
}
