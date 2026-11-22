import { ArrowRight, FolderClosed } from "lucide-react";
import Link from "next/link";

import { ProjectStatusBadge } from "@/components/app/project-status-badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Project } from "@/lib/api/schemas/projects";
import {
  getProjectInputKind,
  getProjectOutputKind,
  getProjectSourceKind,
  summarizeProjectInput,
  summarizeProjectSource,
  type ProjectFieldSummary,
} from "@/lib/projects";

/**
 * Values can be long (links, Drive file ids, storage keys) and the card is one
 * column wide: truncate the display, keep the whole value in the tooltip and in
 * the DOM for copying.
 */
function DetailRows({ rows }: { rows: readonly ProjectFieldSummary[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline gap-2 text-xs">
          <dt className="text-muted-foreground shrink-0">{row.label}</dt>
          <dd className="min-w-0 truncate font-medium" title={row.value}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface ProjectCardProps {
  project: Project;
}

/**
 * One project: where it comes from, where it goes, the registry-declared fields
 * the API stored for it, and, once it has been processed, the result it reports
 * in `source`. The card knows no provider: it reads the same
 * input/output/source registries the rest of the app does, so a new kind
 * renders here for free.
 *
 * The whole card is the link to the project's page. Nothing inside it is
 * separately interactive, so there is no nested control for a keyboard user to
 * get stuck in.
 */
export function ProjectCard({ project }: ProjectCardProps) {
  const inputKind = getProjectInputKind(project.input.type);
  const outputKind = getProjectOutputKind(project.output.type);
  const Icon = inputKind?.icon ?? FolderClosed;
  const rows = summarizeProjectInput(project.input.type, project.input);

  const source = project.source ?? null;
  const sourceKind = source ? getProjectSourceKind(source.type) : undefined;
  const resultRows = source ? summarizeProjectSource(source) : [];

  return (
    <Link
      href={`/projects/${project.id}`}
      className="focus-visible:ring-ring focus-visible:ring-offset-background group block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Card className="h-full transition-colors group-hover:ring-foreground/25">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-lg">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="truncate">
                {inputKind?.label ?? project.input.type}
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5">
                <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {outputKind?.label ?? project.output.type}
                </span>
              </CardDescription>
            </div>
          </div>

          <CardAction>
            <ProjectStatusBadge status={project.status} />
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-xs">No details recorded.</p>
          ) : (
            <DetailRows rows={rows} />
          )}

          {resultRows.length === 0 ? null : (
            /*
             * The result appears only once the API has filled `source`, so the
             * card does not grow a heading for a project that has no output yet.
             */
            <div className="border-t pt-3">
              <h3 className="text-muted-foreground text-xs font-medium">
                {sourceKind?.label ?? source?.type}
              </h3>
              <div className="mt-1.5">
                <DetailRows rows={resultRows} />
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="mt-auto justify-between gap-3">
          <span className="text-muted-foreground text-xs">Reference</span>
          <code className="text-muted-foreground truncate font-mono text-xs">
            {project.id.slice(0, 8)}
          </code>
        </CardFooter>
      </Card>
    </Link>
  );
}
