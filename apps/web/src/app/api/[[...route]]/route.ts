import { api } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (req: Request) => api.fetch(req);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
