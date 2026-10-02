import { AsyncLocalStorage } from "node:async_hooks";
import type { EndpointId } from "./endpoint-registry.js";

export interface EndpointContext {
  endpointId: EndpointId;
  auditWritten: boolean;
  auditNoMutation: boolean;
  pendingAudits: Array<() => Promise<void>>;
}
const storage = new AsyncLocalStorage<EndpointContext>();
export function currentEndpoint(): EndpointContext | undefined {
  return storage.getStore();
}
export function runWithEndpoint<T>(id: EndpointId, fn: () => T): T {
  return storage.run(
    { endpointId: id, auditWritten: false, auditNoMutation: false, pendingAudits: [] },
    fn,
  );
}
