# Task Engine Dashboard

The web dashboard for Task Engine, a runtime for artifact-based work graphs. Built on Nuxt 4 with Nuxt UI.

## Entity descriptions

Runs, node executions, and artifacts carry short natural-language descriptions generated during execution. These are produced by piggybacking on existing LLM calls (zero-cost for node-level descriptions) or by a single cheap post-run summarization call. They show up throughout the dashboard so you can tell what something *is* without drilling into raw data.

See `internal_docs/20260315_entity_descriptions.md` for the full design doc.

## Setup

Make sure to install the dependencies:

```bash
npm install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
npm run dev
```

## Production

Build the application for production:

```bash
npm run build
```

Locally preview production build:

```bash
npm run preview
```
