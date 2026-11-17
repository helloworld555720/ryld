"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Loader2, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { GoogleDriveFilePicker } from "@/components/app/google-drive-file-picker";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { projectCreateSchema } from "@/lib/api/schemas/projects";
import { ApiError, isApiError, toUserMessage } from "@/lib/errors";
import {
  PROJECT_INPUT_KINDS,
  PROJECT_OUTPUT_KINDS,
  buildProjectDraft,
  getProjectInputKind,
  getProjectOutputKind,
  initialFieldValues,
  type GdriveAccount,
  type ProjectField,
  type ProjectKind,
} from "@/lib/projects";

type Side = "input" | "output";

const DEFAULT_INPUT = PROJECT_INPUT_KINDS[0];
const DEFAULT_OUTPUT = PROJECT_OUTPUT_KINDS[0];

interface KindFieldsProps {
  kind: ProjectKind;
  side: Side;
  values: Record<string, string>;
  labels: Record<string, string>;
  errors: Record<string, string>;
  gdriveAccounts: readonly GdriveAccount[];
  disabled: boolean;
  onChange: (side: Side, field: ProjectField, value: string) => void;
  onLabelChange: (side: Side, field: ProjectField, label: string) => void;
}

interface GdriveAccountFieldProps {
  id: string;
  value: string;
  accounts: readonly GdriveAccount[];
  disabled: boolean;
  onChange: (accountId: string) => void;
}

