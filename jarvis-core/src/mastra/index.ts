import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { chefAgent } from "./agents/chef-agent";
import { mealCreationWorkflow } from "./workflows/meal-creation.workflow";

export const mastra = new Mastra({
  workflows: { mealCreationWorkflow },
  agents: { chefAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
});
