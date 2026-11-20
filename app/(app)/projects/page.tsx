import { CreateProjectDialog } from "@/components/app/create-project-dialog";
import { PageHeader } from "@/components/app/page-header";
import { listConnections } from "@/lib/api/connections";
import { isApiError } from "@/lib/errors";
import { log } from "@/lib/log";
import type { GdriveAccount } from "@/lib/projects";

export const instant = false;

/**
 * A Drive source needs the caller's connected accounts before the Picker can
 * run. A failed list is logged and treated as empty: the page still creates
 * YouTube projects, and the Drive field explains what is missing.
 */
async function readGdriveAccounts(): Promise<GdriveAccount[]> {
  try {
    const connections = await listConnections();
    return connections
      .filter((connection) => connection.type === "gdrive")
      .map((connection) => ({ id: connection.id }));
  } catch (error) {
    log("error", "projects.connections_failed", {
      reason: isApiError(error) ? error.code : "UNKNOWN",
      status: isApiError(error) ? error.status : undefined,
    });
    return [];
  }
}

export default async function ProjectsPage() {
  const gdriveAccounts = await readGdriveAccounts();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Turn a source into a destination. Everything else runs in the background."
        actions={<CreateProjectDialog gdriveAccounts={gdriveAccounts} />}
      />
    </div>
  );
}
