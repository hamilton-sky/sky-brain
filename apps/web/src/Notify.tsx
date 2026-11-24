// "Tell me when an agent asks" (D36): turns web push on for this browser. The browser asks for
// permission only after the person clicks. On an iPhone, push works only once sky-brain is added
// to the Home Screen, so the card says how.
import { Alert, Button, Card } from "panel-frame-ui";
import { useEffect, useState } from "react";
import { pushApi } from "./api.ts";

type State =
  | "loading"
  | "off-server"
  | "unsupported"
  | "ios-install"
  | "denied"
  | "ready"
  | "on";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ?? false;

/** The VAPID key as the bytes `pushManager.subscribe` wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function Notify() {
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported) {
        setState(isIos() && !isInstalled() ? "ios-install" : "unsupported");
        return;
      }
      const k = await pushApi.key().catch(() => null);
      if (!k) return setState("off-server");
      setKey(k);
      if (Notification.permission === "denied") return setState("denied");
      const reg = await registration();
      setState((await reg.pushManager.getSubscription()) ? "on" : "ready");
    })().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setState("unsupported");
    });
  }, []);

  const turnOn = async () => {
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "ready");
        return;
      }
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(key),
        }));
      await pushApi.subscribe(sub.toJSON());
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) {
        await pushApi.unsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading" || state === "off-server") return null;
  return (
    <Card className="notify">
      <div className="section-head">
        <h2>Tell me when an agent asks</h2>
        {state === "ready" && (
          <Button disabled={busy} onClick={() => void turnOn()}>
            Turn on
          </Button>
        )}
        {state === "on" && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void turnOff()}
          >
            Turn off
          </Button>
        )}
      </div>
      <p className="muted">
        {state === "on"
          ? "On for this browser. Alerts say only that something is waiting; on a computer you can approve from the alert."
          : state === "ready"
            ? "Get an alert on this device when an agent asks for your approval. It never shows what the item says."
            : state === "denied"
              ? "This browser blocks notifications from sky-brain. Allow them in the site settings, then reload."
              : state === "ios-install"
                ? "On iPhone and iPad: tap Share, then Add to Home Screen, and open sky-brain from there to turn alerts on."
                : "This browser cannot get alerts. Try Chrome, Edge, Firefox or Safari."}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
    </Card>
  );
}
