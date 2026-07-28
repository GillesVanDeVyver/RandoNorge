#!/usr/bin/env bash
#
# Move the production D1 database into Cloudflare's EU jurisdiction.
#
# A jurisdiction can only be set when a database is created, so this is a
# create-and-copy: new database, export, import, verify, swap the binding,
# deploy. docs/D1-EU-JURISDICTION-MIGRATION.md is the prose version and the
# authority on *why*; this is the same ten steps with the checks that are easy
# to skip when typing them by hand at the end of a long evening.
#
# What it will not do, on purpose:
#
#   * delete anything. Not the old database, not the dump. Those are step 10,
#     after a week of the new database working, and they are the two commands
#     you cannot take back;
#   * proceed past a failed check. Every guard is fail-closed: an unverified
#     jurisdiction, a count that does not match, a table missing a cascade, a
#     config it cannot edit unambiguously — each stops the run rather than
#     carrying on and leaving you to notice later;
#   * edit the privacy policy. Step 9 is a judgement about wording, and the
#     policy may only claim the restriction once `d1 info` shows it.
#
# Usage:
#
#   scripts/migrate-d1-to-eu.sh              # interactive, from the top
#   scripts/migrate-d1-to-eu.sh --dry-run    # read-only: shows what it would do
#   scripts/migrate-d1-to-eu.sh --from 5     # resume at a step
#   scripts/migrate-d1-to-eu.sh --yes        # no prompts (used by the harness)
#
# Every step is safe to re-run: an existing database is reused, an already
# imported table set is not imported twice, migration bookkeeping is inserted
# with `insert or ignore`, and the config swap refuses if it is already done.
#
# Tested by scripts/verify-eu-migration.py, which drives the whole thing
# against a stub wrangler backed by two local SQLite files — including the
# failure paths, because a guardrail nobody has seen fire is a guess.

set -euo pipefail

OLD_NAME=${OLD_NAME:-fjellrute-db}
NEW_NAME=${NEW_NAME:-fjellrute-db-eu}
# The id currently in wrangler.jsonc. Checked, not used to address anything:
# if the config points somewhere else, this script is out of date and the
# situation needs a human.
OLD_ID=${OLD_ID:-fc24cf1f-35c7-4c9d-8a5a-4de38a3865fb}
DUMP=${DUMP:-fjellrute-dump.sql}
CONFIG=${CONFIG:-wrangler.jsonc}
# Overridable so the harness can substitute a stub. Deliberately unquoted at
# the call site: the default is two words.
WRANGLER=${WRANGLER:-npx wrangler}

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LIB="$REPO/scripts/lib"
cd "$REPO"

DRY_RUN=0
ASSUME_YES=0
FROM_STEP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --from)
      [ $# -ge 2 ] || { echo "--from needs a step number" >&2; exit 2; }
      FROM_STEP="$2"
      shift
      ;;
    -h | --help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- output ----------------------------------------------------------------
step() { printf '\n=== step %s — %s\n' "$1" "$2"; }
ok() { printf '  ok    %s\n' "$1"; }
info() { printf '  ..    %s\n' "$1"; }
die() {
  printf '\n  STOP  %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '        %s\n' "$line" >&2; done
  exit 1
}

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  local reply
  printf '  ??    %s [y/N] ' "$1"
  read -r reply || reply=n
  case "$reply" in [yY] | [yY][eE][sS]) return 0 ;; *) die "cancelled" ;; esac
}

# wrangler, for reads. Unquoted expansion is deliberate (see WRANGLER above).
# shellcheck disable=SC2086
w() { $WRANGLER "$@"; }

# wrangler, for anything that changes state. --dry-run stops here and nowhere
# else, which is what makes --dry-run trustworthy.
mutate() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '  (dry) %s %s\n' "$WRANGLER" "$*"
    return 0
  fi
  w "$@"
}

field() { python3 "$LIB/d1-rows.py" --field "$1"; }
column() { python3 "$LIB/d1-rows.py" --column "$1"; }

