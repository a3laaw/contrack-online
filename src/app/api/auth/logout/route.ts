import { NextRequest } from "next/server";
import { sessionCookieOptionsFor, SESSION_COOKIE } from "@/lib/auth";
import { ok } from "@/lib/api-utils";

export async function POST(req: NextRequest) {
  const res = ok({ message: "تم تسجيل الخروج" });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptionsFor(req), maxAge: 0 });
  return res;
}
