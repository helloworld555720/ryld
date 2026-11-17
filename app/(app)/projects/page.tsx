import { CreateProjectForm } from "@/components/app/create-project-form";
import { PageHeader } from "@/components/app/page-header";

export const instant = false;

export default function ProjectsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Turn a source into a destination. Everything else runs in the background."
      />

      <div className="max-w-2xl">
        <CreateProjectForm />
      </div>
    </div>
  );
}
