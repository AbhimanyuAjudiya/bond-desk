import { CronCapability, Runner, type TeeRuntime, handlerInTee } from "@chainlink/cre-sdk"
import { type Config, configSchema, run } from "./handler"

// Handler logic lives in handler.ts so it can be unit-tested; `await main()` below runs at import.
const initWorkflow = (config: Config) => [
  handlerInTee(new CronCapability().trigger({ schedule: config.schedule }), (runtime: TeeRuntime<Config>) => run(runtime), [{ tee: "nitro", regions: ["us-west-2"] }]),
]

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

await main()
