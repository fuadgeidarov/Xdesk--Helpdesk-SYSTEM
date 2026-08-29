import { Role } from "@prisma/client";

export function canViewKnowledge(role: Role) {
  return role === Role.USER || role === Role.AGENT || role === Role.ADMIN;
}

export function canManageKnowledge(role: Role) {
  return role === Role.ADMIN;
}

export function canViewAnalytics(role: Role) {
  return role === Role.AGENT || role === Role.ADMIN;
}

export function canViewUsers(role: Role) {
  return role === Role.AGENT || role === Role.ADMIN;
}

export function canManageUsers(role: Role) {
  return role === Role.ADMIN;
}

export function canSetPresence(role: Role) {
  return role === Role.AGENT || role === Role.ADMIN;
}

export function canViewAllTickets(role: Role) {
  return role === Role.AGENT || role === Role.ADMIN;
}
