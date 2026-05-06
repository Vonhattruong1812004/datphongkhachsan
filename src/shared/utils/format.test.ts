import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatMoney, nightsBetween } from "./format";

test("nightsBetween tinh dung so dem co ban", () => {
  assert.equal(nightsBetween("2026-05-01", "2026-05-03"), 2);
});

test("nightsBetween toi thieu la 1", () => {
  assert.equal(nightsBetween("2026-05-01", "2026-05-01"), 1);
});

test("formatMoney tra ve chuoi tien te vi-VN", () => {
  assert.match(formatMoney(1250000), /1\.250\.000/);
});

test("formatDate tra ve ngay theo template mac dinh", () => {
  assert.equal(formatDate("2026-05-01"), "01/05/2026");
});
