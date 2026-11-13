import { describe, expect, it } from "vitest";

import {
  ApiError,
  codeFromStatus,
  isApiError,
  toErrorResponse,
  toUserMessage,
} from "@/lib/errors";

describe("codeFromStatus", () => {
  it("maps upstream statuses to stable codes", () => {
    expect(codeFromStatus(401)).toBe("UNAUTHORIZED");
    expect(codeFromStatus(403)).toBe("FORBIDDEN");
    expect(codeFromStatus(404)).toBe("NOT_FOUND");
    expect(codeFromStatus(409)).toBe("CONFLICT");
    expect(codeFromStatus(422)).toBe("VALIDATION");
    expect(codeFromStatus(504)).toBe("TIMEOUT");
    expect(codeFromStatus(400)).toBe("VALIDATION");
    expect(codeFromStatus(500)).toBe("UPSTREAM");
    expect(codeFromStatus(503)).toBe("UPSTREAM");
  });
});

describe("ApiError", () => {
  it("derives a code from the status and exposes a safe message", () => {
    const error = new ApiError({ status: 502 });
    expect(error.code).toBe("UPSTREAM");
    expect(isApiError(error)).toBe(true);
    expect(error.message).toMatch(/trouble right now/i);
  });

  it("keeps technical detail out of the user-facing message", () => {
    const error = new ApiError({
      status: 502,
      detail: "upstream said: SQLSTATE 23505 duplicate key",
    });
    expect(error.detail).toContain("SQLSTATE");
    expect(toUserMessage(error)).not.toContain("SQLSTATE");
  });
});

describe("toUserMessage", () => {
  it("never surfaces an unknown error", () => {
    expect(toUserMessage(new Error("secret internals"))).not.toContain("secret");
    expect(toUserMessage("boom")).toMatch(/something went wrong/i);
  });
});

describe("toErrorResponse", () => {
  it("serialises errors without leaking detail", () => {
    const { body, status } = toErrorResponse(
      new ApiError({
        status: 502,
        code: "UPSTREAM",
        detail: "ECONNREFUSED 10.0.0.5:9000",
        requestId: "req-1",
      }),
    );

    const serialised = JSON.stringify(body);
    expect(status).toBe(502);
    expect(serialised).not.toContain("ECONNREFUSED");
    expect(serialised).toContain("req-1");
  });

  it("turns an unknown throw into a generic 500", () => {
    const { body, status } = toErrorResponse(new Error("kaboom"), "req-2");
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("kaboom");
  });
});
