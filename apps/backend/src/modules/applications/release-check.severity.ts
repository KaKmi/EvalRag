import type { ReleaseCheckIssue } from "@codecrush/contracts";

/**
 * 「阻断」的唯一判据。B1/F5 之前是「issues 非空即 failed」，
 * 现在改为「存在非 warning 级才 failed」——评测门禁的 warning 不得阻断发布（软提示）。
 *
 * **必须是排除法（!== "warning"），不能是白名单（=== "error"）**：
 * toReleaseCheck 是逐字段手写映射（applications.service.ts:518-533），
 * 第 525 行 `issues: row.issues` 原样透出，**响应与库中历史行都不过 Zod**
 * ⇒ 它们的 severity 是 undefined。用白名单会把历史的静态门禁失败判成非阻断，
 * 一条真实的阻断 issue 静默失去阻断力——安全方向的回归。
 * undefined 必须落在「阻断」一侧。
 */
export function hasBlockingIssue(issues: readonly ReleaseCheckIssue[]): boolean {
  return issues.some((issue) => issue.severity !== "warning");
}
