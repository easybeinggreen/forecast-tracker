"""Shared HTTP session with retries and a polite User-Agent (SEC requires contact details)."""
import os
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

USER_AGENT = os.environ.get("TRACKER_USER_AGENT", "forecast-tracker (contact: set TRACKER_USER_AGENT)")


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(total=4, backoff_factor=2, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET", "POST"))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    return s


def get_json(s: requests.Session, url: str, params=None, timeout=30, pause=0.0):
    r = s.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    if pause:
        time.sleep(pause)
    return r.json()