# The tables that hold our data. sqlite_* is SQLite's own, _cf_* is D1's, and
# d1_migrations is bookkeeping reconciled separately in step 6 — it is expected
# to differ between the two databases until then.
TABLE_QUERY="select name from sqlite_master where type = 'table'
  and name not like 'sqlite_%' and name not like '_cf_%'
  and name <> 'd1_migrations' order by name"
CASCADE_QUERY="select name from sqlite_master where type = 'table'
  and lower(sql) like '%on delete cascade%' order by name"

tables_of() {
  w d1 execute "$1" --remote --json --command "$TABLE_QUERY" | column name
}

# One row of counts, as TSV, so a whole database is one comparable string.
counts_of() {
  local db="$1" sql="select " first=1 t
  while read -r t; do
    [ -z "$t" ] && continue
    [ "$first" = 1 ] || sql+=", "
    sql+="(select count(*) from \"$t\") as \"$t\""
    first=0
  done
  if [ "$first" = 1 ]; then
    echo "(no tables)"
    return 0
  fi
  w d1 execute "$db" --remote --json --command "$sql;" \
    | python3 "$LIB/d1-rows.py" --tsv
}

# The jurisdiction, as one of: eu / none / unknown. "unknown" is not treated as
# "fine": the restriction is the entire point of the exercise, so if wrangler
# will not say, a human looks.
jurisdiction_of() {
  local out status value
  out=$(w d1 info "$1" --json 2>/dev/null) || return 1
  set +e
  value=$(printf '%s' "$out" | field jurisdiction)
  status=$?
  set -e
  if [ "$status" = 3 ]; then
    # Older wranglers only print it in the human-readable table.
    if w d1 info "$1" 2>/dev/null | grep -qi 'jurisdiction'; then
      w d1 info "$1" | grep -i 'jurisdiction' | grep -qi 'eu' \
        && { echo eu; return 0; }
      echo none
      return 0
    fi
    echo unknown
    return 0
  fi
  case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" in
    eu) echo eu ;;
    '' | null | none) echo none ;;
    *) echo "$value" ;;
  esac
}

# ===========================================================================
step1_preflight() {
  step 1 "preflight"

  [ -f "$CONFIG" ] && [ -d migrations ] \
    || die "run this from the repository root" "expected $CONFIG and migrations/"

  w whoami >/dev/null 2>&1 \
    || die "wrangler is not authenticated" \
      "npx wrangler logout && npx wrangler login" \
      "(an expired OAuth token reports 'Authentication error [code: 10000]'" \
      " while still listing d1 (write) among the scopes)"
  ok "wrangler is authenticated"

  grep -q -- '-dump.sql' .gitignore \
    || die "'*-dump.sql' is not in .gitignore" \
      "the dump holds every account, address and GPS track in the service"
  ok "the dump pattern is git-ignored"

  local configured
  configured=$(grep -o '"database_id": *"[^"]*"' "$CONFIG" | head -1 \
    | sed 's/.*"\([^"]*\)"$/\1/')
  if [ "$configured" != "$OLD_ID" ]; then
    if [ "$configured" = "$(new_id 2>/dev/null || true)" ]; then
      die "$CONFIG already points at $NEW_NAME" \
        "step 7 has run; resume with --from 8"
    fi
    die "$CONFIG points at a database this script does not know about" \
      "config: $configured" "expected: $OLD_ID" \
      "set OLD_ID= if that is deliberate"
  fi
  ok "$CONFIG still points at $OLD_NAME"

  local old_j
  old_j=$(jurisdiction_of "$OLD_NAME") \
    || die "cannot reach $OLD_NAME" "check the name and that wrangler is logged in"
  if [ "$old_j" = eu ]; then
    echo
    ok "$OLD_NAME is already in the EU jurisdiction — nothing to do"
    exit 0
  fi
  ok "$OLD_NAME jurisdiction: $old_j (this is what we are fixing)"

  if [ -e "$DUMP" ]; then
    die "$DUMP already exists" \
      "it is a full copy of everyone's personal data from an earlier run" \
      "inspect it, then remove it before starting again"
  fi
  ok "no leftover dump in the way"

  if command -v git >/dev/null && ! git diff --quiet -- "$CONFIG" 2>/dev/null; then
    info "$CONFIG has uncommitted changes; step 7 will back it up before editing"
  fi

  echo
  info "this run will create $NEW_NAME, copy $OLD_NAME into it, and swap the binding"
  info "it will not delete the old database or the dump"
  confirm "continue?"
}

