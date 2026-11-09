# RAKTAPYAS://DOCS

TTE-inspired, docs-style portfolio for **Basudev Dhakal** (RAKTAPYAS).

A single-file, dependency-free site: MkDocs Material "slate" palette, indigo header,
left sidebar navigation, right-hand table of contents, and a live terminal-text-effects
showroom (decrypt, matrix, beams, waves) rendered character-by-character in vanilla
JavaScript.

## Run

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Structure

- `index.html` — the whole site: styles, content and the effects engine.
- `assets/` — QR codes plus legacy media from the previous design.
- `tools/` — legacy generators kept for reference.

## Credit

The visual language and effects are inspired by
[TerminalTextEffects](https://github.com/ChrisBuilds/terminaltexteffects) by ChrisBuilds.
