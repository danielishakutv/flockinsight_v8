// Pure permission catalog — safe to import from client OR server components.
// (No DB/session imports here; the server-only logic lives in permissions.ts.)

export type PermissionKey = string;

export type PermModule = {
  key: string;
  label: string;
  description: string;
  perms: { key: PermissionKey; label: string }[];
};

export const PERMISSION_CATALOG: PermModule[] = [
  {
    key: "attendance",
    label: "Attendance",
    description: "Record and review service headcounts.",
    perms: [
      { key: "attendance.view", label: "View" },
      { key: "attendance.manage", label: "Manage" },
    ],
  },
  {
    key: "giving",
    label: "Giving",
    description: "Offerings, tithes, donations and categories.",
    perms: [
      { key: "giving.view", label: "View" },
      { key: "giving.manage", label: "Manage" },
    ],
  },
  {
    key: "members",
    label: "Members",
    description: "The church congregation.",
    perms: [
      { key: "members.view", label: "View" },
      { key: "members.manage", label: "Manage" },
    ],
  },
  {
    key: "groups",
    label: "Groups & Ministries",
    description: "Groups, ministries and their members.",
    perms: [
      { key: "groups.view", label: "View" },
      { key: "groups.manage", label: "Manage" },
    ],
  },
  {
    key: "followup",
    label: "Follow-up",
    description: "Visitor and new-member follow-up.",
    perms: [
      { key: "followup.view", label: "View" },
      { key: "followup.manage", label: "Manage" },
    ],
  },
  {
    key: "communication",
    label: "Communication",
    description: "Send SMS, email and staff notices.",
    perms: [
      { key: "communication.view", label: "View" },
      { key: "communication.manage", label: "Send" },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Trends, breakdowns and reports.",
    perms: [{ key: "analytics.view", label: "View" }],
  },
  {
    key: "media",
    label: "Media library",
    description: "Sermons, photos and other uploaded files.",
    perms: [
      { key: "media.view", label: "View" },
      { key: "media.manage", label: "Upload & delete" },
    ],
  },
  {
    key: "forms",
    label: "Forms",
    description: "Build forms and collect responses.",
    perms: [
      { key: "forms.view", label: "View & responses" },
      { key: "forms.manage", label: "Create & edit" },
    ],
  },
  {
    key: "settings",
    label: "Church settings",
    description: "Church profile, services and giving categories.",
    perms: [{ key: "settings.manage", label: "Manage" }],
  },
  {
    key: "team",
    label: "Team & roles",
    description: "Invite people, and create roles & permissions.",
    perms: [{ key: "team.manage", label: "Manage" }],
  },
];

export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_CATALOG.flatMap((m) =>
  m.perms.map((p) => p.key),
);

/** Sensible starting permissions for the seeded "Member" role. */
export const MEMBER_DEFAULT_PERMISSIONS: PermissionKey[] = [
  "attendance.view",
  "members.view",
  "groups.view",
];