# The new database's id, or empty. Never fails: callers decide what an empty
# answer means, and `set -e` would otherwise turn "not created yet" into an
# abort inside the preflight check that is only asking.
new_id() {
  local out
  out=$(w d1 info "$NEW_NAME" --json 2>/dev/null) || return 0
  printf '%s' "$out" | field uuid 2>/dev/null \
    || printf '%s' "$out" | field database_id 2>/dev/null \
    || true
}

# ===========================================================================
step2_create() {
  step 2 "create $NEW_NAME in the EU jurisdiction"

  if w d1 info "$NEW_NAME" >/dev/null 2>&1; then
    info "$NEW_NAME already exists — reusing it"
  else
    mutate d1 create "$NEW_NAME" --jurisdiction eu
  fi

  if [ "$DRY_RUN" = 1 ]; then
    info "(dry) would then require 'd1 info $NEW_NAME' to report jurisdiction eu"
    return 0
  fi

  local j
  j=$(jurisdiction_of "$NEW_NAME") || die "cannot reach $NEW_NAME after creating it"
  case "$j" in
    eu) ok "jurisdiction eu confirmed" ;;
    unknown)
      die "wrangler did not report a jurisdiction for $NEW_NAME" \
        "run 'npx wrangler d1 info $NEW_NAME' and read it yourself" \
        "do not continue until it says eu — it cannot be added later" ;;
    *)
      die "$NEW_NAME was created without the EU jurisdiction (got: $j)" \
        "a jurisdiction cannot be added to an existing database, so:" \
        "  npx wrangler d1 delete $NEW_NAME" \
        "then run this script again" ;;
  esac
}

# ===========================================================================
step3_export() {
  step 3 "export $OLD_NAME"

  if [ -s "$DUMP" ]; then
    info "$DUMP already exists and is not empty — reusing it"
  else
    mutate d1 export "$OLD_NAME" --remote --output "$DUMP"
  fi

  if [ "$DRY_RUN" = 1 ] && [ ! -s "$DUMP" ]; then
    info "(dry) would then check the dump against the live table list"
    return 0
  fi

  [ -s "$DUMP" ] || die "$DUMP is empty" "the export produced nothing"

  local in_dump live
  in_dump=$(grep -c -i 'create table' "$DUMP" || true)
  live=$(tables_of "$OLD_NAME" | grep -c . || true)
  info "tables in the dump: $in_dump; in $OLD_NAME (excl. bookkeeping): $live"
  [ "$in_dump" -ge "$live" ] || die \
    "the dump has fewer CREATE TABLE statements than the database has tables" \
    "do not import a partial dump"
  ok "the dump covers every table"

  if grep -qi 'd1_migrations' "$DUMP"; then
    info "the dump carries d1_migrations, so step 6 will have little to do"
  else
    info "the dump has no d1_migrations; step 6 will reconcile it"
  fi
  info "remember: $DUMP is everyone's personal data sitting in this directory"
}

# ===========================================================================
step4_import() {
  step 4 "import into $NEW_NAME"

  local existing
  existing=$(tables_of "$NEW_NAME" 2>/dev/null | grep -c . || true)
  if [ "${existing:-0}" -gt 0 ]; then
    info "$NEW_NAME already has $existing tables — skipping the import"
    info "if that import was partial, delete the database and start again"
    return 0
  fi

  mutate d1 execute "$NEW_NAME" --remote --file "$DUMP"
}

