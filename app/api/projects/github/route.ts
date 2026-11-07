// Copyright © 2026 Alen Pepa
import { githubProjectResponse } from "../../../../lib/github-project";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return githubProjectResponse(request); }
