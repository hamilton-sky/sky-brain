# <Feature> — Spec

Delete any section that does not apply. Do not write "N/A".

## Problem

<1-2 paragraphs: who is affected and what hurts today.>

## Goal and the bar

<What done looks like, and the one measurable check for the whole feature.>

## Stories

### <Story title>

**As a** <user>, **I want** <goal>, **so that** <benefit>.

- [ ] <acceptance criterion>
- [ ] <acceptance criterion>

## Scope

In: <list>
Not in scope: <list, with where each one lives instead>

## Happy path

1. <user action> → <system response> → <what the user sees>
2. ...

## Edge cases

| Trigger | Expected behaviour | Handled in ticket |
|---|---|---|
| <what causes it> | <what should happen> | NN |

## Design

<How it fits into the existing system: components, data flow. A diagram is welcome: a ```mermaid
block (the chosen diagram from brainstorm.md when there is one), or ASCII with boxes `[ ]`, arrows `──►`,
at most 70 columns. One arrow label per data or event passed. Show the happy path and the main failure
path. Show only parts this feature adds or changes.>

### Decisions

- **<Decision>** — options: A, B, C. Chosen: A. Why: <reason>.

## Interfaces

<New or changed types, endpoints, events or messages.>

## Migration and compatibility

<Breaking changes and how existing data or callers are handled.>

## Risks

- <risk> — <mitigation>

## UI

<Only for features with screens. Use ui-mockup.md.>
