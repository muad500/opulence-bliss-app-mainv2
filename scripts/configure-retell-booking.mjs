import { readFile, writeFile } from "node:fs/promises";
import Retell from "retell-sdk";
import { bookingTools } from "./retell-booking-tools.mjs";

const origin = process.env.NEXT_PUBLIC_SITE_URL;
const agentId = process.env.RETELL_BOOKING_AGENT_ID;
if (!origin || !agentId) throw new Error("Set NEXT_PUBLIC_SITE_URL and RETELL_BOOKING_AGENT_ID privately before running this script.");
const url = new URL(origin);
if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("NEXT_PUBLIC_SITE_URL must be the deployed HTTPS origin.");
const tools = bookingTools(url.origin, { vercelProtectionBypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
const prompt = await readFile(new URL("../docs/retell-receptionist-prompt.txt", import.meta.url), "utf8");
const apply = process.argv.includes("--apply");
if (!apply) {
  console.log(`Preview only: ${tools.map((tool) => tool.name).join(", ")} for agent ${agentId} at ${url.origin}.`);
  console.log("Add --apply to update the Retell draft; add --publish only after checking a browser test call.");
  process.exit(0);
}
if (!process.env.RETELL_API_KEY) throw new Error("Set RETELL_API_KEY privately. Never paste it into a prompt or commit it.");
const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
try {
  const agent = await retell.agent.retrieve(agentId);
  if (agent.response_engine.type !== "retell-llm") throw new Error("This installer supports single-prompt Retell LLM agents only.");
  const llmId = agent.response_engine.llm_id;
  const llm = await retell.llm.retrieve(llmId);
  // Save a private rollback snapshot; never print it or commit it.
  const backup = new URL("../.retell-booking-backup.json", import.meta.url);
  await writeFile(backup, JSON.stringify({ agentId, llmId, general_prompt: llm.general_prompt, general_tools: llm.general_tools, begin_message: llm.begin_message }, null, 2), { flag: "wx" });
  const replaced = new Set(tools.map((tool) => tool.name));
  await retell.llm.update(llmId, {
    general_prompt: prompt,
    begin_message: "Hello, you're speaking with the Opulence Bliss AI receptionist. I can answer questions and help arrange a cleaning booking. How can I help?",
    general_tools: [...(llm.general_tools ?? []).filter((tool) => !replaced.has(tool.name)), ...tools],
  });
  console.log("The Retell draft now has the booking prompt and all four functions. A private rollback snapshot was saved.");
  if (process.argv.includes("--publish")) {
    await retell.agent.publish(agentId, {});
    console.log("Agent published. Verify the phone number uses this published version.");
  }
} catch (error) {
  // SDK errors can contain request headers; do not print the error object.
  console.error(`Retell setup failed${typeof error?.status === "number" ? ` (HTTP ${error.status})` : ""}. Check account access, the agent type and whether a rollback snapshot already exists.`);
  process.exitCode = 1;
}
