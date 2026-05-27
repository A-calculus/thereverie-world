/**
 * test-native-methods.mjs
 *
 * E2E smoke tests for non-default Somnia native agent methods.
 * These are paid testnet calls.
 *
 * Usage: node test-native-methods.mjs
 */
import { SomniaAgentKit } from "@worldframe/sdk";
import { requireEnv, validateRequired } from "./env.mjs";

validateRequired([
  "BUILDER_PRIVATE_KEY",
  "CALLBACK_RECEIVER_LLM",
  "CALLBACK_RECEIVER_PRIMARY",
]);

const kit = new SomniaAgentKit({
  network: "testnet",
  privateKey: requireEnv("BUILDER_PRIVATE_KEY"),
  callbackReceiverLlm: requireEnv("CALLBACK_RECEIVER_LLM"),
  callbackReceiverPrimary: requireEnv("CALLBACK_RECEIVER_PRIMARY"),
  timeoutMs: 420_000,
});

async function main() {
  console.log("=".repeat(60));
  console.log("🧪 Somnia Native Method Coverage — E2E Test");
  console.log("=".repeat(60));

  try {
    const llmNumber = await kit.executeLLM({
      method: "inferNumber",
      prompt: "Return only the number of continents on Earth.",
      systemPrompt: "You return only integers.",
      minValue: 1n,
      maxValue: 10n,
      chainOfThought: false,
    });
    console.log(`\n✅ LLM inferNumber: ${llmNumber.value}`);

    const llmChat = await kit.executeLLM({
      method: "inferChat",
      roles: ["system", "user"],
      messages: [
        "You answer in one short sentence.",
        "Name one use case for a deterministic on-chain agent.",
      ],
      chainOfThought: false,
    });
    console.log(`✅ LLM inferChat: ${llmChat.text}`);

    const jsonBool = await kit.executeJsonApi({
      method: "fetchBool",
      url: "https://jsonplaceholder.typicode.com/todos/1",
      selector: "completed",
    });
    console.log(`✅ JSON fetchBool: ${jsonBool.value}`);

    const jsonStringArray = await kit.executeJsonApi({
      method: "fetchStringArray",
      url: "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&daily=weather_code&forecast_days=3",
      selector: "daily.time",
    });
    console.log(`✅ JSON fetchStringArray: ${JSON.stringify(jsonStringArray.value)}`);

    const jsonUintArray = await kit.executeJsonApi({
      method: "fetchUintArray",
      url: "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.1&daily=weather_code&forecast_days=3",
      selector: "daily.weather_code",
      decimals: 0,
    });
    console.log(`✅ JSON fetchUintArray: ${jsonUintArray.value.map((v) => v.toString()).join(", ")}`);

    const webNumber = await kit.executeWebParse({
      method: "ExtractANumber",
      url: "https://en.wikipedia.org/wiki/Somnia_(film)",
      key: "release_year",
      description: "The year the film Before I Wake, also known as Somnia, was first released.",
      min: 2000n,
      max: 2030n,
      prompt: "What year was Before I Wake, also known as Somnia, released?",
      resolveUrl: false,
      numPages: 1,
      confidenceThreshold: 50,
      subcommitteeSize: 3n,
      threshold: 2n,
    });
    console.log(`✅ Web Parse ExtractANumber: ${webNumber.value}`);
  } catch (err) {
    console.error("\n❌ Native method coverage failed:", err);
    process.exit(1);
  } finally {
    kit.destroy();
  }
}

main();
