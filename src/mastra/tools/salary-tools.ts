import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { dbBatch, dbFirst, getDb } from "@/db/connection";
import { logEvent } from "@/simulation/mock-apis";
import type { AgentToolCtx } from "./npc-tools";

export function makeAdjustSalary(ctx: AgentToolCtx) {
  return createTool({
    id: "adjust_salary",
    description: "调整员工日薪（涨薪或降薪）。仅总编可用。执行后会在目标员工记忆中写入涨薪/降薪记录，触发其认知更新。",
    inputSchema: z.object({
      agent_handle: z.string().describe("目标员工的 agent_handle"),
      new_daily_salary: z.number().min(0).max(5000).describe("新的日薪（元/天）"),
      reason: z.string().max(200).describe("调薪原因"),
    }),
    execute: async (args: { agent_handle: string; new_daily_salary: number; reason: string }) => {
      if (ctx.roleTemplate !== "editor_in_chief" && ctx.roleTemplate !== "ceo") {
        return { ok: false, error: "仅总编或 CEO 可调薪" };
      }
      const emp = await dbFirst<{ id: string; display_name: string; daily_salary: number; memory: string | null }>(
        "SELECT id, display_name, daily_salary, memory FROM employees WHERE agent_handle = ? AND status = 'active'",
        args.agent_handle,
      );
      if (!emp) return { ok: false, error: "员工不存在或已离职" };

      const oldSalary = emp.daily_salary ?? 300;
      const direction = args.new_daily_salary > oldSalary ? "涨薪" : args.new_daily_salary < oldSalary ? "降薪" : "薪资调整";

      const memoryEntry = `\n\n[Day ${ctx.day} ${direction}] 总编将我的日薪从 ¥${oldSalary} 调整为 ¥${args.new_daily_salary}，原因：${args.reason}`;
      const newMemory = ((emp.memory ?? "") + memoryEntry).slice(-800);
      const db = await getDb();
      await dbBatch([
        db.prepare("UPDATE employees SET daily_salary = ? WHERE agent_handle = ?").bind(args.new_daily_salary, args.agent_handle),
        db.prepare("UPDATE employees SET memory = ? WHERE agent_handle = ?").bind(newMemory, args.agent_handle),
      ]);

      await logEvent({
        day: ctx.day,
        agentId: ctx.agentHandle,
        agentName: ctx.agentName,
        eventType: "org_change",
        content: `[${direction}] ${emp.display_name} ¥${oldSalary} → ¥${args.new_daily_salary}，原因：${args.reason}`,
        metadata: {
          toolSummary: { tool: "adjust_salary", input: args.agent_handle, result: `¥${oldSalary}→¥${args.new_daily_salary}` },
          salaryChange: { employeeId: emp.id, oldSalary, newSalary: args.new_daily_salary, direction, reason: args.reason },
        },
      });

      return { ok: true, direction, oldSalary, newSalary: args.new_daily_salary, employee: emp.display_name };
    },
  });
}
