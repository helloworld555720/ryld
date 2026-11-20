import { z, type ZodType } from "zod";

import {
  PROJECT_INPUT_KINDS,
  PROJECT_OUTPUT_KINDS,
  type ProjectKind,
} from "@/lib/projects";

/**
 * Payloads for creating a project.
 *
 * The API calls the resource `jobs`, but this app does not: the request body
 * is assembled from the input/output registries, and only fields those
 * registries declare are forwarded. Anything extra the caller sends is
 * stripped by the object schemas, so the BFF never relays free-form input.
 */

/** One side of the request body: a known `type` plus that kind's fields. */
function kindSchema(kind: ProjectKind): ZodType {
  const fields = Object.fromEntries(
    kind.fields.map((field) => [field.name, field.schema]),
  );

  return z.object({ type: z.literal(kind.id), ...fields });
}

/** Unions the registered kinds. A single registered kind is still a union. */
function kindUnion(kinds: readonly ProjectKind[]): ZodType {
  return z.union(
    kinds.map(kindSchema) as [ZodType, ...ZodType[]],
  );
}

export const projectCreateSchema = z.object({
  input: kindUnion(PROJECT_INPUT_KINDS),
  output: kindUnion(PROJECT_OUTPUT_KINDS),
});

/** `POST /jobs/` answers with the created project; verified 2026-11-17. */
export const projectSchema = z
  .object({
    id: z.uuid(),
    input: z
      .object({ type: z.string().min(1) })
      .catchall(z.unknown()),
    output: z
      .object({ type: z.string().min(1) })
      .catchall(z.unknown()),
    status: z.string().min(1),
    source: z.unknown().nullable().optional(),
  })
  .catchall(z.unknown());

export type Project = z.infer<typeof projectSchema>;

/** `GET /jobs/` answers with an array of the same shape (verified 2026-11-17). */
export const projectsListSchema = z.array(projectSchema);
