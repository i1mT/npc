import { resetSimDb } from "../src/db/connection";
import { setStatus } from "../src/db/sim";

resetSimDb();
setStatus("idle");
console.log("sim.db reset complete");
