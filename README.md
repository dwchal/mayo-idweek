# Mayo @ IDWeek 2026 (web)

Every Mayo Clinic presentation at IDWeek 2026 (Washington, DC, October 20–24) in a phone-friendly web app:
day-by-day schedule with a live "now" line, posters in board order with check-off, a Mayo people index,
starred items, and calendar reminders.

**Live:** https://challener.net/mayo-idweek/ (on iPhone: Share → Add to Home Screen)

- Static site, no build step: `index.html`, `styles.css`, `app.js`, data in `sessions.json`.
- Stars and visited posters are saved in the browser (localStorage). Works offline after the first visit (`sw.js`).
- Reminders come from calendar files: `ics/all.ics` (subscribe: every Mayo session + daily poster sessions,
  10-minute alerts) and `ics/<id>.ics` per item.

## Updating the data

`sessions.json` is generated from the "Mayo at IDWeek 2026" PDF by the iPhone app's tools
(`~/Developer/MayoAtIDWeek/tools/parse.py`). After replacing `sessions.json`:

```sh
python3 tools/build_ics.py        # regenerate calendar files
# bump CACHE in sw.js so installed copies pick up the change
git commit -am "Update schedule" && git push
```

Test mid-conference behaviour locally with `?now=2026-10-22T10:20:00-04:00`.

Schedule data comes from the public IDWeek 2026 planner. Not an official Mayo Clinic or IDWeek product.
