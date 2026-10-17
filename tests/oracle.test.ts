import { test } from "node:test";
import assert from "node:assert/strict";
import {
  permittedLimit,
  admissionReason,
  type Policy,
  type Resources,
} from "../cloud/oracle/resources";
const p: Policy = {
  configured: 3,
  calibrated: 2,
  reserveMB: 1536,
  diskReserveMB: 2048,
  perBrowserMB: 1024,
  startupMB: 512,
  cpuCeiling: 85,
};
const r = { availableMB: 8192, diskFreeMB: 10000 } as Resources;
test("Oracle admission respects calibrated ceiling and keeps launch reserve", () => {
  assert.equal(permittedLimit(p, r, 0), 2);
  assert.ok(admissionReason(p, r, 2, 0));
  assert.equal(admissionReason(p, r, 1, 0), undefined);
  assert.ok(admissionReason(p, { ...r, availableMB: 2500 }, 0, 0));
  assert.equal(permittedLimit(p, { ...r, availableMB: 1000 }, 2), 0);
});
test("Oracle rejects sustained CPU or low disk independently of free RAM", () => {
  assert.ok(admissionReason(p, r, 0, 3));
  assert.ok(admissionReason(p, { ...r, diskFreeMB: 100 }, 0, 0));
  assert.equal(admissionReason(p, r, 0, 2), undefined);
});