/** Account picker for a Drive source; links to Connections when there is none. */
function GdriveAccountField({
  id,
  value,
  accounts,
  disabled,
  onChange,
}: GdriveAccountFieldProps) {
  if (accounts.length === 0) {
    return (
      <div className="border-border/70 rounded-lg border p-3">
        <p className="text-muted-foreground text-sm">
          No Google Drive account is connected.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link href="/connections?tab=storage">Connect Google Drive</Link>
        </Button>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            Account {account.id.slice(0, 8)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Renders whatever fields a registry kind declares. The form has no knowledge
 * of YouTube, Drive or S3 beyond the registry entry, so a new source or
 * destination needs no change here — only a control it already understands.
 */
function KindFields({
  kind,
  side,
  values,
  labels,
  errors,
  gdriveAccounts,
  disabled,
  onChange,
  onLabelChange,
}: KindFieldsProps) {
  if (kind.fields.length === 0) return null;

  const accountField = kind.fields.find(
    (field) => field.control === "gdrive-account",
  );
  const accountId = accountField ? (values[accountField.name] ?? "") : "";

  return (
    <div className="space-y-4">
      {kind.fields.map((field) => {
        const id = `${side}-${field.name}`;
        const error = errors[`${side}.${field.name}`];

        return (
          <Field key={field.name} data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>

            {field.control === "gdrive-account" ? (
              <GdriveAccountField
                id={id}
                value={values[field.name] ?? ""}
                accounts={gdriveAccounts}
                disabled={disabled}
                onChange={(accountId) => onChange(side, field, accountId)}
              />
            ) : field.control === "gdrive-file" ? (
              <GoogleDriveFilePicker
                id={id}
                accountId={accountId}
                fileId={values[field.name] ?? ""}
                fileName={labels[`${side}.${field.name}`] ?? ""}
                disabled={disabled}
                onPick={(file) => {
                  onChange(side, field, file.id);
                  onLabelChange(side, field, file.name);
                }}
              />
            ) : (
              <Input
                id={id}
                name={id}
                type={field.inputType ?? "text"}
                value={values[field.name] ?? ""}
                onChange={(event) => onChange(side, field, event.target.value)}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={
                  error
                    ? `${id}-error`
                    : field.description
                      ? `${id}-description`
                      : undefined
                }
              />
            )}

            {field.description && !error ? (
              <FieldDescription id={`${id}-description`}>
                {field.description}
              </FieldDescription>
            ) : null}
            {error ? (
              <FieldError id={`${id}-error`}>{error}</FieldError>
            ) : null}
          </Field>
        );
      })}
    </div>
  );
}

interface KindSelectProps {
  id: string;
  label: string;
  kinds: readonly ProjectKind[];
  active: ProjectKind;
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}

/** One source/destination picker; the active kind's copy sits underneath. */
function KindSelect({
  id,
  label,
  kinds,
  active,
  value,
  disabled,
  onChange,
}: KindSelectProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kinds.map((kind) => (
            <SelectItem key={kind.id} value={kind.id}>
              {kind.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{active.description}</FieldDescription>
    </Field>
  );
}

/** Drops every label whose key starts with `<side>.`. */
function withoutSide(
  previous: Record<string, string>,
  side: Side,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(previous)) {
    if (!key.startsWith(`${side}.`)) next[key] = value;
  }
  return next;
}

export interface CreateProjectFormProps {
  /** Connected Drive accounts, read on the server for the Picker. */
  gdriveAccounts: readonly GdriveAccount[];
}

/**
 * Creates one project: a source, its fields, and a destination. Validation
 * uses the same schema the BFF applies, so a payload the browser accepts is
 * one the server will forward (and vice versa).
 */
export function CreateProjectForm({ gdriveAccounts }: CreateProjectFormProps) {
  const router = useRouter();

  const [inputType, setInputType] = useState(DEFAULT_INPUT.id);
  const [outputType, setOutputType] = useState(DEFAULT_OUTPUT.id);
  const [inputValues, setInputValues] = useState<Record<string, string>>(() =>
    initialFieldValues(DEFAULT_INPUT, gdriveAccounts),
  );
  const [outputValues, setOutputValues] = useState<Record<string, string>>(
    () => initialFieldValues(DEFAULT_OUTPUT),
  );
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const activeInputKind = getProjectInputKind(inputType) ?? DEFAULT_INPUT;
  const activeOutputKind = getProjectOutputKind(outputType) ?? DEFAULT_OUTPUT;

  const create = useMutation({
    mutationFn: async (draft: unknown) => {
      const response = await fetch("/api/backend/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(draft),
      });

      if (!response.ok) {
        throw new ApiError({
          status: response.status,
          safeMessage:
            response.status === 400 || response.status === 422
              ? "We couldn't create the project. Check the details and try again."
              : undefined,
        });
      }

      const data: unknown = await response.json().catch(() => null);
      const id =
        typeof data === "object" && data !== null
          ? (data as { id?: unknown }).id
          : undefined;

      return typeof id === "string" ? id : null;
    },
    onSuccess: (id) => {
      setCreatedId(id);
      setFormError(null);
      setErrors({});
      setLabels({});
      setInputValues(initialFieldValues(activeInputKind, gdriveAccounts));
      setOutputValues(initialFieldValues(activeOutputKind));
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 401) {
        router.push("/auth/sign-in?redirectTo=%2Fprojects");
        return;
      }

      setFormError(toUserMessage(error));
    },
  });

  function changeType(side: Side, id: string) {
    const kind =
      side === "input" ? getProjectInputKind(id) : getProjectOutputKind(id);
    if (!kind) return;

    if (side === "input") {
      setInputType(id);
      setInputValues(initialFieldValues(kind, gdriveAccounts));
    } else {
      setOutputType(id);
      setOutputValues(initialFieldValues(kind));
    }

    setLabels((previous) => withoutSide(previous, side));
    setErrors({});
    setCreatedId(null);
    setFormError(null);
  }

  function changeValue(side: Side, field: ProjectField, value: string) {
    const kind = side === "input" ? activeInputKind : activeOutputKind;
    // A file belongs to an account: changing the account drops the selection
    // so a file id from another account can never be submitted.
    const clearsFiles = field.control === "gdrive-account";
    const fileFields = clearsFiles
      ? kind.fields.filter((candidate) => candidate.control === "gdrive-file")
      : [];

    const update = (previous: Record<string, string>) => {
      const next = { ...previous, [field.name]: value };
      for (const fileField of fileFields) next[fileField.name] = "";
      return next;
    };

    if (side === "input") setInputValues(update);
    else setOutputValues(update);

    if (clearsFiles) {
      setLabels((previous) => {
        let next = previous;
        for (const fileField of fileFields) {
          const key = `${side}.${fileField.name}`;
          if (!(key in next)) continue;
          if (next === previous) next = { ...previous };
          delete next[key];
        }
        return next;
      });
    }

    const staleKeys = [
      `${side}.${field.name}`,
      ...fileFields.map((fileField) => `${side}.${fileField.name}`),
    ];

    setErrors((previous) => {
      if (!staleKeys.some((key) => previous[key])) return previous;
      const next = { ...previous };
      for (const key of staleKeys) delete next[key];
      return next;
    });
  }

  function changeLabel(side: Side, field: ProjectField, label: string) {
    setLabels((previous) => ({ ...previous, [`${side}.${field.name}`]: label }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setCreatedId(null);

    const draft = buildProjectDraft({
      inputType,
      outputType,
      input: inputValues,
      output: outputValues,
    });
    const parsed = projectCreateSchema.safeParse(draft);

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const [side, name] = issue.path;
        if (
          (side === "input" || side === "output") &&
          typeof name === "string"
        ) {
          const key = `${side}.${name}`;
          if (!next[key]) next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }

    setErrors({});
    create.mutate(parsed.data);
  }

  const pending = create.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>New project</CardTitle>
        <CardDescription>
          Choose a source and a destination. Ryld handles the rest in the
          background.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <KindSelect
              id="project-input-type"
              label="Source"
              kinds={PROJECT_INPUT_KINDS}
              active={activeInputKind}
              value={activeInputKind.id}
              disabled={pending}
              onChange={(id) => changeType("input", id)}
            />
            <KindSelect
              id="project-output-type"
              label="Destination"
              kinds={PROJECT_OUTPUT_KINDS}
              active={activeOutputKind}
              value={activeOutputKind.id}
              disabled={pending}
              onChange={(id) => changeType("output", id)}
            />
          </div>

          <KindFields
            kind={activeInputKind}
            side="input"
            values={inputValues}
            labels={labels}
            errors={errors}
            gdriveAccounts={gdriveAccounts}
            disabled={pending}
            onChange={changeValue}
            onLabelChange={changeLabel}
          />

          <KindFields
            kind={activeOutputKind}
            side="output"
            values={outputValues}
            labels={labels}
            errors={errors}
            gdriveAccounts={gdriveAccounts}
            disabled={pending}
            onChange={changeValue}
            onLabelChange={changeLabel}
          />

          {formError ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Project not created</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {createdId ? (
            <Alert>
              <CircleCheck aria-hidden="true" />
              <AlertTitle>Project created</AlertTitle>
              <AlertDescription>
                Reference{" "}
                <code className="font-mono">{createdId.slice(0, 8)}</code>. You
                can create another one below.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {pending ? "Creating…" : "Create project"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
