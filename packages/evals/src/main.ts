import { main } from "./cli";

process.exitCode = await main(process.argv.slice(2));
