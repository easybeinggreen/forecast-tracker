"""Download Victorian 2026 poll data: Election Tracker files + the Wikipedia polling page (raw)."""
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests

OUT = Path("data/raw/polls")
UA = {"User-Agent": "vic2026-forecast (personal research; Paul Green green.paul.p@gmail.com)"}
PAGES = {
    "electiontracker.html": "https://electiontracker.au/elections/vic/2026/polls",
    "wikipedia_polls.html": "https://en.wikipedia.org/wiki/Opinion_polling_for_the_2026_Victorian_state_election",
    "wikipedia_election.html": "https://en.wikipedia.org/wiki/2026_Victorian_state_election",
    "tallyroom_pendulum.html": "https://www.tallyroom.com.au/vic2026/pendulumvic2026",
    "wikipedia_candidates.html": "https://en.wikipedia.org/wiki/Candidates_of_the_2026_Victorian_state_election",
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    for name, url in PAGES.items():
        r = s.get(url, headers=UA, timeout=60)
        print(name, r.status_code)
        if r.ok:
            (OUT / name).write_text(r.text, encoding="utf-8")
            if name == "electiontracker.html":
                for href in set(re.findall(r'href="([^"]+\.(?:csv|json))"', r.text)):
                    u = urljoin(url, href)
                    f = s.get(u, headers=UA, timeout=60)
                    print("  ", u, f.status_code)
                    if f.ok:
                        (OUT / ("et_" + u.rstrip("/").split("/")[-1])).write_bytes(f.content)
        time.sleep(1)


if __name__ == "__main__":
    main()
