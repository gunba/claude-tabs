export interface Socks5Parts {
  protocol: "socks5" | "socks5h";
  host: string;
  port: string;
  username: string;
  password: string;
}

const EMPTY: Socks5Parts = { protocol: "socks5h", host: "", port: "", username: "", password: "" };

// Matches: socks5[h]://[user:pass@]host_or_[ipv6]:port
const SOCKS5_RE = /^socks5(h?):\/\/(?:([^:@]*):([^@]*)@)?(\[[\da-fA-F:]+\]|[^:\/]+)(?::(\d+))?\/?$/;

export function parseSocks5Url(url: string | null | undefined): Socks5Parts {
  if (!url) return { ...EMPTY };
  const m = url.trim().match(SOCKS5_RE);
  if (!m) return { ...EMPTY };
  return {
    protocol: m[1] ? "socks5h" : "socks5",
    host: m[4] ?? "",
    port: m[5] ?? "",
    username: safeDecodeComponent(m[2] ?? ""),
    password: safeDecodeComponent(m[3] ?? ""),
  };
}

export function buildSocks5Url(parts: Socks5Parts): string | null {
  const host = parts.host.trim();
  if (!host) return null;

  const proto = `${parts.protocol}://`;
  const user = parts.username;
  const pass = parts.password;
  const auth = user || pass
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
    : "";
  const port = parts.port.trim();
  const portSuffix = port ? `:${port}` : "";

  return `${proto}${auth}${host}${portSuffix}`;
}

function safeDecodeComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
