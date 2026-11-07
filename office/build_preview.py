"""Bundle office/ into one self-contained preview page (nothing saved; any name and PIN).

    python3 office/build_preview.py OUT.html
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "preview.html")


def module(name):
    """Wrap an ES module as an IIFE that returns its exports, so names don't clash."""
    src = (ROOT / "js" / name).read_text()
    src = re.sub(r"^import .*?;\n", "", src, flags=re.M)
    names = re.findall(r"^export (?:async )?(?:function|const|let) (\w+)", src, flags=re.M)
    src = re.sub(r"^export ", "", src, flags=re.M)
    return src, names


html = (ROOT / "index.html").read_text()
css = (ROOT / "css" / "app.css").read_text() + "\n" + (ROOT / "css" / "office.css").read_text()
html = re.sub(r'\s*<link rel="stylesheet" href="css/app.css">\s*<link rel="stylesheet" href="css/office.css">', f"\n  <style>{css}</style>", html)

data = (ROOT / "data" / "office.json").read_text()
topo = (ROOT / "data" / "vic_districts.topojson").read_text()
booths = {p.stem: json.loads(p.read_text()) for p in sorted((ROOT / "data" / "booths").glob("*.json"))}
inline = f"<script>window.OFFICE_DEMO=true;window.OFFICE_DATA={data};window.OFFICE_TOPO={topo};window.OFFICE_BOOTHS={json.dumps(booths, separators=(',', ':'))};</script>"

parts = []
for name in ("map.js", "seatx.js"):
    src, names = module(name)
    var = name.replace(".js", "")
    parts.append(f"const __{var} = (() => {{\n{src}\nreturn {{ {', '.join(names)} }}; }})();")
main = (ROOT / "js" / "office.js").read_text()
for line in re.findall(r"^import \{(.*?)\} from \"\./(\w+)\.js\";\n", main, flags=re.M):
    pass
imports = re.findall(r"^import \{(.*?)\} from \"\./(\w+)\.js\";$", main, flags=re.M)
main = re.sub(r"^import .*?;\n", "", main, flags=re.M)
heads = [f"const {{ {names.strip()} }} = __{mod};" for names, mod in imports]
script = "\n".join(parts + heads + [main])
html = html.replace('<script type="module" src="js/office.js"></script>', f"{inline}<script type=\"module\">{script}</script>")
out.write_text(html)
print(f"{out}: {out.stat().st_size // 1024} KB")
