"use client";

import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Loader2, Plus, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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
  emptyFieldValues,
  getProjectInputKind,
  getProjectOutputKind,
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
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (side: Side, field: ProjectField, value: string) => void;
}

/**
 * Renders whatever fields a registry kind declares. The form has no knowledge
 * of YouTube or S3 beyond the registry entry, so a new source or destination
 * needs no change here.
 */
function KindFields({
  kind,
  side,
  values,
  errors,
  disabled,
  onChange,
}: KindFieldsProps) {
  if (kind.fields.length === 0) return null;

  return (
    <div className="space-y-4">
      {kind.fields.map((field) => {
        const id = `${side}-${field.name}`;
        const error = errors[`${side}.${field.name}`];

        return (
          <Field key={field.name} data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
            <Input
              id={id}
              name={id}
              type={field.inputType}
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

/**
 * Creates one project: a source, its fields, and a destination. Validation
 * uses the same schema the BFF applies, so a payload the browser accepts is
 * one the server will forward (and vice versa).
 */
export function CreateProjectForm() {
  const router = useRouter();

  const [inputType, setInputType] = useState(DEFAULT_INPUT.id);
  const [outputType, setOutputType] = useState(DEFAULT_OUTPUT.id);
  const [inputValues, setInputValues] = useState<Record<string, string>>(() =>
    emptyFieldValues(DEFAULT_INPUT),
  );
  const [outputValues, setOutputValues] = useState<Record<string, string>>(
    () => emptyFieldValues(DEFAULT_OUTPUT),
  );
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
      setInputValues(emptyFieldValues(activeInputKind));
      setOutputValues(emptyFieldValues(activeOutputKind));
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
      setInputValues(emptyFieldValues(kind));
    } else {
      setOutputType(id);
      setOutputValues(emptyFieldValues(kind));
    }

    setErrors({});
    setCreatedId(null);
    setFormError(null);
  }

  function changeValue(side: Side, field: ProjectField, value: string) {
    const update = (previous: Record<string, string>) => ({
      ...previous,
      [field.name]: value,
    });

    if (side === "input") setInputValues(update);
    else setOutputValues(update);

    const key = `${side}.${field.name}`;
    setErrors((previous) => {
      if (!previous[key]) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
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
            errors={errors}
            disabled={pending}
            onChange={changeValue}
          />

          <KindFields
            kind={activeOutputKind}
            side="output"
            values={outputValues}
            errors={errors}
            disabled={pending}
            onChange={changeValue}
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
