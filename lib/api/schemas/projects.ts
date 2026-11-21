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
  /**
   * Added upstream 2026-11-21: `true` queues the project (`status: "pending"`),
   * `false` or omitted leaves `status: "draft"`. Always normalised to a boolean
   * so the BFF forwards exactly one shape.
   */
  submit: z.boolean().optional().default(false),
});

/**
 * `source` is `null` until a project has been processed; afterwards it is an
 * object with its own `type` discriminator (`hls` so far) and the artefacts that
 * were produced.
 *
 * Deliberately loose past `type`: the result kinds are the API's vocabulary, not
 * ours, and an unrecognised one must not fail the whole list — the card shows
 * nothing for a kind it cannot explain. The `type` is required, because an
 * object without one would be rendered from no registry at all.
 */
export const projectSourceSchema = z
  .object({ type: z.string().min(1) })
  .catchall(z.unknown());

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
    source: projectSourceSchema.nullable().optional(),
    /** Echoed by the API since 2026-11-21; older stored jobs may omit it. */
    submit: z.boolean().optional(),
  })
  .catchall(z.unknown());

export type Project = z.infer<typeof projectSchema>;

/** `GET /jobs/` answers with an array of the same shape (verified 2026-11-17). */
export const projectsListSchema = z.array(projectSchema);
