import { z } from "zod";
import { ACTION_TYPES } from "@flowproof/core";

export const RecoveryProposalSchema = z
  .object({
    failureCategory: z.enum([
      "element_not_found",
      "element_not_actionable",
      "navigation_timeout",
      "unexpected_dialog",
      "changed_form_structure",
      "authentication_required",
      "business_validation_failure",
      "network_failure",
      "unexpected_response",
      "outcome_unknown",
      "policy_violation",
    ]),
    diagnosis: z.string().min(1).max(500),
    proposedAction: z
      .object({
        type: z.enum(["click", "type", "select", "wait_for", "skip"]),
        role: z.enum(["button", "link", "textbox", "combobox", "checkbox"]).optional(),
        name: z.string().max(200).optional(),
        label: z.string().max(200).optional(),
        value: z.string().max(500).optional(),
      })
      .strict(),
    candidateTarget: z
      .object({
        role: z.string().max(40),
        name: z.string().max(200),
        reason: z.string().max(300),
      })
      .strict(),
    uncertainty: z.string().min(1).max(400),
    evidence: z.array(z.string().max(300)).max(8),
    expectedEffect: z.string().min(1).max(300),
    changesWriteBehavior: z.boolean(),
  })
  .strict();

export type RecoveryProposal = z.infer<typeof RecoveryProposalSchema>;

export const PlanProposalSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(600),
    category: z.enum(["finance", "operations", "demo", "general"]),
    objective: z.string().min(1).max(600),
    nodes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
            type: z.enum(ACTION_TYPES),
            name: z.string().min(1).max(120),
            url: z.string().max(500).optional(),
            label: z.string().max(200).optional(),
            targetName: z.string().max(200).optional(),
            valueFrom: z.string().max(64).optional(),
            effect: z.enum(["read", "write"]).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(20),
    notes: z.array(z.string().max(240)).max(6),
  })
  .strict();

export type PlanProposal = z.infer<typeof PlanProposalSchema>;

export const ExplanationSchema = z
  .object({
    summary: z.string().min(1).max(800),
    limitations: z.array(z.string().max(240)).max(6),
  })
  .strict();
