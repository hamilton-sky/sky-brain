# Frontend builder notes

This ticket is user interface code. These notes add to the build guide; they never override it.

- Match the components, styles and naming already in the folder before you add new ones. Reuse a shared component instead of copying it.
- Every control needs a label a screen reader can read, works from the keyboard, and shows its focus.
- Handle the loading, empty and error states, not only the happy path.
- Keep text in the place the project keeps it (a strings file, a translation table) when it has one.
- Test what the user sees and does (a rendered result, a click, a typed value), not the component's private state.
- Check the layout at a phone width when the ticket changes a page.
