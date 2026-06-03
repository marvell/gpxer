# GPXer

GPXer is a browser app for splitting GPX tracks into route segments.

Upload a GPX file, inspect the route on a map, review the elevation profile,
place split points along the track, and export individual GPX segment files.

## Features

- Upload and parse local GPX track files.
- View the route on an interactive MapLibre map.
- Inspect distance, ascent, descent, and slope-colored elevation details.
- Split routes by clicking the track or elevation profile.
- Export one segment or all segments as GPX files.
- Restore the last opened route from local browser storage.

## Requirements

- [Bun](https://bun.sh/)

## Development

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Run tests:

```bash
bun test
```

Build for production:

```bash
bun run build
```

Run the production server:

```bash
bun start
```

## Local Data

GPXer stores the last opened route in the browser's local IndexedDB so the route
can be restored on reload. GPX files are processed locally in the browser.

Generated builds and local working data are intentionally ignored by git,
including `dist/`, `node_modules/`, `data/`, and `.DS_Store`.

## License

MIT
