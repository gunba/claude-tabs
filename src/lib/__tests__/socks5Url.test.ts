import { describe, it, expect } from "vitest";
import { parseSocks5Url, buildSocks5Url } from "../socks5Url";
import type { Socks5Parts } from "../socks5Url";

const EMPTY: Socks5Parts = { protocol: "socks5h", host: "", port: "", username: "", password: "" };

// ── parseSocks5Url ──────────────────────────────────────────────

describe("parseSocks5Url", () => {
  it("returns defaults for null", () => {
    expect(parseSocks5Url(null)).toEqual(EMPTY);
  });

  it("returns defaults for undefined", () => {
    expect(parseSocks5Url(undefined)).toEqual(EMPTY);
  });

  it("returns defaults for empty string", () => {
    expect(parseSocks5Url("")).toEqual(EMPTY);
  });

  it("returns defaults for malformed URL", () => {
    expect(parseSocks5Url("http://example.com")).toEqual(EMPTY);
  });

  it("parses socks5h with auth and port", () => {
    expect(parseSocks5Url("socks5h://user:pass@host:1080")).toEqual({
      protocol: "socks5h", host: "host", port: "1080", username: "user", password: "pass",
    });
  });

  it("parses socks5 (no h) with auth and port", () => {
    expect(parseSocks5Url("socks5://user:pass@host:1080")).toEqual({
      protocol: "socks5", host: "host", port: "1080", username: "user", password: "pass",
    });
  });

  it("parses without auth", () => {
    expect(parseSocks5Url("socks5h://host:1080")).toEqual({
      protocol: "socks5h", host: "host", port: "1080", username: "", password: "",
    });
  });

  it("parses without port", () => {
    expect(parseSocks5Url("socks5h://host")).toEqual({
      protocol: "socks5h", host: "host", port: "", username: "", password: "",
    });
  });

  it("parses IPv6 host", () => {
    expect(parseSocks5Url("socks5h://user:pass@[::1]:1080")).toEqual({
      protocol: "socks5h", host: "[::1]", port: "1080", username: "user", password: "pass",
    });
  });

  it("decodes URL-encoded username and password", () => {
    expect(parseSocks5Url("socks5h://us%40er:p%3Ass@host:1080")).toEqual({
      protocol: "socks5h", host: "host", port: "1080", username: "us@er", password: "p:ss",
    });
  });

  it("trims whitespace", () => {
    expect(parseSocks5Url("  socks5h://host:1080  ")).toEqual({
      protocol: "socks5h", host: "host", port: "1080", username: "", password: "",
    });
  });

  it("handles trailing slash", () => {
    expect(parseSocks5Url("socks5h://host:1080/")).toEqual({
      protocol: "socks5h", host: "host", port: "1080", username: "", password: "",
    });
  });
});

// ── buildSocks5Url ──────────────────────────────────────────────

describe("buildSocks5Url", () => {
  it("returns null for empty host", () => {
    expect(buildSocks5Url({ ...EMPTY })).toBeNull();
  });

  it("returns null for whitespace-only host", () => {
    expect(buildSocks5Url({ ...EMPTY, host: "   " })).toBeNull();
  });

  it("builds basic URL with host only", () => {
    expect(buildSocks5Url({ ...EMPTY, host: "proxy.example.com" }))
      .toBe("socks5h://proxy.example.com");
  });

  it("builds URL with host and port", () => {
    expect(buildSocks5Url({ ...EMPTY, host: "host", port: "1080" }))
      .toBe("socks5h://host:1080");
  });

  it("builds URL with auth", () => {
    expect(buildSocks5Url({ protocol: "socks5h", host: "host", port: "1080", username: "user", password: "pass" }))
      .toBe("socks5h://user:pass@host:1080");
  });

  it("encodes special characters in password", () => {
    expect(buildSocks5Url({ protocol: "socks5h", host: "host", port: "1080", username: "user", password: "p@ss:word" }))
      .toBe("socks5h://user:p%40ss%3Aword@host:1080");
  });

  it("includes both fields when only username is set", () => {
    expect(buildSocks5Url({ ...EMPTY, host: "host", port: "1080", username: "user" }))
      .toBe("socks5h://user:@host:1080");
  });

  it("includes both fields when only password is set", () => {
    expect(buildSocks5Url({ ...EMPTY, host: "host", port: "1080", password: "pass" }))
      .toBe("socks5h://:pass@host:1080");
  });

  it("uses socks5 protocol", () => {
    expect(buildSocks5Url({ protocol: "socks5", host: "host", port: "1080", username: "", password: "" }))
      .toBe("socks5://host:1080");
  });

  it("round-trips with parse", () => {
    const url = "socks5h://us%40er:p%3Ass@host:1080";
    const parts = parseSocks5Url(url);
    expect(buildSocks5Url(parts)).toBe(url);
  });
});
