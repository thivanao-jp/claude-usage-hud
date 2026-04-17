"""
Claude Usage HUD - rate limit checker for Claude Code skills.

Reads live usage data from the Claude Usage HUD local API server
(http://127.0.0.1:49485/usage) and prints JSON to stdout.

Usage:
  python check_usage.py [threshold]

  threshold: utilization % at which to set over_threshold=true (default: 90)

Output:
  {"utilization": 43.0, "resets_at": "2026-04-17T08:00:00Z",
   "threshold": 90.0, "over_threshold": false, "last_updated": "..."}

  On error (HUD not running etc.):
  {"error": "Cannot reach claude-usage-hud: ..."}  (exit code 1)

Install:
  Copy to ~/.claude/scripts/check_usage.py
  Requires Claude Usage HUD to be running.
"""
import json
import sys
import urllib.request
import urllib.error

LOCAL_API_URL = 'http://127.0.0.1:49485/usage'


def fetch_usage() -> dict:
    req = urllib.request.Request(LOCAL_API_URL)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def main():
    threshold = float(sys.argv[1]) if len(sys.argv) > 1 else 90.0

    try:
        data = fetch_usage()
    except Exception as e:
        print(json.dumps({'error': f'Cannot reach claude-usage-hud: {e}'}))
        sys.exit(1)

    five_hour = data.get('five_hour') or {}
    utilization = five_hour.get('utilization', 0.0)
    resets_at = five_hour.get('resets_at')

    print(json.dumps({
        'utilization': utilization,
        'resets_at': resets_at,
        'threshold': threshold,
        'over_threshold': utilization >= threshold,
        'last_updated': data.get('last_updated'),
    }))


if __name__ == '__main__':
    main()
