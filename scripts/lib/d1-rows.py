"""Read `wrangler d1 ... --json` output on stdin and print it in a shape shell
can use.

Written because the alternative — parsing wrangler's pretty tables with sed, or
piping through jq — is either fragile or an extra dependency (jq is not on a
stock macOS). python3 is already required by the deletion and policy harnesses,
so it costs nothing here.

Two shapes come out of wrangler and both are handled:

    d1 info --json      → one object of facts about the database
    d1 execute --json   → [ { "results": [ {...}, ... ], "success": true } ]

Wrangler also prints a banner and warnings around the JSON depending on
version and terminal, so this scans for the first position where a JSON value
starts and parses successfully, rather than assuming stdin is pure JSON.

    --field KEY    print one value; exit 3 if the key is absent anywhere
    --column NAME  print one column of the result rows, one per line
    --tsv          print the result rows as TSV with a header

Exit 3 (absent) is deliberately distinct from exit 1 (unparseable): the caller
must be able to tell "wrangler does not report this" from "wrangler said
something I could not read", because for the jurisdiction check those two need
different handling and neither may be treated as success.
"""

import json
import sys


def parse(text):
    """The first JSON value in `text`, ignoring any banner around it."""
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch not in "[{":
            continue
        try:
            value, _ = decoder.raw_decode(text[i:])
        except ValueError:
            continue
        return value
    sys.exit("d1-rows.py: no JSON found in input")


def rows_of(value):
    """The result rows, whichever wrapper wrangler used."""
    if isinstance(value, list):
        # Either the [{results: [...]}] envelope or bare rows.
        out = []
        for item in value:
            if isinstance(item, dict) and "results" in item:
                out.extend(item["results"] or [])
            else:
                out.append(item)
        return out
    if isinstance(value, dict) and "results" in value:
        return value["results"] or []
    return [value] if isinstance(value, dict) else []


def find_field(value, key):
    """`key` from the top-level object, else from the first result row.

    Case-insensitive, because wrangler has shipped both `running_in_region`
    and `runningInRegion` over the years and a jurisdiction check that silently
    matched nothing would defeat the point of checking.
    """
    wanted = key.lower()
    candidates = []
    if isinstance(value, dict):
        candidates.append(value)
    candidates.extend(r for r in rows_of(value) if isinstance(r, dict))
    for obj in candidates:
        for k, v in obj.items():
            if k.lower().replace("_", "") == wanted.replace("_", ""):
                return v
    return KeyError


def main(argv):
    text = sys.stdin.read()
    value = parse(text)

    if len(argv) >= 2 and argv[0] == "--field":
        found = find_field(value, argv[1])
        if found is KeyError:
            sys.exit(3)
        print("" if found is None else found)
        return

    if len(argv) >= 2 and argv[0] == "--column":
        for row in rows_of(value):
            if isinstance(row, dict) and argv[1] in row:
                print("" if row[argv[1]] is None else row[argv[1]])
        return

    if argv and argv[0] == "--tsv":
        rows = [r for r in rows_of(value) if isinstance(r, dict)]
        if not rows:
            return
        keys = list(rows[0])
        print("\t".join(keys))
        for row in rows:
            print("\t".join("" if row.get(k) is None else str(row.get(k))
                            for k in keys))
        return

    sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
