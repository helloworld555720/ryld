import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { VideoEditor } from "@/components/editor/video-editor";
import { ProjectStatusBadge } from "@/components/app/project-status-badge";
import { Button } from "@/components/ui/button";
import { getProject } from "@/lib/api/projects";
import type { Project } from "@/lib/api/schemas/projects";
import { getServerEnv } from "@/lib/env";
import { isApiError } from "@/lib/errors";
import { log } from "@/lib/log";
import { playbackNotice, projectMedia, sourceTitle } from "@/lib/media";

/**
 * One project read + a session read: request-time only, blocking so the editor
 * never paints with a stale project or an empty preview.
 */
export const instant = false;

const projectIdSchema = z.uuid();

function EditorNotice({
  project,
  message,
}: {
  project: Project | null;
  message: string;
}) {
  return (
    <main className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 p-6">
      <p className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
        Editor
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {project ? "This project can't open in the editor" : "Editor"}
        </h1>
        {project ? <ProjectStatusBadge status={project.status} /> : null}
      </div>

      <p className="text-muted-foreground max-w-prose text-sm">{message}</p>

      <div className="flex items-center gap-2 pt-2">
        <Button asChild variant="outline" size="sm">
          <Link href={project ? `/projects/${project.id}` : "/projects"}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {project ? "Back to project" : "All projects"}
          </Link>
        </Button>
      </div>
    </main>
  );
}

export default async function ProjectEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!projectIdSchema.safeParse(id).success) notFound();

  let project: Project;

  try {
    project = await getProject(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();

    log("error", "projects.editor_failed", {
      reason: isApiError(error) ? error.code : "UNKNOWN",
      status: isApiError(error) ? error.status : undefined,
    });

    return (
      <EditorNotice
        project={null}
        message="We couldn't load this project. Reload the page to try again."
      />
    );
  }

  const mediaBase = getServerEnv().MEDIA_BASE_URL;
  const media = project.source ? projectMedia(project.source, mediaBase) : null;

  if (!media) {
    return (
      <EditorNotice
        project={project}
        message={playbackNotice(project, mediaBase)}
      />
    );
  }

  const title =
    media.title ??
    (project.source ? sourceTitle(project.source) : null) ??
    "Project";

  return <VideoEditor projectId={project.id} title={title} media={media} />;
}
