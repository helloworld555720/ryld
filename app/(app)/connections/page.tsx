import { Cable } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";

export const instant = false;

export default function ConnectionsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Connections"
        description="Services linked to this workspace, and the credentials they use."
      />

      <EmptyState
        icon={Cable}
        title="No connections yet"
        description="Connections you add will be listed here. Management is not wired to the API service yet."
      />
    </div>
  );
}
