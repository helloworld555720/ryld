import { ArrowRight, FolderClosed } from "lucide-react";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
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
  projectStatusLabel,
  summarizeProjectInput,
} from "@/lib/projects";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

/**
 * Only the statuses we have copy for are styled; anything new from upstream
 * still renders, as a plain badge with the raw value.
 */
function statusVariant(status: string): BadgeVariant {
  switch (status.toLowerCase()) {
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}

export interface ProjectCardProps {
  project: Project;
}

/**
 * One project: where it comes from, where it goes, and the registry-declared
 * fields the API stored for it. The card knows no provider — it reads the same
 * input/output registries the form does, so a new source renders here for free.
 */
export function ProjectCard({ project }: ProjectCardProps) {
  const inputKind = getProjectInputKind(project.input.type);
  const outputKind = getProjectOutputKind(project.output.type);
  const Icon = inputKind?.icon ?? FolderClosed;
  const rows = summarizeProjectInput(project.input.type, project.input);

  return (
    <Card>
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
          <Badge variant={statusVariant(project.status)}>
            {projectStatusLabel(project.status)}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">No details recorded.</p>
        ) : (
          <dl className="space-y-1.5">
            {rows.map((row) => (
              /*
               * Values can be long (links, Drive file ids) and the card is one
               * column wide: truncate the display, keep the whole value in the
               * tooltip and in the DOM for copying.
               */
              <div
                key={row.label}
                className="flex items-baseline gap-2 text-xs"
              >
                <dt className="text-muted-foreground shrink-0">{row.label}</dt>
                <dd className="min-w-0 truncate font-medium" title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>

      <CardFooter className="mt-auto justify-between gap-3">
        <span className="text-muted-foreground text-xs">Reference</span>
        <code className="text-muted-foreground truncate font-mono text-xs">
          {project.id.slice(0, 8)}
        </code>
      </CardFooter>
    </Card>
  );
}
