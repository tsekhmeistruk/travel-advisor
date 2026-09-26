---
name: verify-site
description: Run headless-browser checks on the Travel Risk Map (both sources, fixed-size details card, click/drag behaviour, source switch, search, mobile layout, console errors). Use after any change to index.html, css/styles.css, js/app.js or the generated data, and before pushing.
---

# Verify the site

`check.mjs` opens `index.html` in headless Chrome or Edge and runs the checks that caught real bugs in this project:

- **Both sources** (U.S. and Canada) render at desktop and phone widths, with no console errors and no horizontal scroll.
- **Details card:** it stays **one fixed height** for every country and dot, and its content never overflows. The panel below it must not jump as the pointer moves between countries.
- **Clicks:** a click with a few pixels of hand movement still selects a country, and a real drag pans the map without selecting. d3-zoom's default click distance is 0, which silently swallowed clicks.
- **Selection outline:** it's drawn above the hover outline.
- **Source switch:** it updates the header and level names, and the choice persists after a reload.
- **Search:** it selects and zooms to the country.

## Run

puppeteer-core is kept **out of the repo**. Install it in the session scratchpad, not in the project, and run from there:

```sh
cd <scratchpad dir>
npm init -y >/dev/null && npm i puppeteer-core --silent   # once per scratch folder
node <repo>/.claude/skills/verify-site/check.mjs --out shots
```

- **Exit code:** 0 if all checks pass, 1 if any fail, 2 if puppeteer-core or the browser is missing.
- **Browser:** Chrome is found at the default Windows path, with Edge as the fallback. Set `CHROME_PATH` to use a different browser.
- **Screenshots:** saved to `--out`. Look at them: layout problems don't always fail a check.

## After a failure

- Read the detail in brackets on the FAIL line. It names the offending countries or values.
- For card-size failures, look at `.details` and its children in `css/styles.css`. Every card uses fixed-height slots: the title is one line, the description is three lines, the "What changed" block is four lines, and the status line is one line.
- For a new behaviour, add a check here rather than a one-off script, so it keeps being tested.
