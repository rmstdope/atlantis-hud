# `config/public/badges/`

The icon files for the **Field Marks (image icons)** map theme go here, served at `/badges/<file>`.

This directory ships empty. A badge whose file is missing simply draws nothing on the map - no
broken-image glyph, no crash - so the theme is safe to select before every file has arrived.

The full brief (exactly which 11 files, their format, size and colour) is in
`docs/ui/field-marks-icons.md`. The manifest itself - the single source of truth for filenames and
sizes - is `packages/shared/src/workspace/mapThemes/fieldMarks/badges.ts`.
