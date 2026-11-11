import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError(422, "invalid_request", "The request is not valid.", error.flatten());
  }
  if (error instanceof HttpError) return jsonError(error.status, error.code, error.message, error.details);
  console.error(error);
  return jsonError(500, "internal_error", error instanceof Error ? error.message : "Unexpected server error.");
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parsePagination(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function dateRange(url: URL) {
  const range = url.searchParams.get("range") ?? "7d";
  const now = new Date();
  if (range === "24h") return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now, range };
  if (range === "30d") return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now, range };
  if (range === "custom") {
    const from = new Date(url.searchParams.get("from") ?? "");
    const to = new Date(url.searchParams.get("to") ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new HttpError(422, "invalid_range", "Custom range needs valid from and to timestamps.");
    }
    return { from, to, range };
  }
  return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now, range: "7d" };
}
