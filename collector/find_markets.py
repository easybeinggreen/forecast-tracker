"""List candidate markets for a topic: python -m collector.find_markets "anthropic ipo" """
import sys

from . import sources as src
from .http import get_json, session


def main():
    q = " ".join(sys.argv[1:]) or "anthropic ipo"
    s = session()
    print(f"# Polymarket events for '{q}'")
    try:
        for e in src.polymarket_search(s, q):
            print(f"  {'(closed) ' if e['closed'] else ''}{e['slug']}  |  {e['title']}")
    except Exception as e:  # noqa: BLE001
        print(f"  error: {e}")
    print(f"\n# Manifold markets for '{q}'")
    try:
        for m in get_json(s, f"{src.MANIFOLD}/search-markets", params={"term": q, "limit": 20, "filter": "open"}):
            print(f"  {m.get('slug')}  |  {m.get('outcomeType')}  |  {m.get('question')}")
    except Exception as e:  # noqa: BLE001
        print(f"  error: {e}")


if __name__ == "__main__":
    main()
