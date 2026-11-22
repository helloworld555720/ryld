import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const valid = {
  AUTH_SERVICE_URL: "http://localhost:8080",
  API_URL: "https://api.example.com/",
};

describe("parseServerEnv", () => {
  it("accepts absolute URLs and strips trailing slashes", () => {
    const env = parseServerEnv(valid);
    expect(env.AUTH_SERVICE_URL).toBe("http://localhost:8080");
    expect(env.API_URL).toBe("https://api.example.com");
  });

  it("trims surrounding whitespace", () => {
    const env = parseServerEnv({ ...valid, API_URL: "  https://api.example.com  " });
    expect(env.API_URL).toBe("https://api.example.com");
  });

  it("rejects a missing variable", () => {
    expect(() => parseServerEnv({ ...valid, API_URL: undefined })).toThrow(/API_URL/);
  });

  it("rejects a value that is not an absolute URL", () => {
    expect(() => parseServerEnv({ ...valid, API_URL: "localhost:3001" })).toThrow(
      /API_URL/,
    );
    expect(() => parseServerEnv({ ...valid, AUTH_SERVICE_URL: "" })).toThrow(
      /AUTH_SERVICE_URL/,
    );
  });

  it("never returns a trailing slash (proxy URL joining depends on it)", () => {
    const env = parseServerEnv({ ...valid, AUTH_SERVICE_URL: "http://localhost:8080///" });
    expect(env.AUTH_SERVICE_URL).toBe("http://localhost:8080");
  });

  it("leaves MEDIA_BASE_URL undefined when it is unset or blank", () => {
    expect(parseServerEnv(valid).MEDIA_BASE_URL).toBeUndefined();
    expect(parseServerEnv({ ...valid, MEDIA_BASE_URL: "" }).MEDIA_BASE_URL).toBe(
      undefined,
    );
    expect(
      parseServerEnv({ ...valid, MEDIA_BASE_URL: "   " }).MEDIA_BASE_URL,
    ).toBeUndefined();
  });

  it("normalises a configured MEDIA_BASE_URL like the other URLs", () => {
    const env = parseServerEnv({
      ...valid,
      MEDIA_BASE_URL: "  https://media.example.com/bucket///  ",
    });
    expect(env.MEDIA_BASE_URL).toBe("https://media.example.com/bucket");
  });

  it("rejects a MEDIA_BASE_URL that is not an absolute http(s) URL", () => {
    for (const value of ["media.example.com", "/bucket", "ftp://media.example.com"]) {
      expect(() => parseServerEnv({ ...valid, MEDIA_BASE_URL: value }), value).toThrow(
        /MEDIA_BASE_URL/,
      );
    }
  });
});
