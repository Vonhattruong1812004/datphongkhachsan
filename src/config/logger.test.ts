import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("request logs redact webhook credentials and session cookies", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--eval", `
    const {logger} = require('./src/config/logger.ts');
    logger.info({req:{headers:{authorization:'private-api-key',cookie:'private-session'}},res:{headers:{'set-cookie':'private-response-cookie'}}}, 'test');
  `], { encoding: "utf8", cwd: process.cwd() });
  assert.equal(output.includes("private-api-key"), false);
  assert.equal(output.includes("private-session"), false);
  assert.equal(output.includes("private-response-cookie"), false);
  assert.match(output, /Redacted/);
});
