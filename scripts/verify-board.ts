import { resetSimDb } from "../src/db/connection";
import { getBoardMeeting, listEvents, setStatus } from "../src/db/sim";
import { applyBoardDirective, BoardDecisionError, runDailyWorkflow } from "../src/mastra";

async function expectBoardError(label: string, fn: () => void, code: string, status: number) {
  try {
    fn();
  } catch (error) {
    if (error instanceof BoardDecisionError && error.code === code && error.status === status) {
      return { label, ok: true, code, status };
    }
    throw error;
  }
  throw new Error(`${label} should have failed with ${code}`);
}

async function main() {
  resetSimDb();
  setStatus("idle");

  await runDailyWorkflow(1);
  const missing = await expectBoardError("missing day rejected", () => applyBoardDirective(999, "不存在的天"), "day_not_found", 404);
  const nonBoard = await expectBoardError("non-board day rejected", () => applyBoardDirective(1, "非董事会日"), "not_board_day", 409);

  for (let day = 2; day <= 7; day += 1) {
    await runDailyWorkflow(day);
  }

  const pending = getBoardMeeting(7);
  if (!pending || pending.status !== "pending") {
    throw new Error("Day 7 board workflow should be pending after suspend.");
  }

  applyBoardDirective(7, "下周增加企业落地专题，降低低来源可信度内容。");
  const resumed = getBoardMeeting(7);
  if (!resumed || resumed.status !== "resumed" || !resumed.directive) {
    throw new Error("Day 7 board workflow should resume after directive.");
  }

  const duplicate = await expectBoardError("duplicate directive rejected", () => applyBoardDirective(7, "重复提交"), "board_workflow_already_resumed", 409);
  const boardEvents = listEvents(7).filter((event) => event.eventType === "board");
  if (!boardEvents.some((event) => event.content.includes("workflow.suspend"))) throw new Error("Missing workflow.suspend board event.");
  if (!boardEvents.some((event) => event.content.includes("workflow.resume"))) throw new Error("Missing workflow.resume board event.");

  console.log(JSON.stringify({ ok: true, checks: [missing, nonBoard, duplicate], boardMeeting: resumed, boardEventCount: boardEvents.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
