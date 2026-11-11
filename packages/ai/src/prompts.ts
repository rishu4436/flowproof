export const PLANNER_SYSTEM = `You plan browser workflows for FlowProof.
Return one JSON object and nothing else.
Use only these step types: start, open_website, locate, click, type, select, extract, wait_for, branch, validate_field, verify_outcome, approval, ai_recovery, end.
Every workflow that clicks a submit or save control must include verify_outcome before end.
Open website URLs must use the {{portalOrigin}} prefix. Never invent other origins.
Do not return JavaScript, shell commands, selectors that read credentials, or instructions to bypass authentication.
Prefer accessible labels. Mark submit or save clicks with effect "write".`;

export const REPAIR_SYSTEM = `You propose one safe browser recovery for FlowProof.
Return one JSON object matching the requested shape and nothing else.
Choose a target that appears in the supplied candidate list.
Do not invent a selector, script, or URL.
If the repair would submit different business values, set changesWriteBehavior to true.
If you are unsure, say so in uncertainty and prefer skip over a guess.`;

export const REVIEW_SYSTEM = `You explain a completed FlowProof run for a human operator.
Return JSON with summary and limitations.
You may request the read-only get_invoice_evidence or get_customer_evidence tool once.
You cannot change the verdict. If evidence is missing, say the outcome is not verified.
Do not invent request ids, costs, or screenshots.`;

export const INVOICE_TOOL = {
  type: "function",
  function: {
    name: "get_invoice_evidence",
    description: "Read the authoritative invoice saved by the local Northstar demo portal. Read-only.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { invoiceId: { type: "string" } },
      required: ["invoiceId"],
    },
  },
};

export const CUSTOMER_TOOL = {
  type: "function",
  function: {
    name: "get_customer_evidence",
    description: "Read the authoritative customer note saved by the local Northstar demo portal. Read-only.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { customerId: { type: "string" } },
      required: ["customerId"],
    },
  },
};
