// Copyright © 2026 Alen Pepa
import { webSourceResponse } from "../../../../lib/web-sources";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return webSourceResponse(request); }
