import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  loadEnvFiles,
  writeUserEnv,
  userEnvPath,
} from "../config/env.js";

const PRESETS: Array<{
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}> = [
  {
    id: "1",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  {
    id: "2",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    id: "3",
    label: "Custom OpenAI-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
];

/**
 * First-run / re-run wizard: ask for API key and gateway, save to ~/.nan-agent/.env
 */
export async function runSetupWizard(options?: {
  rl?: readline.Interface;
}): Promise<string> {
  const ownRl = !options?.rl;
  const rl =
    options?.rl ??
    readline.createInterface({ input, output, terminal: true });

  try {
    console.log(`
NanCodeAgent setup
Config will be saved to: ${userEnvPath()}
(You can change it later with: npm run dev -- --setup)
`);

    console.log("Provider presets:");
    for (const p of PRESETS) {
      console.log(`  ${p.id}) ${p.label}`);
    }

    let preset = PRESETS[0];
    const choice = (await rl.question("Choose provider [1]: ")).trim() || "1";
    preset = PRESETS.find((p) => p.id === choice) ?? PRESETS[0];

    let baseUrl = preset.baseUrl;
    let model = preset.model;

    if (preset.id === "3") {
      baseUrl =
        (
          await rl.question(`Base URL [${preset.baseUrl}]: `)
        ).trim() || preset.baseUrl;
      model =
        (await rl.question(`Model [${preset.model}]: `)).trim() || preset.model;
    } else {
      const urlIn = (
        await rl.question(`Base URL [${baseUrl}]: `)
      ).trim();
      if (urlIn) baseUrl = urlIn;
      const modelIn = (await rl.question(`Model [${model}]: `)).trim();
      if (modelIn) model = modelIn;
    }

    let apiKey = "";
    while (!apiKey) {
      apiKey = (await rl.question("API key: ")).trim();
      if (!apiKey) console.log("API key is required.");
    }

    const file = writeUserEnv({
      NAN_API_KEY: apiKey,
      NAN_BASE_URL: baseUrl.replace(/\/$/, ""),
      NAN_MODEL: model,
    });

    // Refresh process.env from files (shell vars still win)
    loadEnvFiles();
    // Ensure wizard values apply even if an empty project .env existed
    process.env.NAN_API_KEY = apiKey;
    process.env.NAN_BASE_URL = baseUrl.replace(/\/$/, "");
    process.env.NAN_MODEL = model;

    console.log(`\nSaved. You can use NanCodeAgent from any folder now.\n`);
    return file;
  } finally {
    if (ownRl) rl.close();
  }
}
