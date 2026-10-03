import { verifySpringbootRuntime } from "./verify-springboot-runtime.mjs";
await verifySpringbootRuntime(process.argv[2]??"postgresql","compose");
