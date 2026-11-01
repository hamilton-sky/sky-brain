# Backend builder notes

This ticket is server, library or command line code. These notes add to the build guide; they never override it.

- Check every input that comes from outside the process (a request, a file, an argument, an environment variable) where it enters, and fail with a message that says what was wrong.
- Keep the public shape (a route, a function signature, a file format, an exit code) as the ticket says. A change the ticket does not ask for is out of scope.
- Errors: never swallow one. Return or raise it with enough context to find the cause.
- Data that can be lost (a write, a delete, a migration) needs a test that proves the old data survives or the change can be undone.
- Test the edges: empty input, the largest allowed input, a missing file, a second run of the same command.
