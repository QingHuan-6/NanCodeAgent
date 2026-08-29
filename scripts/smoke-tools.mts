import fs from "node:fs";
import path from "node:path";
import { createDefaultRegistry } from "../src/tools/index.js";

const dir = path.join(process.cwd(), ".tmp-tool-smoke");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const tools = createDefaultRegistry();
const ctx = { workspace: dir };

const w = await tools.run(
  "write_file",
  { path: "hello.txt", content: "hello world\n" },
  ctx,
);
console.log("write:", w.output);

const r = await tools.run("read_file", { path: "hello.txt" }, ctx);
console.log("read:\n" + r.output);

const e = await tools.run(
  "edit_file",
  { path: "hello.txt", old_string: "world", new_string: "nan" },
  ctx,
);
console.log("edit:", e.output.split("\n")[0]);

const b = await tools.run("bash", { command: "echo smoke-ok" }, ctx);
console.log("bash exit line:", b.output.split("\n")[0]);

const escape = await tools.run("read_file", { path: "../outside.txt" }, ctx);
console.log("escape:", escape.output);

fs.rmSync(dir, { recursive: true, force: true });
console.log("SMOKE_OK");
