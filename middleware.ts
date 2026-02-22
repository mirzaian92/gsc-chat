import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "gsc-chat";

function hasSessionCookie(req: NextRequest): boolean {
  const v = req.cookies.get(SESSION_COOKIE)?.value;
  return typeof v === "string" && v.length > 0;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public endpoints
  if (pathname.startsWith("/api/auth/google")) return NextResponse.next();
  if (pathname.startsWith("/api/stripe/webhook")) return NextResponse.next();

  if (pathname.startsWith("/app") || pathname.startsWith("/api/")) {
    if (!hasSessionCookie(req)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Not logged in." }, { status: 401 });
      }

      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};

