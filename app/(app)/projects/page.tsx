import { FolderOpen } from "lucide-react";

import { CreateProjectDialog } from "@/components/app/create-project-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ProjectCard } from "@/components/app/project-card";
import { listConnections } from "@/lib/api/connections";
import { listProjects } from "@/lib/api/projects";
import type { Project } from "@/lib/api/schemas/projects";
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

/**
 * `null` means the read failed. That is different from an empty list, and the
 * page says so: claiming "no projects" when we could not ask would be a lie.
 */
async function readProjects(): Promise<Project[] | null> {
  try {
    return await listProjects();
  } catch (error) {
    log("error", "projects.list_failed", {
      reason: isApiError(error) ? error.code : "UNKNOWN",
      status: isApiError(error) ? error.status : undefined,
    });
    return null;
  }
}

export default async function ProjectsPage() {
  const [gdriveAccounts, projects] = await Promise.all([
    readGdriveAccounts(),
    readProjects(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Turn a source into a destination. Everything else runs in the background."
        actions={<CreateProjectDialog gdriveAccounts={gdriveAccounts} />}
      />

      <section aria-label="Projects" className="space-y-4">
        {projects === null ? (
          <p className="text-muted-foreground max-w-prose text-sm">
            We couldn&rsquo;t load your projects. Reload the page to try again.
          </p>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No projects yet"
            description="Create one to send a source to a destination. It will appear here."
          />
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
