import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { chefAgent, recipeFormatterAgent } from "../agents/chef-agent";

const contextSchema = z.object({
  season: z
    .enum(["spring", "summer", "autumn", "winter"])
    .optional()
    .describe("The season"),
  timeOfDay: z
    .enum(["breakfast", "lunch", "dinner"])
    .describe("The time of day"),
  peopleEating: z
    .array(z.enum(["Guillaume", "Marie"]))
    .describe("The people eating"),
  recipeComplexity: z
    .enum(["easy", "medium", "hard"])
    .describe("The complexity of the recipe"),
  recipeTime: z
    .enum(["short", "medium", "long"])
    .describe("The cook time of the people eating"),
  country: z.string().describe("The country"),
  language: z.string().describe("The language"),
});

const recipeTimeOptions = {
  short: "around 30 minutes",
  medium: "around 1 hour",
  long: "more than 1 hour",
};

const ingredientSchema = z.object({
  name: z
    .string()
    .describe(
      "The name of the ingredient. Important: should only contains the name (no other information like diced, minced, etc)"
    ),
  quantity: z.string().describe("The quantity of the ingredient"),
  unit: z.string().describe("The unit of the ingredient"),
});

const recipeSchema = z.object({
  name: z.string().describe("The name of the recipe"),
  description: z.string().describe("The description of the recipe"),
  visualDescription: z
    .string()
    .describe("The short visual description of the plate content"),
  numberOfPeople: z.number().describe("The number of people the recipe is for"),
  mealType: z
    .enum(["breakfast", "lunch", "dinner"])
    .describe("The type of meal"),
  complexity: z
    .enum(["easy", "medium", "hard"])
    .describe("The complexity of the recipe"),
  time: z.number().describe("The time to prepare the recipe"),
  requiredUtensils: z
    .array(z.string())
    .describe("The utensils required for the recipe"),
  ingredients: z.array(
    z.object({
      recipePart: z
        .string()
        .describe("What part of the recipe the ingredients are used for"),
      ingredients: z
        .array(ingredientSchema)
        .describe("The listing of ingredients for this recipe part"),
    })
  ),
  instructions: z
    .array(
      z.object({
        title: z.string().describe("The title of the instruction"),
        steps: z.array(z.string()).describe("The steps of the instruction"),
      })
    )
    .describe(
      "The instructions of the recipe (do not put the step number, just the instructions)"
    ),
  notes: z
    .array(z.string())
    .describe("Any additional notes that you need to give")
    .optional(),
});

const mealPlannerInstructions = createStep({
  id: "meal-planner-instructions",
  description: "Get the meal planner instructions",
  inputSchema: contextSchema,
  outputSchema: z.string().describe("The meal planner instructions"),
  execute: async ({ inputData: context }) => {
    const MarieExcludedIngredients = [
      "mushrooms",
      "hot spices",
      "cheese",
      "pork",
      "lamb",
      "pepper",
      "radish",
      "coriander",
    ];

    const GuillaumeExcludedIngredients = ["radish"];

    const excludedIngredients = [];

    if (context.peopleEating.includes("Marie")) {
      excludedIngredients.push(...MarieExcludedIngredients);
    }

    if (context.peopleEating.includes("Guillaume")) {
      excludedIngredients.push(...GuillaumeExcludedIngredients);
    }

    const instructions = `
      # Meal planner demand

      I want you to create a meal with avocado and salmon.

      ## Context
      - Meal type: ${context.timeOfDay}
      - Cooking time: ${recipeTimeOptions[context.recipeTime]}
      - Recipe complexity: ${context.recipeComplexity}
      - Number of people eating: ${context.peopleEating.length}
      ${context.season ? `- Season: ${context.season}` : ""}
      - Country: ${context.country}
      - Language: ${context.language}

      # Additional information

      If there is any dough, it should be made at home. (except for pasta).

      ${
        excludedIngredients.length > 0
          ? `## Allergen restrictions, disliked ingredients, etc

      The recipe should not contain :
      ${excludedIngredients.join(", ")}`
          : ""
      }
      `;

    return instructions;
  },
});

const createMeal = createStep({
  id: "create-meal",
  description: "Creates a meal based on the family info",
  inputSchema: z.string().describe("The instructions"),
  outputSchema: z.string().describe("The recipe"),
  execute: async ({ inputData: mealPlannerInstructions, getInitData }) => {
    const context: z.infer<typeof contextSchema> = getInitData();

    const prompt = `
      ${mealPlannerInstructions}

      # Recipe format

      You should use the following template to create the recipe:

      Name: meal name

      Description: meal description

      Visual description: short visual description of the plate content

      Number of people: 1

      Meal type: meal type

      Complexity: recipe complexity

      Time: cooking time

      Required utensils:
      - utensil 1
      - utensil 2
      - ...

      Ingredients

      Recipe part 1 title:
      - ingredient 1 with quantity and unit
      - ingredient 2 with quantity and unit
      - ...

      Recipe part 2 title:
      - ingredient 1 with quantity and unit
      - ingredient 2 with quantity and unit
      - ...

      ...

      Instructions

      1) Instruction 1 title:
      - step 1
      - step 2
      - ...

      2) Instruction 2 title:
      - step 1
      - step 2
      - ...

      ...

      Additional notes
      - Note 1
      - Note 2
      - ...

      # General rules
      The ingredients should be easy to find in the given country central market.
      The list of ingredients should only precise the name of the ingredient, the quantity and the unit, not other information like diced, minced, etc. Every other information should be in the instructions.
      The required utensils should only be utensils that are not basic utensils. (knife, spoon, plate, etc)
      The recipe units should be in the country units asked by the meal planner.
      The recipe should be in the language asked by the meal planner.
      The recipe should be for the number of people that will be eating the meal.
    `;

    const { text } = await chefAgent.generate([
      {
        role: "user",
        content: prompt,
      },
    ]);

    return text;
  },
});

const recipeToJson = createStep({
  id: "recipe-to-json",
  description: "Converts the recipe to a JSON object",
  inputSchema: z.string().describe("The recipe"),
  outputSchema: recipeSchema,
  execute: async ({ inputData: recipe }) => {
    const { object } = await recipeFormatterAgent.generate(
      [
        {
          role: "user",
          content: `
        # Recipe
        ${recipe}

        # Instructions
        Convert the recipe to a JSON object.
      `,
        },
      ],
      { output: recipeSchema }
    );

    return object;
  },
});

const mealCreationWorkflow = createWorkflow({
  id: "meal-creation-workflow",
  inputSchema: contextSchema,
  outputSchema: recipeSchema,
})
  .then(mealPlannerInstructions)
  .then(createMeal)
  .then(recipeToJson);

mealCreationWorkflow.commit();

export { mealCreationWorkflow };
