#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repo = process.env.GITHUB_REPOSITORY || "oaslananka/a2amesh";
const manifestPath = process.argv[2] || "docs/roadmap/github-issues-2026-06-30.json";
const issues = JSON.parse(readFileSync(manifestPath, "utf8"));

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

const milestones = JSON.parse(gh(["api", "repos/" + repo + "/milestones", "--paginate"]));
const milestoneByTitle = new Map(milestones.map((m) => [m.title, m.number]));
const existing = JSON.parse(gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", "500", "--json", "title,number,url"]));
const existingByTitle = new Map(existing.map((i) => [i.title, i]));

let created = 0;
let skipped = 0;
for (const issue of issues) {
  if (existingByTitle.has(issue.title)) {
    const item = existingByTitle.get(issue.title);
    console.log("skip #" + item.number + ": " + issue.title);
    skipped += 1;
    continue;
  }
  const milestone = milestoneByTitle.get(issue.milestone);
  if (!milestone) throw new Error("Missing milestone: " + issue.milestone);
  const args = ["api", "repos/" + repo + "/issues", "-f", "title=" + issue.title, "-f", "body=" + issue.body, "-F", "milestone=" + milestone];
  for (const label of issue.labels) args.push("-f", "labels[]=" + label);
  const out = JSON.parse(gh(args));
  console.log("created #" + out.number + ": " + out.html_url);
  created += 1;
}
console.log(JSON.stringify({ created, skipped, total: issues.length }, null, 2));
