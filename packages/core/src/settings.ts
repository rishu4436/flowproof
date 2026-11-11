import { z } from "zod";

export const SettingsSchema = z
  .object({
    general: z
      .object({
        workspaceName: z.string().min(1).max(80),
        timezone: z.string().min(1).max(64),
        theme: z.enum(["studio", "light", "dark"]),
      })
      .strict(),
    execution: z
      .object({
        defaultTimeoutMs: z.number().int().min(1000).max(60_000),
        maxSteps: z.number().int().min(2).max(40),
        concurrency: z.number().int().min(1).max(2),
        requireApprovalBeforeWrite: z.boolean(),
        autoApproveSafeLocatorRepair: z.boolean(),
        maxRunDurationMs: z.number().int().min(10_000).max(180_000),
        approvalWaitMs: z.number().int().min(5_000).max(900_000),
      })
      .strict(),
    ai: z
      .object({
        primaryModel: z.string().max(120),
        repairModel: z.string().max(120),
        reviewModel: z.string().max(120),
        requestTimeoutMs: z.number().int().min(3000).max(120_000),
        maxPlanningCalls: z.number().int().min(1).max(3),
        maxRepairAttempts: z.number().int().min(0).max(2),
        perRunBudgetUsd: z.number().min(0).max(5),
      })
      .strict(),
    evidence: z
      .object({
        screenshotRetentionDays: z.number().int().min(1).max(30),
        maxScreenshotBytes: z.number().int().min(50_000).max(1_500_000),
        maxArtifactsPerRun: z.number().int().min(4).max(40),
      })
      .strict(),
    verification: z
      .object({
        requireAuthoritativeEvidence: z.boolean(),
        unknownOutcomeHandling: z.literal("outcome_unknown"),
      })
      .strict(),
    security: z
      .object({
        blockExternalWrites: z.literal(true),
      })
      .strict(),
    notifications: z
      .object({
        inApp: z.boolean(),
        webhookUrl: z.string().max(300),
      })
      .strict(),
  })
  .strict();

export type WorkspaceSettings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  general: { workspaceName: "FlowProof Demo", timezone: "UTC", theme: "studio" },
  execution: {
    defaultTimeoutMs: 15_000,
    maxSteps: 30,
    concurrency: 1,
    requireApprovalBeforeWrite: false,
    autoApproveSafeLocatorRepair: true,
    maxRunDurationMs: 120_000,
    approvalWaitMs: 180_000,
  },
  ai: {
    primaryModel: "",
    repairModel: "",
    reviewModel: "",
    requestTimeoutMs: 30_000,
    maxPlanningCalls: 2,
    maxRepairAttempts: 2,
    perRunBudgetUsd: 0.25,
  },
  evidence: {
    screenshotRetentionDays: 14,
    maxScreenshotBytes: 800_000,
    maxArtifactsPerRun: 30,
  },
  verification: {
    requireAuthoritativeEvidence: true,
    unknownOutcomeHandling: "outcome_unknown",
  },
  security: { blockExternalWrites: true },
  notifications: { inApp: true, webhookUrl: "" },
};

/** Server ceilings win over saved preferences. */
export function enforceSettings(value: WorkspaceSettings, ceilingUsd: number | null): WorkspaceSettings {
  return {
    ...value,
    execution: {
      ...value.execution,
      maxSteps: Math.min(value.execution.maxSteps, 40),
      concurrency: Math.min(value.execution.concurrency, 2),
      defaultTimeoutMs: Math.min(value.execution.defaultTimeoutMs, 60_000),
      maxRunDurationMs: Math.min(value.execution.maxRunDurationMs, 180_000),
    },
    ai: {
      ...value.ai,
      maxRepairAttempts: Math.min(value.ai.maxRepairAttempts, 2),
      maxPlanningCalls: Math.min(value.ai.maxPlanningCalls, 3),
      perRunBudgetUsd: ceilingUsd == null ? value.ai.perRunBudgetUsd : Math.min(value.ai.perRunBudgetUsd, ceilingUsd),
    },
    security: { blockExternalWrites: true },
    verification: {
      requireAuthoritativeEvidence: value.verification.requireAuthoritativeEvidence,
      unknownOutcomeHandling: "outcome_unknown",
    },
  };
}
