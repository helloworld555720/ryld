import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { projectStatusLabel } from "@/lib/projects";

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

export interface ProjectStatusBadgeProps {
  status: string;
  className?: string;
}

/** The project's status, labelled and styled in one place for card and page. */
export function ProjectStatusBadge({
  status,
  className,
}: ProjectStatusBadgeProps) {
  return (
    <Badge variant={statusVariant(status)} className={className}>
      {projectStatusLabel(status)}
    </Badge>
  );
}
