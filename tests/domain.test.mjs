import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMonogram } from "../src/domain.mjs";
test("Cyrillic and Latin initials are normalized; markup, digits and overflow removed", () => {
  assert.equal(normalizeMonogram("иван"), "ИВА");
  assert.equal(normalizeMonogram("<а2b>"), "АB");
  assert.equal(normalizeMonogram("123"), "");
});
