import { resetSimDb } from "../src/db/connection";
import { setStatus } from "../src/db/sim";

await resetSimDb();
await setStatus("idle");
console.log("D1 simulation data reset complete");
