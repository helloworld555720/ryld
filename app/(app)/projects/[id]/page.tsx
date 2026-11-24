import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/app/page-header";
import { ProjectStatusBadge } from "@/components/app/project-status-badge";
import { ProjectVideoPlayer } from "@/components/app/project-video-player";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject } from "@/lib/api/projects";
import type { Project } from "@/lib/api/schemas/projects";
import { getServerEnv } from "@/lib/env";
import { isApiError } from "@/lib/errors";
import { log } from "@/lib/log";
import {
  playbackNotice,
  projectMedia,
  sourceTitle,
} from "@/lib/media";
import {
  getProjectInputKind,
  getProjectOutputKind,
  summarizeProjectInput,
  summarizeProjectSource,
} from "@/lib/projects";

/**
 * The page reads the session and one upstream project, so it cannot be
 * prerendered. Blocking is right: a project's video must never flash an
 * anonymous shell or a stale status.
 */
export const instant = false;

const projectIdSchema = z.uuid();

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate text-sm font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Nothing upstream can answer for a path segment that is not an id, and this
  // keeps the upstream call out of reach of a crafted one.
  if (!projectIdSchema.safeParse(id).success) notFound();

  let project: Project;

  try {
    project = await getProject(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();

    log("error", "projects.show_failed", {
      reason: isApiError(error) ? error.code : "UNKNOWN",
      status: isApiError(error) ? error.status : undefined,
    });

    return (
      <div className="space-y-6">
        <BackLink />
        <p className="text-muted-foreground max-w-prose text-sm">
          We couldn&rsquo;t load this project. Reload the page to try again.
        </p>
      </div>
    );
  }

  const inputKind = getProjectInputKind(project.input.type);
  const outputKind = getProjectOutputKind(project.output.type);
  const mediaBase = getServerEnv().MEDIA_BASE_URL;
  const media = project.source ? projectMedia(project.source, mediaBase) : null;

  const title =
    media?.title ??
    (project.source ? sourceTitle(project.source) : null) ??
    inputKind?.label ??
    "Project";
  const description = [
    inputKind?.label ?? project.input.type,
    outputKind?.label ?? project.output.type,
  ].join(" → ");

  const details = [
    ...summarizeProjectInput(project.input.type, project.input),
    { label: "Destination", value: outputKind?.label ?? project.output.type },
    { label: "Submitted", value: project.submit ? "Yes" : "No" },
    { label: "Reference", value: project.id },
    ...(project.source ? summarizeProjectSource(project.source) : []),
  ];

  return (
    <div className="space-y-8">
      <BackLink />

      <PageHeader
        eyebrow="Project"
        title={title}
        description={description}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${project.id}/editor`}>
                <Clapperboard className="size-4" aria-hidden="true" />
                Open in editor
              </Link>
            </Button>
            <ProjectStatusBadge status={project.status} />
          </>
        }
      />

      {media ? (
        <ProjectVideoPlayer media={media} />
      ) : (
        <Card>
          <CardContent className="py-2">
            <p className="text-muted-foreground max-w-prose text-sm">
              {playbackNotice(project, mediaBase)}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {details.map((row) => (
              <DetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/projects"
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Projects
    </Link>
  );
}
