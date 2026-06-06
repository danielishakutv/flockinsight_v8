# FlockInsight

Modern, mobile-first **church management** platform. Multi-church (SaaS), superfast, with a bold, clean UI.

> v1 scope: **Auth · Dashboard · Attendance recording & analytics**, plus Members and Settings.

## Stack

- **Next.js 16** (App Router, React Server Components, Turbopack) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (bold indigo design system, light/dark)
- **Drizzle ORM** + **PostgreSQL**
- **Better Auth** (email/password + organization plugin for multi-tenancy)
- **Recharts** for analytics

## Architecture

- **Multi-tenant:** every record is scoped by `church_id`.
  - Better Auth `organization` → table **`church`** (the tenant)
  - Better Auth `member` → table **`staff`** (people who log in + their role)
  - **`member`** table = the **congregation** (a separate concept)
- Route protection via [`src/proxy.ts`](src/proxy.ts); tenant resolution via [`src/lib/session.ts`](src/lib/session.ts) (`requireChurch()`).

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill in DATABASE_URL + BETTER_AUTH_SECRET
pnpm db:migrate               # create tables
pnpm db:seed                  # optional: demo church + 40 members + 12 weeks of attendance
pnpm dev                      # http://localhost:3000
```

**Demo login** (after seeding): `demo@flockinsight.app` / `demo1234`

### Database scripts

| Command | Purpose |
|---|---|
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:push` | Push schema directly (dev) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | Seed demo data |

## Features

- **Auth** — church sign-up (creates tenant + owner), login, sessions, route protection.
- **Dashboard** — big-number stat cards (last service, weekly average + growth, members, first-timers), 12-week trend chart, recent services.
- **Record attendance** — fast, mobile-first headcount steppers (men/women/children/first-timers/new converts) with live total; per service + date; upserts so re-recording edits.
- **Attendance history** — grouped by month; edit and delete.
- **Analytics** — weekly breakdown (stacked), demographics donut, average-by-service, growth KPIs.
- **Members** — searchable congregation CRUD with status.
- **Settings** — church profile, services CRUD, team & roles (invitations with shareable links).

## Notes

- `next.config.ts` marks `better-auth`/`kysely` as `serverExternalPackages` (required for Turbopack), and `package.json` pins `kysely` to `0.28.17` via a pnpm override (the bundled Better Auth kysely adapter needs exports that 0.29.x removed).
- Brand colors and the full design token set live in [`src/app/globals.css`](src/app/globals.css).
- Future ideas: individual member check-in during recording, donations, events, communications, CSV import, email delivery for invitations.

---

© Toko Technologies — FlockInsight