# ===========================================================================
step5_verify() {
  step 5 "verify the copy"

  if [ "$DRY_RUN" = 1 ]; then
    info "(dry) would compare table lists, row counts and cascades"
    return 0
  fi

  local old_tables new_tables
  old_tables=$(tables_of "$OLD_NAME")
  new_tables=$(tables_of "$NEW_NAME")
  if [ "$old_tables" != "$new_tables" ]; then
    printf '  old:\n%s\n  new:\n%s\n' "$old_tables" "$new_tables" >&2
    die "the two databases do not have the same tables"
  fi
  ok "same tables ($(printf '%s' "$old_tables" | grep -c . || true))"

  local old_counts new_counts
  old_counts=$(printf '%s\n' "$old_tables" | counts_of "$OLD_NAME")
  new_counts=$(printf '%s\n' "$old_tables" | counts_of "$NEW_NAME")
  printf '%s\n' "$old_counts" | sed 's/^/        /'
  if [ "$old_counts" != "$new_counts" ]; then
    printf '  new:\n' >&2
    printf '%s\n' "$new_counts" | sed 's/^/        /' >&2
    die "row counts differ between $OLD_NAME and $NEW_NAME" \
      "do not swap the binding; delete $NEW_NAME and start again"
  fi
  ok "every row count matches"

  # The deletion story in docs/REMOVE_USER.md is entirely cascades: if they did
  # not survive the copy, deleting an account would silently orphan its routes
  # and tracks instead of removing them.
  local old_c new_c
  old_c=$(w d1 execute "$OLD_NAME" --remote --json --command "$CASCADE_QUERY" | column name)
  new_c=$(w d1 execute "$NEW_NAME" --remote --json --command "$CASCADE_QUERY" | column name)
  [ "$old_c" = "$new_c" ] || {
    printf '  old: %s\n  new: %s\n' "$old_c" "$new_c" >&2
    die "the foreign-key cascades did not survive the copy"
  }
  local t
  for t in session account route track; do
    printf '%s\n' "$new_c" | grep -qx "$t" \
      || die "table \"$t\" has no ON DELETE CASCADE in $NEW_NAME" \
        "account deletion depends on it (docs/REMOVE_USER.md)"
  done
  ok "cascades intact: $(printf '%s' "$new_c" | tr '\n' ' ')"
}

# ===========================================================================
step6_migrations() {
  step 6 "reconcile the migrations record"

  if [ "$DRY_RUN" = 1 ]; then
    info "(dry) would copy d1_migrations rows from $OLD_NAME into $NEW_NAME"
    return 0
  fi

  # Copied from the old database rather than generated from migrations/: what
  # is true of the new database is exactly what was true of the old one. A
  # hardcoded list goes stale the moment a migration is added (0007 did), and
  # claiming a migration ran when it did not is worse than the reverse — the
  # next `migrations apply` would skip it forever.
  local applied
  applied=$(w d1 execute "$OLD_NAME" --remote --json \
    --command 'select name from d1_migrations order by name' 2>/dev/null \
    | column name || true)

  if [ -z "$applied" ]; then
    info "$OLD_NAME has no d1_migrations rows either — nothing to copy"
    info "run 'npx wrangler d1 migrations list $NEW_NAME --remote' before applying anything"
    return 0
  fi

  local values="" name
  while read -r name; do
    [ -z "$name" ] && continue
    [ -n "$values" ] && values+=", "
    values+="('$name', datetime('now'))"
  done <<<"$applied"

  mutate d1 execute "$NEW_NAME" --remote --command \
    "create table if not exists d1_migrations (
       id integer primary key autoincrement,
       name text unique,
       applied_at datetime not null default current_timestamp);
     insert or ignore into d1_migrations (name, applied_at) values $values;"
  ok "copied $(printf '%s' "$applied" | grep -c . || true) migration record(s)"

  info "anything in migrations/ that never ran on $OLD_NAME is still pending:"
  info "  npx wrangler d1 migrations list $NEW_NAME --remote"
}

