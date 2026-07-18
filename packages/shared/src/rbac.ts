/**
 * Role-based access control. A single policy map used by web (server actions,
 * API routes) and worker alike. Roles are strictly ordered; permissions are
 * explicit strings so audits can log exactly what was checked.
 */
export const ROLES = ["OWNER", "ADMIN", "OPERATOR", "REVIEWER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  OWNER: 5,
  ADMIN: 4,
  OPERATOR: 3,
  REVIEWER: 2,
  VIEWER: 1,
};

export const PERMISSIONS = [
  // read
  "org:read",
  "agents:read",
  "workflows:read",
  "runs:read",
  "approvals:read",
  "jobs:read",
  "schedules:read",
  "prompts:read",
  "assets:read",
  "integrations:read",
  "analytics:read",
  "costs:read",
  "errors:read",
  "audit:read",
  // operate
  "workflows:execute",
  "agents:execute",
  "jobs:manage",
  "schedules:manage",
  "assets:write",
  "prompts:write",
  // review
  "approvals:decide",
  // administer
  "agents:write",
  "workflows:write",
  "modules:manage",
  "integrations:manage",
  "costs:manage",
  "members:manage",
  "settings:manage",
  // owner-only
  "org:delete",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Minimum role required for each permission. */
const MIN_ROLE: Record<Permission, Role> = {
  "org:read": "VIEWER",
  "agents:read": "VIEWER",
  "workflows:read": "VIEWER",
  "runs:read": "VIEWER",
  "approvals:read": "VIEWER",
  "jobs:read": "VIEWER",
  "schedules:read": "VIEWER",
  "prompts:read": "VIEWER",
  "assets:read": "VIEWER",
  "integrations:read": "VIEWER",
  "analytics:read": "VIEWER",
  "costs:read": "VIEWER",
  "errors:read": "VIEWER",
  "audit:read": "REVIEWER",
  "approvals:decide": "REVIEWER",
  "workflows:execute": "OPERATOR",
  "agents:execute": "OPERATOR",
  "jobs:manage": "OPERATOR",
  "schedules:manage": "OPERATOR",
  "assets:write": "OPERATOR",
  "prompts:write": "OPERATOR",
  "agents:write": "ADMIN",
  "workflows:write": "ADMIN",
  "modules:manage": "ADMIN",
  "integrations:manage": "ADMIN",
  "costs:manage": "ADMIN",
  "members:manage": "ADMIN",
  "settings:manage": "ADMIN",
  "org:delete": "OWNER",
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[permission]];
}

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
