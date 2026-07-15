-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumes" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "file_name" TEXT,
    "file_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "role" TEXT,
    "tech_stack" TEXT[],
    "url" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiences" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "achieved_date" DATE,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "proficiency" TEXT,
    "content" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_style_samples" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "title" TEXT,
    "source" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "writing_style_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "timeframe" TEXT,
    "target_date" DATE,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opinions" (
    "id" TEXT NOT NULL,
    "profile_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "opinions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resumes_profile_id_key" ON "resumes"("profile_id");

-- CreateIndex
CREATE INDEX "projects_profile_id_idx" ON "projects"("profile_id");

-- CreateIndex
CREATE INDEX "experiences_profile_id_idx" ON "experiences"("profile_id");

-- CreateIndex
CREATE INDEX "achievements_profile_id_idx" ON "achievements"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_profile_id_name_key" ON "skills"("profile_id", "name");

-- CreateIndex
CREATE INDEX "writing_style_samples_profile_id_idx" ON "writing_style_samples"("profile_id");

-- CreateIndex
CREATE INDEX "goals_profile_id_idx" ON "goals"("profile_id");

-- CreateIndex
CREATE INDEX "opinions_profile_id_idx" ON "opinions"("profile_id");

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_style_samples" ADD CONSTRAINT "writing_style_samples_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opinions" ADD CONSTRAINT "opinions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Everything below is raw SQL Prisma's schema DSL cannot express: a trigger
-- targeting auth.users (a schema Prisma doesn't manage), a PL/pgSQL
-- function, and ENABLE ROW LEVEL SECURITY. Appended here (rather than run
-- as a one-off script) so it's part of Prisma's migration history and
-- re-runs automatically via `prisma migrate deploy` in every environment.
-- ─────────────────────────────────────────────────────────────────────────

-- Trigger: auto-create a public.profiles row whenever Supabase Auth creates
-- a new auth.users row. This is the only way Profile.id gets populated —
-- Prisma never inserts a Profile row itself.
--
-- SECURITY DEFINER + a pinned search_path are required together: SECURITY
-- DEFINER lets this function (owned by a privileged role) write into
-- public.profiles regardless of what role fires the trigger, and pinning
-- search_path to `public` prevents the classic SECURITY DEFINER search-path
-- hijack. Every object below is fully schema-qualified (auth.users,
-- public.profiles) as belt-and-suspenders on top of that.
--
-- IMPORTANT (load-bearing assumption): because this function runs
-- SECURITY DEFINER, the INSERT executes as the function's *owner*, not as
-- whatever role fired the trigger. RLS is enabled on public.profiles below
-- with NO policies, so this insert only succeeds if handle_new_user()'s
-- owner is also profiles' owner (or has BYPASSRLS) — true by default when
-- migrations run as the `postgres` role, as they do here. If this app's
-- Prisma connection (DATABASE_URL) is ever moved to a lower-privileged,
-- non-owner role, this same RLS-with-no-policy design would silently start
-- rejecting Prisma's own queries too, not just external PostgREST access —
-- re-verify this assumption before making that change.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- created_at/updated_at have no DB-level default from Prisma's side
  -- (@default(now()) and @updatedAt are both enforced at the Prisma Client
  -- query layer, not as database defaults/triggers), so this raw INSERT
  -- must set both explicitly or it would violate their NOT NULL constraint.
  --
  -- ON CONFLICT DO NOTHING: without this, any transient error on this
  -- insert (a retried webhook, a pre-existing row, a future NOT NULL column
  -- added to profiles without a default) would propagate and roll back the
  -- auth.users insert too - i.e. the failure mode wouldn't be "profile
  -- missing," it would be "user cannot sign up at all."
  insert into public.profiles (id, created_at, updated_at)
  values (new.id, now(), now())
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill: any auth.users rows that already existed before this trigger was
-- created (e.g. accounts registered while testing Milestone 1's auth flow)
-- won't have a matching profiles row yet, since triggers only fire on new
-- inserts. One-time catch-up so no existing account is left without one.
insert into public.profiles (id, created_at, updated_at)
select id, now(), now()
from auth.users
on conflict (id) do nothing;

-- Referential integrity: a profile cannot outlive its auth user. Prisma
-- can't declare this FK itself because it doesn't manage auth.users, so it
-- has to be added directly here. Without it, deleting a user via
-- `auth.admin.deleteUser` leaves a permanently orphaned profiles row (and
-- every facet row cascading from it) with no automated cleanup path.
-- ON DELETE CASCADE here, combined with the `onDelete: Cascade` already
-- declared on every facet table's relation to Profile in schema.prisma,
-- means deleting a user cleanly deletes their entire knowledge base.
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

-- Row Level Security: enabled on every public table in this milestone, with
-- NO permissive policies attached. This app's Next.js server layer - not
-- Supabase PostgREST/RLS - is the actual authorization boundary: Prisma
-- connects through a privileged Postgres role that bypasses RLS regardless
-- of any policies, so writing granular per-row policies here would add code
-- that is never actually exercised. RLS is enabled purely as defense-in-depth
-- (e.g. if an anon/PostgREST path against these tables is ever exposed), not
-- as the primary access-control mechanism. See the trigger comment above for
-- why this bypass assumption also needs to hold for signups to work at all.
alter table public.profiles              enable row level security;
alter table public.resumes               enable row level security;
alter table public.projects              enable row level security;
alter table public.experiences           enable row level security;
alter table public.achievements          enable row level security;
alter table public.skills                enable row level security;
alter table public.writing_style_samples enable row level security;
alter table public.goals                 enable row level security;
alter table public.opinions              enable row level security;
