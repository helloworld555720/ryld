"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CreateProjectForm } from "@/components/app/create-project-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { GdriveAccount } from "@/lib/projects";

export interface CreateProjectDialogProps {
  /** Connected Drive accounts, read on the server for the Picker. */
  gdriveAccounts: readonly GdriveAccount[];
}

/**
 * The page's only creation entry point: a button that opens the project form in
 * a dialog. Creation is a self-contained task with no reason to occupy the page
 * permanently, so the form lives here and closes on success.
 */
export function CreateProjectDialog({
  gdriveAccounts,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          Create project
        </Button>
      </DialogTrigger>

      {/*
        The form is taller than the viewport on small screens, so the content
        scrolls instead of clipping: every field and the submit button stay
        reachable. Radix unmounts the content when the dialog closes, which is
        why a reopened dialog starts from a clean draft.
      */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Choose a source and a destination. Ryld handles the rest in the
            background.
          </DialogDescription>
        </DialogHeader>

        <CreateProjectForm
          gdriveAccounts={gdriveAccounts}
          onCreated={(id) => {
            setOpen(false);
            // The card list is server-rendered: refresh so the new project
            // appears without a manual reload.
            router.refresh();
            toast.success(
              "Project created",
              id ? { description: `Reference ${id.slice(0, 8)}.` } : undefined,
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
