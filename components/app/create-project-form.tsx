"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, Send, TriangleAlert } from "lucide-react";
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
  Field,
  FieldContent,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { projectCreateSchema } from "@/lib/api/schemas/projects";
import {
  getConnectionCategory,
  getConnectionProvider,
} from "@/lib/connections";
import { ApiError, isApiError, toUserMessage } from "@/lib/errors";
import {
  PROJECT_INPUT_KINDS,
  PROJECT_OUTPUT_KINDS,
  buildProjectDraft,
  fieldLayout,
  getProjectInputKind,
  getProjectOutputKind,
  initialFieldValues,
  type ConnectedAccount,
  type ProjectField,
  type ProjectFieldValue,
  type ProjectKind,
} from "@/lib/projects";

type Side = "input" | "output";

const DEFAULT_INPUT = PROJECT_INPUT_KINDS[0];
const DEFAULT_OUTPUT = PROJECT_OUTPUT_KINDS[0];

function textOf(value: ProjectFieldValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function flagOf(value: ProjectFieldValue | undefined): boolean {
  return value === true;
}

/** A registry field plus the field that told a Drive file where to look. */
interface ProjectFieldInputProps {
  field: ProjectField;
  id: string;
  value: ProjectFieldValue;
  /** Every account the caller has; filtered per provider by the account field. */
  accounts: readonly ConnectedAccount[];
  /** Account a `gdrive-file` field reads from. */
  accountId: string;
  /** Display name of a file picked in this session, when there is one. */
  fileName: string;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  /** Element that names a switch, which is not labelable HTML. */
  labelledBy?: string;
  onChange: (value: ProjectFieldValue) => void;
  onPickFile: (file: { id: string; name: string }) => void;
}

function ProjectFieldInput({
  field,
  id,
  value,
  accounts,
  accountId,
  fileName,
  disabled,
  invalid,
  describedBy,
  labelledBy,
  onChange,
  onPickFile,
}: ProjectFieldInputProps) {
  switch (field.control) {
    case "select":
      return (
        <Select
          value={textOf(value)}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          >
            <SelectValue placeholder={field.placeholder ?? "Choose one"} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "switch":
      return (
        <Switch
          id={id}
          checked={flagOf(value)}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-labelledby={labelledBy}
        />
      );

    case "textarea":
      return (
        <Textarea
          id={id}
          name={id}
          rows={4}
          value={textOf(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      );

    case "datetime":
      return (
        <Input
          id={id}
          name={id}
          type="datetime-local"
          value={textOf(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      );

    case "connection-account": {
      const provider = field.provider
        ? getConnectionProvider(field.provider)
        : undefined;
      const providerAccounts = accounts.filter(
        (account) => account.type === field.provider,
      );

      if (providerAccounts.length === 0) {
        const category = provider
          ? getConnectionCategory(provider.category)
          : undefined;

        return (
          <div className="border-border/70 rounded-lg border p-3">
            <p className="text-muted-foreground text-sm">
              No {provider?.label ?? "account"} is connected.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href={`/connections?tab=${category?.id ?? "socials"}`}>
                Connect {provider?.label ?? "an account"}
              </Link>
            </Button>
          </div>
        );
      }

      return (
        <Select
          value={textOf(value)}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          >
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {providerAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                Account {account.id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "gdrive-file":
      return (
        <GoogleDriveFilePicker
          id={id}
          accountId={accountId}
          fileId={textOf(value)}
          fileName={fileName}
          disabled={disabled}
          onPick={onPickFile}
        />
      );

    case "text":
    default:
      return (
        <Input
          id={id}
          name={id}
          type={field.inputType ?? "text"}
          value={textOf(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      );
  }
}

/** One registry heading: fields that share a `group`, in first-seen order. */
interface FieldGroup {
  title: string | null;
  fields: ProjectField[];
}

function groupFields(fields: readonly ProjectField[]): FieldGroup[] {
  const groups: FieldGroup[] = [];

  for (const field of fields) {
    const title = field.group ?? null;
    let group = groups.find((candidate) => candidate.title === title);
    if (!group) {
      group = { title, fields: [] };
      groups.push(group);
    }
    group.fields.push(field);
  }

  return groups;
}

interface KindFieldsProps {
  kind: ProjectKind;
  side: Side;
  values: Record<string, ProjectFieldValue>;
  accounts: readonly ConnectedAccount[];
  labels: Record<string, string>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (side: Side, field: ProjectField, value: ProjectFieldValue) => void;
  onPickFile: (side: Side, field: ProjectField, file: { id: string; name: string }) => void;
}

/**
 * Renders whatever fields a registry kind declares, grouped by their `group`.
 * The form has no knowledge of YouTube, Drive or S3 beyond the registry entry,
 * so a new source or destination needs no change here — only a control it
 * already understands.
 */
function KindFields({
  kind,
  side,
  values,
  accounts,
  labels,
  errors,
  disabled,
  onChange,
  onPickFile,
}: KindFieldsProps) {
  if (kind.fields.length === 0) return null;

  // A Drive file is read through the account selected for its provider.
  const accountField = kind.fields.find(
    (field) => field.control === "connection-account",
  );
  const accountId = accountField ? textOf(values[accountField.name]) : "";
  const headingId = `${side}-fields-heading`;

  return (
    <section className="space-y-4" aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          {side === "input" ? "Source details" : "Destination options"}
        </h3>
        <span className="text-muted-foreground text-xs">{kind.label}</span>
      </div>

      {groupFields(kind.fields).map((group) => (
        <div key={group.title ?? "core"} className="space-y-4">
          {group.title ? (
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {group.title}
            </h4>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((field) => {
              const id = `${side}-${field.name}`;
              const error = errors[`${side}.${field.name}`];
              const descriptionId = field.description
                ? `${id}-description`
                : undefined;
              const errorId = error ? `${id}-error` : undefined;
              const describedBy = errorId ?? descriptionId;
              const spanClass =
                fieldLayout(field) === "half"
                  ? "sm:col-span-1"
                  : "sm:col-span-2";
              const labelId = `${id}-label`;

              const input = (
                <ProjectFieldInput
                  field={field}
                  id={id}
                  value={values[field.name] ?? ""}
                  accounts={accounts}
                  accountId={accountId}
                  fileName={labels[`${side}.${field.name}`] ?? ""}
                  disabled={disabled}
                  invalid={Boolean(error)}
                  describedBy={describedBy}
                  labelledBy={field.control === "switch" ? labelId : undefined}
                  onChange={(value) => onChange(side, field, value)}
                  onPickFile={(file) => onPickFile(side, field, file)}
                />
              );

              // A toggle reads better as a row: label and help on the left,
              // the control on the right. The left side is clickable too,
              // because a `<label for>` cannot activate a button on its own.
              if (field.control === "switch") {
                return (
                  <Field
                    key={field.name}
                    orientation="horizontal"
                    data-invalid={error ? true : undefined}
                    className={spanClass}
                  >
                    <FieldContent
                      onClick={() => {
                        if (disabled) return;
                        onChange(
                          side,
                          field,
                          !flagOf(values[field.name]),
                        );
                      }}
                    >
                      <FieldLabel htmlFor={id} id={labelId}>
                        {field.label}
                      </FieldLabel>
                      {field.description ? (
                        <FieldDescription id={descriptionId}>
                          {field.description}
                        </FieldDescription>
                      ) : null}
                      {error ? (
                        <FieldError id={errorId}>{error}</FieldError>
                      ) : null}
                    </FieldContent>
                    {input}
                  </Field>
                );
              }

              return (
                <Field
                  key={field.name}
                  data-invalid={error ? true : undefined}
                  className={spanClass}
                >
                  <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
                  {input}
                  {field.description && !error ? (
                    <FieldDescription id={descriptionId}>
                      {field.description}
                    </FieldDescription>
                  ) : null}
                  {error ? (
                    <FieldError id={errorId}>{error}</FieldError>
                  ) : null}
                </Field>
              );
            })}
          </div>
        </div>
      ))}
    </section>
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
  /** Every account the caller has, read on the server for the account fields. */
  accounts: readonly ConnectedAccount[];
  /** Called after the API confirms creation; the dialog closes on it. */
  onCreated?: (project: { id: string | null; submitted: boolean }) => void;
}

interface CreateProjectVariables {
  draft: unknown;
  submitted: boolean;
}

/**
 * Creates one project: a source, its fields, and a destination. Validation
 * uses the same schema the BFF applies, so a payload the browser accepts is
 * one the server will forward (and vice versa).
 *
 * The form owns no chrome — no card, no title — so the caller decides whether
 * it is a dialog or an inline block.
 */
export function CreateProjectForm({
  accounts,
  onCreated,
}: CreateProjectFormProps) {
  const router = useRouter();

  const [inputType, setInputType] = useState(DEFAULT_INPUT.id);
  const [outputType, setOutputType] = useState(DEFAULT_OUTPUT.id);
  const [inputValues, setInputValues] = useState<
    Record<string, ProjectFieldValue>
  >(() => initialFieldValues(DEFAULT_INPUT, accounts));
  const [outputValues, setOutputValues] = useState<
    Record<string, ProjectFieldValue>
  >(() => initialFieldValues(DEFAULT_OUTPUT, accounts));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const activeInputKind = getProjectInputKind(inputType) ?? DEFAULT_INPUT;
  const activeOutputKind = getProjectOutputKind(outputType) ?? DEFAULT_OUTPUT;

  const create = useMutation({
    mutationFn: async ({ draft }: CreateProjectVariables) => {
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
    onSuccess: (id, variables) => {
      setFormError(null);
      setErrors({});
      setLabels({});
      setInputValues(initialFieldValues(activeInputKind, accounts));
      setOutputValues(initialFieldValues(activeOutputKind, accounts));
      onCreated?.({ id, submitted: variables.submitted });
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
      setInputValues(initialFieldValues(kind, accounts));
    } else {
      setOutputType(id);
      setOutputValues(initialFieldValues(kind, accounts));
    }

    setLabels((previous) => withoutSide(previous, side));
    setErrors({});
    setFormError(null);
  }

  function changeValue(
    side: Side,
    field: ProjectField,
    value: ProjectFieldValue,
  ) {
    const kind = side === "input" ? activeInputKind : activeOutputKind;
    // A file belongs to an account: changing the account drops the selection
    // so a file id from another account can never be submitted.
    const clearsFiles = field.control === "connection-account";
    const fileFields = clearsFiles
      ? kind.fields.filter((candidate) => candidate.control === "gdrive-file")
      : [];

    const update = (previous: Record<string, ProjectFieldValue>) => {
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

  function changeFile(
    side: Side,
    field: ProjectField,
    file: { id: string; name: string },
  ) {
    const update = (previous: Record<string, ProjectFieldValue>) => ({
      ...previous,
      [field.name]: file.id,
    });

    if (side === "input") setInputValues(update);
    else setOutputValues(update);

    setLabels((previous) => ({
      ...previous,
      [`${side}.${field.name}`]: file.name,
    }));

    setErrors((previous) => {
      const key = `${side}.${field.name}`;
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    /*
     * The clicked button decides the intent; Enter counts as a draft because
     * implicit submission activates the first submit button, which is the
     * safe choice. The two buttons differ only in `submit`.
     */
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const submitted =
      submitter instanceof HTMLButtonElement && submitter.value === "submit";

    const draft = buildProjectDraft({
      inputType,
      outputType,
      input: inputValues,
      output: outputValues,
      submit: submitted,
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
    create.mutate({ draft: parsed.data, submitted });
  }

  const pending = create.isPending;
  const pendingSubmit = pending && create.variables?.submitted === true;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
        accounts={accounts}
        labels={labels}
        errors={errors}
        disabled={pending}
        onChange={changeValue}
        onPickFile={changeFile}
      />

      <KindFields
        kind={activeOutputKind}
        side="output"
        values={outputValues}
        accounts={accounts}
        labels={labels}
        errors={errors}
        disabled={pending}
        onChange={changeValue}
        onPickFile={changeFile}
      />

      {formError ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Project not created</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      {/*
        Two outcomes, one form: a draft can still be edited later, while a
        submitted project is queued and can no longer be deleted upstream.
        The draft button comes first so Enter picks the reversible action.
      */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" value="draft" variant="outline" disabled={pending}>
          {pending && !pendingSubmit ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {pending && !pendingSubmit ? "Saving…" : "Save as draft"}
        </Button>
        <Button type="submit" value="submit" disabled={pending}>
          {pendingSubmit ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {pendingSubmit ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
