#!/usr/bin/env python3
"""Restore ConTrack V9.15.18 source from upload parts (25 text chunks)."""
import os, re, json, sys

ROOT = "/home/z/my-project"
UPLOAD = os.path.join(ROOT, "upload")
OUT = os.path.join(ROOT, "contrack_v9.15.18")

part_files = sorted(
    [f for f in os.listdir(UPLOAD) if re.fullmatch(r"part_\d+\.txt", f)]
)

# Collect pieces: {path: {piece_no: content}}
files = {}
begin_re = re.compile(r"^===== BEGIN file: (.+?)(?: \(قطعة (\d+) من (\d+)\))? =====\s*$", re.M)
end_for = lambda path: re.compile(
    r"^===== END " + re.escape(path) + r"(?: \(قطعة (\d+) من (\d+)\))? =====\s*$", re.M
)

stats = {"parts": 0, "files": 0, "chars": 0}
for pf in part_files:
    with open(os.path.join(UPLOAD, pf), encoding="utf-8") as fh:
        text = fh.read()
    stats["parts"] += 1
    pos = 0
    while True:
        m = begin_re.search(text, pos)
        if not m:
            break
        path, pi, pn = m.group(1), int(m.group(2) or 1), int(m.group(3) or 1)
        em = end_for(path).search(text, m.end())
        if not em:
            print(f"!! missing END for {path} in {pf}", file=sys.stderr)
            break
        content = text[m.end():em.start()]
        # strip a single leading newline artifact
        if content.startswith("\n"):
            content = content[1:]
        files.setdefault(path, {})[pi] = content
        pos = em.end()

# Write output
for path, pieces in files.items():
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    joined = "".join(pieces[k] for k in sorted(pieces))
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(joined)
    stats["files"] += 1
    stats["chars"] += len(joined)

with open(os.path.join(ROOT, "restore_report.json"), "w", encoding="utf-8") as fh:
    json.dump(
        {
            **stats,
            "file_list": sorted(files.keys()),
            "multi_piece": {p: sorted(v) for p, v in files.items() if len(v) > 1},
        },
        fh, ensure_ascii=False, indent=1,
    )
print(f"restored {stats['files']} files, {stats['chars']} chars from {stats['parts']} parts")
