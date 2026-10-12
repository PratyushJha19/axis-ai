import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import console from "node:console";
import { URL } from "node:url";
const path = new URL("../.env", import.meta.url);
let content = "";
try {
  content = readFileSync(path, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (/^[\t ]*AI_CREDENTIALS_ENCRYPTION_KEY[\t ]*=[\t ]*\S+/m.test(content)) {
  console.log("AI encryption key already configured. No changes made.");
} else if (/^[\t ]*AI_CREDENTIALS_ENCRYPTION_KEY[\t ]*=/m.test(content)) {
  writeFileSync(
    path,
    content.replace(
      /^[\t ]*AI_CREDENTIALS_ENCRYPTION_KEY[\t ]*=[\t ]*\r?$/m,
      `AI_CREDENTIALS_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    ),
  );
  console.log(
    "Configured the empty AI encryption setting without printing the key. Back up .env securely and restart AXIS.",
  );
} else {
  writeFileSync(
    path,
    `${content}\nAI_CREDENTIALS_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`,
  );
  console.log(
    "Generated a server encryption key in .env without printing it. Back up this file securely, restart AXIS, and enter your provider key only in AI Settings.",
  );
}
