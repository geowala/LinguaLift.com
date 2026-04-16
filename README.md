# LinguaLift

LinguaLift is a static web app for linguistics problem practice with an olympiad feel, especially suited to OzCLO-style training.

## What it includes

- A curated bank of original drills plus adapted past-paper-style questions from OzCLO, NACLO, and IOL archives
- A cleaner two-column workspace with an in-app solver instead of archive-only cards
- `Practice` mode with filtering, hints, solution reveals, answer checking, bookmarks, and source attribution
- `Review` mode that automatically collects missed or bookmarked problems
- `Sprint` mode with a timed five-problem run
- Built-in `Overall` and `Sprint` leaderboards with seeded competition standings plus the local user
- Local progress persistence through `localStorage`
- A darker dashboard UI inspired by the structure of leibniz.com.au, without the crammed multi-panel layout

## Run it

Open [index.html](/Users/geowala/Documents/New%20project/index.html) in a browser.

If you want a local server instead of opening the file directly, from this folder you can run:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Next good upgrades

- Add user-authenticated accounts and shared leaderboards
- Expand the problem schema to support multi-part answers and rubric scoring
- Deepen the adapted past-paper bank with more years, tags, and multi-part question flows
- Add spaced repetition scheduling for the review queue
