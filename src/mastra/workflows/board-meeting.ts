import { addBoardDirective, getBoardMeeting, getDay, resumeBoardMeeting } from "@/db/sim";
import type { WorkflowDefinition } from "@/lib/types";
import { agentMeta, logEvent } from "@/simulation/mock-apis";

export class BoardDecisionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export const boardWorkflow: WorkflowDefinition = {
  name: "board-meeting",
  steps: [
    { name: "weekly-report", agent: "editor-in-chief" },
    { name: "await-board-input", executor: "workflow.suspend", suspend: true },
    { name: "execute-board-directive", executor: "applyBoardDirective" },
  ],
};

export function weeklyReportForBoard(day: number) {
  const metrics = getDay(day);
  if (!metrics) throw new BoardDecisionError(`Day ${day} does not exist.`, 404, "day_not_found");
  return {
    day,
    dau: metrics.dau,
    capital: metrics.capital,
    reputation: metrics.reputation,
    subscribers: metrics.subscribers,
    adRevenue: metrics.adRevenue,
    articleCount: metrics.articleCount,
    summary: `Day ${day} 周报：DAU ${metrics.dau}，Reputation ${metrics.reputation}，Capital ¥${metrics.capital}。`,
  };
}

export function applyBoardDirective(day: number, directive: string) {
  const clean = directive.trim();
  if (!clean) throw new Error("Board directive cannot be empty.");
  const dayState = getDay(day);
  if (!dayState) {
    throw new BoardDecisionError(`Day ${day} does not exist.`, 404, "day_not_found");
  }
  if (!dayState.isBoardDay) {
    throw new BoardDecisionError(`Day ${day} is not a board day.`, 409, "not_board_day");
  }
  const meeting = getBoardMeeting(day);
  if (!meeting) {
    throw new BoardDecisionError(`Day ${day} has no suspended board workflow.`, 409, "board_workflow_not_suspended");
  }
  if (meeting.status !== "pending") {
    throw new BoardDecisionError(`Day ${day} board workflow has already resumed.`, 409, "board_workflow_already_resumed");
  }
  addBoardDirective(day, clean);
  resumeBoardMeeting(day, clean);
  logEvent({
    day,
    ...agentMeta("董事会"),
    eventType: "board",
    content: `workflow.resume：董事会指令已进入执行阶段：${clean}`,
    metadata: { directive: clean, workflow: boardWorkflow.name, resumedStep: "execute-board-directive" },
  });
}
