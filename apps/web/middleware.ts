import { NextResponse, type NextRequest } from "next/server";
import { demoToken } from "./lib/session-token";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname === "/icon.svg") {
    return NextResponse.next();
  }
  const demo = process.env.FLOWPROOF_DEMO_MODE !== "false";
  const isPublic = pathname === "/" || pathname === "/api/health";
  const response = NextResponse.next();
  if (demo && !request.cookies.get("fp_session")) {
    response.cookies.set("fp_session", await demoToken(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  }
  if (!isPublic && !demo && !request.cookies.get("fp_session") && pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: { code: "auth_required", message: "Production automation is disabled until authentication is configured." } },
      { status: 403 },
    );
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
