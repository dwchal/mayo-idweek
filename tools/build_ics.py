"""Generate calendar files from sessions.json.

  ics/all.ics          every Mayo session + the daily poster sessions (subscribe or import)
  ics/<item id>.ics    one event per session / poster

Mayo talks that sit inside a larger session are folded into that session, matching the app.
Run from the repo root:  python3 tools/build_ics.py
"""
import json, os, re
from datetime import datetime, timezone

ALARM_MINUTES = 10
SITE = "https://dwchal.github.io/mayo-idweek/"

data = json.load(open("sessions.json", encoding="utf-8"))
items = data["items"]
by_id = {i["id"]: i for i in items}

def parent_of(child):
    for p in items:
        if (p.get("parentTitle") is None and p["kind"] == "talk" and p["day"] == child["day"]
                and p["room"] == child["room"] and p["title"] == child.get("parentTitle")):
            return p
    return None

children = {}
for it in items:
    if it.get("parentTitle"):
        p = parent_of(it)
        if p: children.setdefault(p["id"], []).append(it)
nested = {c["id"] for cs in children.values() for c in cs}
top = [i for i in items if i["id"] not in nested]

def utc(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

def esc(s):
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

def fold(line):
    # RFC 5545: lines longer than 75 octets are folded with CRLF + space
    out, b = [], line.encode("utf-8")
    while len(b) > 75:
        cut = 75
        while (b[cut] & 0xC0) == 0x80: cut -= 1
        out.append(b[:cut].decode("utf-8")); b = b" " + b[cut:]
    out.append(b.decode("utf-8"))
    return "\r\n".join(out)

def mayo_names(it):
    seen, names = set(), []
    for r in sorted(it["roles"], key=lambda r: r["role"] == "Co-authors"):
        for p in r["people"]:
            if p.get("site") and p["name"] not in seen:
                seen.add(p["name"]); names.append(p["name"])
    return names

def fmt_time(s):
    d = datetime.fromisoformat(s)
    return d.strftime("%-I:%M %p")

def event(uid, summary, start, end, location, description, url=None):
    lines = ["BEGIN:VEVENT", f"UID:{uid}@mayo-idweek", f"DTSTAMP:{utc(data['generated'] + 'T12:00:00+00:00')}",
             f"DTSTART:{utc(start)}", f"DTEND:{utc(end)}", f"SUMMARY:{esc(summary)}",
             f"LOCATION:{esc(location)}", f"DESCRIPTION:{esc(description)}"]
    if url: lines.append(f"URL:{url}")
    lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{esc(summary)}",
              f"TRIGGER:-PT{ALARM_MINUTES}M", "END:VALARM", "END:VEVENT"]
    return lines

def talk_event(it):
    desc = ["Mayo: " + ", ".join(mayo_names(it))]
    for c in children.get(it["id"], []):
        desc.append(f"Mayo talk {fmt_time(c['start'])}–{fmt_time(c['end'])}: {c['title']} ({', '.join(mayo_names(c))})")
    if it.get("note"): desc.append(it["note"])
    desc.append(f"{SITE}#/item/{it['id']}")
    return event(it["id"], it["title"], it["start"], it["end"], f"{it['room']} · IDWeek 2026",
                 "\n".join(desc), it.get("url"))

def poster_event(it):
    where = it["room"] if it["kind"] == "virtualPoster" else f"{it['room']}, board {it['board']}"
    return event(it["id"], f"{it['board']}: {it['title']}", it["start"], it["end"], f"{where} · IDWeek 2026",
                 "Mayo: " + ", ".join(mayo_names(it)) + f"\n{SITE}#/item/{it['id']}", it.get("url"))

def calendar(name, events):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mayo IDWeek//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{esc(name)}", "X-WR-TIMEZONE:America/New_York",
             "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    for e in events: lines += e
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in lines) + "\r\n"

os.makedirs("ics", exist_ok=True)
for f in os.listdir("ics"):
    if f.endswith(".ics"): os.remove(os.path.join("ics", f))

all_events = []
for it in top:
    if it["kind"] == "talk":
        ev = talk_event(it); all_events.append(ev)
    else:
        ev = poster_event(it)
    open(f"ics/{it['id']}.ics", "w", encoding="utf-8", newline="").write(calendar(it["title"][:60], [ev]))

# One event per day's poster session in the subscribe-all calendar.
for day in sorted({i["day"] for i in top if i["kind"] == "poster"}):
    ps = sorted((i for i in top if i["day"] == day and i["kind"] == "poster"),
                key=lambda i: int(re.sub(r"\D", "", i["board"])))
    boards = ", ".join(p["board"] for p in ps)
    all_events.append(event(f"posters-{day}", f"Mayo posters ({len(ps)})", ps[0]["start"], ps[0]["end"],
                            f"{ps[0]['room']} · IDWeek 2026",
                            f"Boards: {boards}\n{SITE}#/posters/{day}"))

open("ics/all.ics", "w", encoding="utf-8", newline="").write(calendar("Mayo at IDWeek 2026", all_events))
print(f"{len(top)} item calendars, all.ics with {len(all_events)} events")
