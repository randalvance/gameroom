// The demo's agents: a handful of made-up workers in every status, so the
// room is busy without an agent runtime behind it. Swap this for your own
// list and nothing else changes.

import type { Agent } from "~/lib/agents"

export function demoAgents(): Agent[] {
  return [
    { id: "planner", name: "Planner", status: "working", activity: "Breaking the task into steps" },
    { id: "researcher", name: "Researcher", status: "working", activity: "Reading the docs" },
    { id: "researcher-2", name: "Fetcher", status: "working", activity: "Fetching sources", parentId: "researcher" },
    { id: "coder", name: "Coder", status: "waiting", activity: "Needs approval to run tests" },
    { id: "reviewer", name: "Reviewer", status: "idle" },
    { id: "tester", name: "Tester", status: "done", activity: "All 12 checks passed" },
    { id: "deployer", name: "Deployer", status: "error", activity: "Deploy failed: 502 from the registry" },
    { id: "archivist", name: "Archivist", status: "offline" },
  ]
}
