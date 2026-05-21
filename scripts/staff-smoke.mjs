import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assertContains(source, needle, label) {
  if (!source.includes(needle)) {
    fail(`${label} is missing: ${needle}`);
  }
}

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    fail(`Syntax check failed for ${filePath}\n${details}`);
  }
}

async function main() {
  const adminControllerPath = "controllers/admin/adminPortalController.js";
  const staffModelPath = "models/staffModel.js";

  const [adminControllerSource, staffModelSource] = await Promise.all([
    readFile(adminControllerPath, "utf8"),
    readFile(staffModelPath, "utf8"),
  ]);

  assertContains(staffModelSource, "removeStaffByAccountUid", "Staff model UID cleanup helper");
  assertContains(staffModelSource, "accountUid", "Staff model account linkage field");

  assertContains(adminControllerSource, "validateScheduleBeforeSave", "Schedule validation hook");
  assertContains(adminControllerSource, "removeStaffByAccountUid", "Controller UID-based staff cleanup");
  assertContains(adminControllerSource, "renderSectionState", "Shared section state renderer");

  runNodeCheck(adminControllerPath);
  runNodeCheck("views/staffView.js");

  console.log("PASS: Staff smoke checks succeeded.");
}

main().catch((error) => {
  fail(error?.stack || String(error));
});
