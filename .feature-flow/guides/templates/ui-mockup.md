# UI mockups

Use only when the feature creates or changes visible screens or components. Paste the result
into the `## UI` section of spec.md.

Rules:

- ASCII box drawing only: `┌ ┐ └ ┘ │ ─ ├ ┤`. At most 50 columns wide.
- One mockup per distinct visual state: open, closed, empty, loaded, error. Label each with a heading.
- Realistic text, never lorem ipsum. Show buttons as `[ Button ]`, inputs as `[________]`,
  checked items as `✓`.
- Order components the way the user meets them. Show shared screen space when components share it.
- This is a reference for the person building it. Accuracy matters more than looks.

Example:

### ExportMenu — open, CSV selected

```
┌─────────────────────────────────┐
│  Export                       ▼ │
├─────────────────────────────────┤
│  Format                         │
│  ┌─────────────────────────┐    │
│  │ ✓ CSV (default)         │    │
│  │   JSON                  │    │
│  │   Excel                 │    │
│  └─────────────────────────┘    │
│─────────────────────────────────│
│  Recent exports                 │
│  · orders-2025-01.csv           │
│  · customers-2025-01.csv        │
│  [ Export ]                     │
└─────────────────────────────────┘
```

### ExportMenu — closed

```
┌─────────────────────────────────┐
│  Export  [CSV]                  │
└─────────────────────────────────┘
```
