"""Point the DB binding in wrangler.jsonc at a different D1 database.

Prints the rewritten file to stdout and never touches anything, so the caller
can diff it, back the original up and swap the two — see
scripts/migrate-d1-to-eu.sh, which is the only expected caller.

    python3 scripts/lib/swap-d1-binding.py wrangler.jsonc NEW_NAME NEW_ID

The file is JSONC — it carries the comments that explain the binding, including
the warning about `"remote": true` — so it is edited as text rather than parsed
and re-serialised, which would throw every one of those comments away.

Two guardrails, because a config that is subtly wrong here means a Worker
talking to the wrong database or to none:

  * exactly one "database_name" and one "database_id" must match, or nothing is
    printed and the exit code is non-zero. If the file ever grows a second D1
    binding, this needs a human, not a regex;
  * the previous name and id are left behind in a comment with today's date, so
    a rollback does not depend on anyone finding this file's git history.
"""

import datetime
import re
import sys


def swap(text, new_name, new_id, today=None):
    today = today or datetime.date.today().isoformat()

    name_re = re.compile(r'^(\s*)"database_name":\s*"([^"]+)",\s*$', re.M)
    id_re = re.compile(r'^(\s*)"database_id":\s*"([^"]+)",?\s*$', re.M)

    names = name_re.findall(text)
    ids = id_re.findall(text)
    if len(names) != 1 or len(ids) != 1:
        raise SystemExit(
            f'expected exactly one database_name and one database_id, '
            f'found {len(names)} and {len(ids)} — edit the config by hand'
        )

    indent, old_name = names[0]
    _, old_id = ids[0]
    if old_name == new_name and old_id == new_id:
        raise SystemExit(f'the binding already points at {new_name} ({new_id})')

    note = (
        f'{indent}// Moved to the EU-jurisdiction database on {today}.\n'
        f'{indent}// Rollback: put these two values back and redeploy.\n'
        f'{indent}//   "database_name": "{old_name}",\n'
        f'{indent}//   "database_id": "{old_id}",\n'
    )

    text = name_re.sub(
        lambda m: f'{note}{m.group(1)}"database_name": "{new_name}",', text,
        count=1)
    # The id line may or may not carry a trailing comma; keep whichever it had
    # so the file stays valid either way.
    text = id_re.sub(
        lambda m: f'{m.group(1)}"database_id": "{new_id}"'
        + (',' if m.group(0).rstrip().endswith(',') else ''),
        text, count=1)
    return text


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    path, name, uuid = sys.argv[1:4]
    with open(path) as fh:
        sys.stdout.write(swap(fh.read(), name, uuid))
