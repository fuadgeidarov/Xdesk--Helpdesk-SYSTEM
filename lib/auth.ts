import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "./prisma";

const COOKIE = "xdesk_session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  // ISO timestamp used only for cache-busting the profile image in shared UI.
  // Optional so JWT/session creation remains independent from profile media.
  avatarUpdatedAt?: string | null;
};

type SessionClaims = SessionUser & { sessionVersion: number };

function sessionTtlSeconds() {
  const hours = Number(process.env.SESSION_TTL_HOURS || 24);
  const safeHours = Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.floor(hours))) : 24;
  return safeHours * 60 * 60;
}

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  if (secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionClaims) {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sv: user.sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + sessionTtlSeconds())
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.id !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.sv !== "number"
    ) {
      return null;
    }
    return {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role as Role,
      sessionVersion: payload.sv,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Only mark the cookie Secure when the deployment is actually served over
    // HTTPS. Tying this to NODE_ENV=production breaks logins whenever the app
    // is reached over plain HTTP (e.g. http://server-ip:3000 without a TLS
    // reverse proxy) — the browser silently drops a Secure cookie on non-HTTPS
    // connections, so the session is never stored and every login bounces
    // straight back to the login page. Set COOKIE_SECURE=true in the
    // environment once you put Xdesk behind HTTPS.
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: sessionTtlSeconds(),
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;

  // A disabled account must lose access immediately, rather than retaining a
  // previously issued seven-day JWT until it expires.
  const activeUser = await prisma.user.findFirst({
    where: { id: session.id, isActive: true, isBlocked: false },
    select: { id: true, email: true, name: true, role: true, sessionVersion: true, avatarUpdatedAt: true },
  });
  if (!activeUser || activeUser.sessionVersion !== session.sessionVersion) return null;
  // Use current database values instead of stale JWT claims so blocking and
  // role changes take effect on the very next request.
  return {
    id: activeUser.id,
    email: activeUser.email,
    name: activeUser.name,
    role: activeUser.role,
    avatarUpdatedAt: activeUser.avatarUpdatedAt?.toISOString() || null,
  };
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function getFullUser() {
  const session = await getSessionUser();
  if (!session) return null;
  return prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      email: true,
      name: true,
      department: true,
      position: true,
      phone: true,
      address: true,
      store: true,
      avatarUpdatedAt: true,
      role: true,
      presenceStatus: true,
      createdAt: true,
    },
  });
}

export function isStaff(role: Role) {
  return role === Role.AGENT || role === Role.ADMIN;
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
