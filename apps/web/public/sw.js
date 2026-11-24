// sky-brain's service worker (D33): shows approval alerts and handles their buttons. A push holds
// no item text, only where to go. "Approve" posts with the person's own session cookie, exactly
// like the button on the page; if that fails (signed out, expired, changed) the page opens instead.
const APPROVAL_PATH = /^\/a\/([0-9a-f-]{36})$/i;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const match =
    typeof data.path === "string" ? APPROVAL_PATH.exec(data.path) : null;
  const items = Number.isInteger(data.items) ? data.items : 1;
  event.waitUntil(
    self.registration.showNotification("sky-brain", {
      body: "An agent is waiting for your approval.",
      tag: match ? match[1] : "sky-brain",
      icon: "/icon.svg",
      requireInteraction: true,
      data: { path: match ? match[0] : "/", id: match ? match[1] : null },
      actions: match
        ? [
            {
              action: "approve",
              title: items > 1 ? `Approve all ${items}` : "Approve",
            },
            { action: "open", title: "Review" },
          ]
        : [],
    }),
  );
});

async function openPage(path) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of windows) {
    if (
      new URL(client.url).origin === self.location.origin &&
      "focus" in client
    ) {
      await client.navigate(path);
      return client.focus();
    }
  }
  return self.clients.openWindow(path);
}

async function approve(id, path) {
  try {
    const res = await fetch(`/api/v1/approvals/${id}/approve`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (res.ok) {
      return self.registration.showNotification("sky-brain", {
        body: "Approved. The agent will see it.",
        tag: id,
        icon: "/icon.svg",
      });
    }
  } catch {
    // Offline or blocked: fall through to the page.
  }
  return openPage(path);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { path, id } = event.notification.data || {};
  const safePath =
    typeof path === "string" && (path === "/" || APPROVAL_PATH.test(path))
      ? path
      : "/";
  if (event.action === "approve" && id) {
    event.waitUntil(approve(id, safePath));
  } else {
    event.waitUntil(openPage(safePath));
  }
});
