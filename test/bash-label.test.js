"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// The plugin ships as TypeScript; Node 24 strips the types on import.
const PET_URL = pathToFileURL(path.join(__dirname, "..", "plugin", "pet.ts")).href;

let bashLabel;

test("bash labels load", async () => {
  ({ bashLabel } = await import(PET_URL));
  assert.equal(typeof bashLabel, "function");
});

const CASES = [
  // package managers
  ["npm test", "testing"],
  ["npm install", "installing"],
  ["npm ci", "installing"],
  ["npm run build", "building"],
  ["npm run test", "testing"],
  ["npm run dev", "starting"],
  ["yarn add lodash", "installing"],
  ["pnpm dev", "starting"],
  ["npx tsc --noEmit", "type-checking"],
  ["npx vitest run", "testing"],
  // git
  ['git commit -m "fix"', "committing"],
  ["git push origin main", "pushing"],
  ["git pull", "pulling"],
  ["git status", "checking status"],
  ["git diff HEAD", "diffing"],
  ["git checkout -b feat", "switching branch"],
  ["git merge main", "merging"],
  ["git log --oneline", "reading history"],
  // github
  ["gh pr edit 3 --repo x/y --body-file a.md", "editing PR"],
  ["gh pr create --title t", "opening PR"],
  ["gh pr merge 3", "merging PR"],
  ["gh pr view 3", "viewing PR"],
  ["gh pr list", "listing PRs"],
  ["gh issue close 5", "managing issue"],
  ["gh run list", "checking CI"],
  // languages and tools
  ["node script.js", "running node"],
  ["python build.py", "running python"],
  ["pip install requests", "installing packages"],
  ["uv sync", "installing packages"],
  ["cargo build", "building"],
  ["cargo test", "testing"],
  ["go test ./...", "testing"],
  ["docker compose up", "starting containers"],
  ["kubectl get pods", "reading cluster"],
  ["make build", "building"],
  ["tsc --noEmit", "type-checking"],
  ["vitest run", "testing"],
  ["eslint .", "linting"],
  // file-ish shell
  ["ls -la", "listing files"],
  ["rm -rf dist", "removing"],
  ["cp a b", "copying"],
  ["mv a b", "moving"],
  ["mkdir newdir", "creating folder"],
  ["curl https://example.com", "fetching"],
  ["cat README.md", "reading"],
  ["echo hello", "writing"],
  // chained commands use the meaningful segment
  [
    "cd D:/work; gh pr edit 3 --repo a/b --body-file c.md 2>&1 | Select-Object -Last 2",
    "editing PR",
  ],
  ["cd D:/foo && npm test && npm run build", "testing"],
  // PowerShell cmdlets (Windows default shell)
  ["Get-Content state.json -Raw", "reading"],
  ["$s = Get-Content state.json -Raw; ConvertFrom-Json", "parsing json"],
  ["Get-Process electron | Select-Object Id,ProcessName", "checking processes"],
  ["Get-ChildItem -Force", "listing files"],
  ["Set-Content out.txt hello", "writing"],
  ["Invoke-WebRequest https://example.com", "fetching"],
  ["Select-String -Pattern TODO -Path .\\*.ts", "searching"],
  ["Remove-Item -Recurse dist", "removing"],
  // variable assignments are skipped so the real cmdlet wins
  [
    '$dir = Join-Path $env:USERPROFILE ".cache\\opencode-pet"; Get-ChildItem $dir',
    "listing files",
  ],
  [
    '$p = Join-Path $env:USERPROFILE ".cache\\opencode-pet\\state.json"; $s = Get-Content $p -Raw | ConvertFrom-Json; $s.feed | ForEach-Object { $_.text }',
    "parsing json",
  ],
  // unknown falls back to the command name
  ["somecustomtool --flag value", "running somecustomtool"],
];

for (const [cmd, expected] of CASES) {
  test(`bash label: ${cmd} -> ${expected}`, async () => {
    assert.equal(bashLabel(cmd), expected);
  });
}