# ===========================================================================
step7_swap() {
  step 7 "point the Worker at $NEW_NAME"

  local id
  id=$(new_id || true)
  if [ "$DRY_RUN" = 1 ] && [ -z "$id" ]; then
    info "(dry) would rewrite the DB binding in $CONFIG and back it up"
    return 0
  fi
  [ -n "$id" ] || die "could not read the id of $NEW_NAME" \
    "npx wrangler d1 info $NEW_NAME"

  local tmp
  tmp=$(mktemp)
  python3 "$LIB/swap-d1-binding.py" "$CONFIG" "$NEW_NAME" "$id" >"$tmp" || {
    rm -f "$tmp"
    die "could not rewrite $CONFIG unambiguously" "edit it by hand: $NEW_NAME / $id"
  }

  echo
  diff -u "$CONFIG" "$tmp" | sed 's/^/  /' || true
  echo
  if [ "$DRY_RUN" = 1 ]; then
    rm -f "$tmp"
    info "(dry) the diff above is what would be written"
    return 0
  fi
  confirm "apply this change to $CONFIG?"

  local backup="$CONFIG.bak-$(date +%Y%m%d%H%M%S)"
  cp "$CONFIG" "$backup"
  cat "$tmp" >"$CONFIG"
  rm -f "$tmp"
  ok "written; original kept at $backup"

  # The local dev database is keyed to the binding, so dev now starts empty.
  mutate d1 migrations apply "$NEW_NAME" --local
  ok "local dev database rebuilt from migrations/"
}

# ===========================================================================
step8_deploy() {
  step 8 "deploy and smoke-test"

  confirm "deploy the Worker against $NEW_NAME now?"
  mutate deploy

  cat <<'TXT'

  Now, against the deployed site, in this order:

    1. sign in                  (session write + read)
    2. open the route library   (read)
    3. save a route             (write — the failure worth catching)
    4. delete that route        (write + cascade)

  A read-only check is not enough: a Worker pointed at a database that no
  longer exists still serves the app shell perfectly.

  If anything fails: put the old database_name and database_id back (they are
  in the comment step 7 left in wrangler.jsonc) and redeploy. The old database
  is untouched and still has every row.
TXT
}

# ===========================================================================
step9_and_10() {
  step 9 "strengthen the privacy policy — by hand"
  cat <<TXT
  Only now may §4 claim the restriction. Replace the hedge about Cloudflare's
  worldwide network with a straight statement that the database is restricted
  to EU data centres — in ALL FOUR places:

    src/terms/privacy.ts   (en + nb)      public/privacy.html   (en + nb)

  Then bump PRIVACY_VERSION in src/terms/privacy.ts AND
  worker/policyVersions.js, and run:

    pnpm test:privacy && pnpm test:policies

  The first fails if the two policy copies drift; the second if the two version
  constants do. Bumping the version re-presents the acceptance gate to every
  signed-in user, which is the point.

TXT

  step 10 "delete the old database and the dump — NOT done here"
  cat <<TXT
  Both are a second complete copy of everyone's personal data, so they are on a
  clock; keep them only as long as they are a useful rollback (a week is plenty
  at alpha scale). Then:

    rm $DUMP
    npx wrangler d1 delete $OLD_NAME

  Write the date you will do that into
  docs/D1-EU-JURISDICTION-MIGRATION.md — there is a line waiting for it.
TXT
}

# ===========================================================================
main() {
  printf 'D1 → EU jurisdiction: %s → %s\n' "$OLD_NAME" "$NEW_NAME"
  [ "$DRY_RUN" = 1 ] && printf 'DRY RUN — nothing will be changed\n'
  [ "$FROM_STEP" != 1 ] && printf 'starting at step %s\n' "$FROM_STEP"

  [ "$FROM_STEP" -le 1 ] && step1_preflight
  [ "$FROM_STEP" -le 2 ] && step2_create
  [ "$FROM_STEP" -le 3 ] && step3_export
  [ "$FROM_STEP" -le 4 ] && step4_import
  [ "$FROM_STEP" -le 5 ] && step5_verify
  [ "$FROM_STEP" -le 6 ] && step6_migrations
  [ "$FROM_STEP" -le 7 ] && step7_swap
  [ "$FROM_STEP" -le 8 ] && step8_deploy
  [ "$FROM_STEP" -le 9 ] && step9_and_10

  printf '\ndone. The old database still exists — step 10 is yours.\n'
}

main
