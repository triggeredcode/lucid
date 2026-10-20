import { experimentMain } from "./cli";

process.exitCode = await experimentMain(process.argv.slice(2));
