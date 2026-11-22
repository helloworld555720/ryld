import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/app/page-header";
import { ProjectStatusBadge } from "@/components/app/project-status-badge";
import { ProjectVideoPlayer } from "@/components/app/project-video-player";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject } from "@/lib/api/projects";
import type { Project } from "@/lib/api/schemas/projects";
import { getServerEnv } from "@/lib/env";
import { isApiError } from "@/lib/errors";
import { log } from "@/lib/log";
import { projectMedia, sourceTitle } from "@/lib/media";
import {
  getProjectInputKind,
  getProjectOutputKind,
  projectStatusLabel,
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

/**
 * Why there is no player, in the caller's terms. Every branch says what the
 * project is doing and what would make a video appear, rather than showing a
 * dead `<video>` the viewer would try to press.
 */
function noPlayerNotice(project: Project, mediaBase: string | undefined): string {
  const status = project.status.toLowerCase();

  if (status === "draft") {
    return "This project is a draft. Submit it to start processing; the video appears here when it finishes.";
  }

  if (status === "pending" || status === "queued" || status === "processing") {
    return `This project is ${projectStatusLabel(project.status).toLowerCase()}. Reload the page to check again; the video appears here when processing finishes.`;
  }

  if (status === "failed") {
    return "Processing failed, so there is no video to play. The details below are everything the API recorded.";
  }

  if (!project.source) {
    return "This project finished without a result to play.";
  }

  if (project.source.type !== "hls") {
    return "This result isn't a video this app can play.";
  }

  if (!mediaBase) {
    /*
     * The API reports storage keys, never URLs, so playback needs the host in
     * front of the bucket. Saying so beats a silent failure inside the player.
     */
    return "The media host isn't configured, so the generated files can't be loaded yet. Set MEDIA_BASE_URL to the bucket or CDN in front of this project's output.";
  }

  return "This result has no playlist, so there is nothing to play.";
}

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
        actions={<ProjectStatusBadge status={project.status} />}
      />

      {media ? (
        <ProjectVideoPlayer media={media} />
      ) : (
        <Card>
          <CardContent className="py-2">
            <p className="text-muted-foreground max-w-prose text-sm">
              {noPlayerNotice(project, mediaBase)}
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
