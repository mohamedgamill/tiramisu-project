#!/usr/bin/env python3
"""Read/write the live inventory data on the site (used by Claude).

Usage:
  python3 -I tools/site_data.py pull data.json   # save {"version", "state"} to a file
  python3 -I tools/site_data.py push data.json   # upload the edited file (version-checked)

The API token is read from ~/.config/tiramisu/api_token (never commit it).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE_URL = "https://tiramisu-project.pages.dev/api/state"
TOKEN_FILE = os.path.expanduser("~/.config/tiramisu/api_token")


def request(method, body=None):
    with open(TOKEN_FILE) as f:
        token = f.read().strip()
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE_URL, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("User-Agent", "tiramisu-site-data/1.0")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read() or b"{}")
        except ValueError:
            payload = {}
        return e.code, payload


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("pull", "push"):
        print(__doc__)
        sys.exit(2)
    cmd, path = sys.argv[1], sys.argv[2]

    if cmd == "pull":
        status, payload = request("GET")
        if status != 200:
            print(f"ERROR {status}: {payload}")
            sys.exit(1)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"OK pulled version {payload.get('version')} -> {path}")
        return

    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    status, result = request("PUT", {"state": payload["state"], "version": payload["version"]})
    if status == 200:
        print(f"OK saved, new version {result.get('version')}")
    elif status == 409:
        print("CONFLICT: data changed on the site since pull. Pull again and redo the edit.")
        sys.exit(1)
    else:
        print(f"ERROR {status}: {result}")
        sys.exit(1)


if __name__ == "__main__":
    main()
