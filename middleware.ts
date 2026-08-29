import { NextRequest, NextResponse } from "next/server";

function configuredOrigin() {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function sameOrigin(req: NextRequest) {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  // When APP_URL is configured it is the authoritative public origin. This
  // avoids trusting attacker-controlled Host/X-Forwarded-* values.
  const configured = configuredOrigin();
  if (configured) return parsed.origin === configured;

  const trustProxy = process.env.TRUST_PROXY === "true";
  const host = trustProxy ? req.headers.get("x-forwarded-host") || req.headers.get("host") : req.headers.get("host");
  const proto = trustProxy
    ? req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "") || "http"
    : req.nextUrl.protocol.replace(":", "") || "http";
  return Boolean(host && parsed.origin === `${proto}://${host}`);
}

function addSecurityHeaders(res: NextResponse) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (process.env.COOKIE_SECURE === "true") res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  );
  return res;
}

export function middleware(req: NextRequest) {
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (req.nextUrl.pathname.startsWith("/api/") && mutating) {
    const contentType = req.headers.get("content-type") || "";
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (!contentType.includes("multipart/form-data") && Number.isFinite(contentLength) && contentLength > 256 * 1024) {
      return addSecurityHeaders(NextResponse.json({ error: "Запрос слишком большой" }, { status: 413 }));
    }
  }
  if (req.nextUrl.pathname.startsWith("/api/") && mutating && !sameOrigin(req)) {
    return addSecurityHeaders(NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 }));
  }
  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
