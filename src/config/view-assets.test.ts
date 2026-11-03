import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ejs from "ejs";
import postcss from "postcss";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

test("extracted presentation assets are valid CSS and preserve cascade order", () => {
  for (const file of ["app.css", "home.css", "runtime-ui.css", "booking-experience.css"]) {
    const css = read(`public/${file}`);
    assert.doesNotThrow(() => postcss.parse(css, { from: file }));
    assert.ok(css.trim().length > 0);
  }
  const footer = read("src/views/partials/footer.ejs");
  assert.match(footer, /href="\/runtime-ui\.css\?/);
  assert.ok(footer.indexOf("/runtime-ui.css") < footer.indexOf("/booking-experience.css"));
  const home = read("src/views/home/index.ejs");
  assert.match(home, /href="\/home\.css\?/);
  assert.ok(home.indexOf("/home.css") < home.indexOf('<main class="travel-home"'));
});

test("homepage and assistant do not load retired presentation components", () => {
  const home = read("src/views/home/index.ejs");
  assert.doesNotMatch(home, /home-galaxy-earth|travel-theme-toggle|travel-install-app|<style\b/);
  const footer = read("src/views/partials/footer.ejs");
  assert.doesNotMatch(footer, /floatingAiDecisionBar|data-ai-copy-decision|data-ai-toggle-compact|<style\b/);
  assert.doesNotMatch(read("public/runtime-ui.css"), /\.floating-assist__(vip|decision)/);
});

test("all EJS templates compile after presentation cleanup", () => {
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (file.endsWith(".ejs")) {
        assert.doesNotThrow(() => ejs.compile(readFileSync(file, "utf8"), { filename: file }), file);
      }
    }
  };
  walk(path.resolve(process.cwd(), "src/views"));
});

test("fixed payment buttons stay associated with their original booking forms", () => {
  const multi = read("src/views/booking/multi.ejs");
  assert.equal((multi.match(/id="submitBookingButton"/g) || []).length, 1);
  assert.match(multi, /<button[^>]*id="submitBookingButton"[^>]*type="submit"[^>]*form="multiBookingForm"/);
  assert.match(multi, /<form[^>]*method="post"[^>]*action="\/booking\/multi"[^>]*id="multiBookingForm"/);
  const review = read("src/views/booking/review.ejs").replace(/<%[\s\S]*?%>/g, "");
  assert.match(review, /<form[^>]*id="reviewBookingForm"/);
  assert.match(review, /<button[^>]*form="reviewBookingForm"[^>]*name="btn_action"[^>]*value="confirm"/);
});

test("shared styles leave hero heading contrast to the owning page", () => {
  const css = postcss.parse(read("public/runtime-ui.css"));
  css.walkRules((rule) => {
    assert.ok(!rule.selectors.some((selector) => /^\[class\*="-hero"\] h[12]$/.test(selector)), rule.selector);
  });
});

test("audited page styles and role backgrounds remain valid CSS", () => {
  const templates = [
    "admin/users", "admin/backups", "admin/restore", "admin/diagnostics",
    "admin/system-readiness", "admin/mobile-readiness", "admin/ai-diagnostics", "admin/multi-hotel-diagnostics",
    "accounting/expenses", "service/catalog", "manager/promotions",
    "partials/cskh-background", "partials/customer-background", "partials/accounting-background"
  ];
  for (const template of templates) {
    const markup = read(`src/views/${template}.ejs`).replace(/<%[\s\S]*?%>/g, "0");
    for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
      assert.doesNotThrow(() => postcss.parse(style[1], { from: template }), template);
    }
  }
});
