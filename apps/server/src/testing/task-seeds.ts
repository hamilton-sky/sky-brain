// Seeds and helpers for cloud-task-board tests (spec.md Interfaces -> How a test reaches the
// server). Tests only.
import { DEVICE_CODE_GRANT_TYPE } from "@sky-brain/shared/devices";
import { testClient, type TestClient, type TestServer } from "./harness.ts";

/** A client that sends `Authorization: Bearer <token>`. */
export function withToken(server: TestServer, token: string): TestClient {
  return testClient(server.url, token);
}

/** Code, approve, token: the device flow through its routes, as a client would. */
export async function loginDevice(
  server: TestServer,
  person: { kind: "human"; user_id: string },
  name: string,
): Promise<{ deviceId: string; deviceToken: string }> {
  const code = await server.anonymous.post("/api/device/code", {
    client_name: "test",
  });
  if (code.status !== 200) {
    throw new Error(`loginDevice: device code got ${code.status} ${code.text}`);
  }
  const approved = await server
    .as(person)
    .post("/api/v1/devices/approve", { user_code: code.body.user_code, name });
  if (approved.status !== 200) {
    throw new Error(
      `loginDevice: approve got ${approved.status} ${approved.text}`,
    );
  }
  const token = await server.anonymous.post("/api/device/token", {
    grant_type: DEVICE_CODE_GRANT_TYPE,
    device_code: code.body.device_code,
  });
  if (token.status !== 200) {
    throw new Error(`loginDevice: token got ${token.status} ${token.text}`);
  }
  return {
    deviceId: token.body.device_id,
    deviceToken: token.body.device_token,
  };
}
