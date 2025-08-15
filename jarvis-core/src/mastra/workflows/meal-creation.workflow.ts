import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  chefAgent,
  recipeFormatterAgent,
  sousChefAgent,
} from "../agents/chef-agent";

const contextSchema = z.object({
  season: z
    .enum(["spring", "summer", "autumn", "winter"])
    .describe("The season"),
  timeOfDay: z
    .enum(["breakfast", "lunch", "dinner"])
    .describe("The time of day"),
  membersEating: z.array(z.string()).describe("The family members eating"),
  mealPlannerInstructions: z
    .string()
    .describe("The instructions given by the meal planner")
    .optional(),
});

const familyInfoSchema = z.object({
  familyName: z.string().describe("The family name"),
  globalAsk: z.string().describe("The global ask of the family"),
  country: z.string().describe("The country of the family"),
  cookLevel: z.string().describe("The cook level of the family"),
  familyMembers: z.array(
    z.object({
      name: z.string().describe("The name of the family member"),
      specialAsk: z.string().describe("The special ask of the family member"),
    })
  ),
});

const getFamilyEatersInfo = createStep({
  id: "get-family-eaters-info",
  description: "Fetches family eaters info",
  inputSchema: contextSchema,
  outputSchema: familyInfoSchema,
  execute: async ({ inputData: context }) => {
    const familyInfo = {
      familyName: "Lacoste",
      globalAsk:
        "We want to eat healthy and balanced meals. If possible, we want to do most of the things by hands (buns, tortillas, etc).",
      country: "France",
      cookLevel:
        "The family cook is not a professional chef, but has really great skills at cooking and love to cook.",
      familyMembers: [
        {
          name: "Guillaume",
          specialAsk: `
          # Dietary Preferences:
            - Likes everything
            - Can handle spicy food
          # Notes: 
            - Good cook
            - Enjoys food from all around the world
            - Self-described foodie
          `,
        },
        {
          name: "Marie",
          specialAsk: `
          # Dislikes:
            - Spicy food
            - Mushrooms
            - Large pieces of meat (but likes things like pulled meat, or chicken breast)
            - Pork
            - Cheese
          `,
        },
      ],
    };

    return {
      ...familyInfo,
      familyMembers: familyInfo.familyMembers.filter((member) =>
        context.membersEating.some(
          (name) => name.toLowerCase() === member.name.toLowerCase()
        )
      ),
    };
  },
});

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
    .array(z.string())
    .describe(
      "The instructions of the recipe (do not put the step number, just the instructions)"
    ),
  notes: z
    .array(z.string())
    .describe("Any additional notes that you need to give")
    .optional(),
});

const summarizeInstructions = createStep({
  id: "summarize-instructions",
  description: "Summarizes the instructions",
  inputSchema: familyInfoSchema,
  outputSchema: z.string().describe("The summarized instructions"),
  execute: async ({ inputData: familyInfo, getInitData }) => {
    const context: z.infer<typeof contextSchema> = getInitData();

    const instructions = `
      # Family info
      You are creating a meal for the family ${familyInfo.familyName} from ${familyInfo.country}.
      Here are some instructions given by the family :
      ${familyInfo.globalAsk}

      # Cook level
      ${familyInfo.cookLevel}
      
      # Family members eating
      There are ${familyInfo.familyMembers.length} family members who will be eating the meal, here are some info about them:
      ${familyInfo.familyMembers.map((member) => `<${member.name}>${member.specialAsk}</${member.name}>`).join("\n")}

      ${
        context.mealPlannerInstructions
          ? `
          # Meal planner instructions
          ${context.mealPlannerInstructions}
          `
          : ""
      }

      # Context
      The season is ${context.season}.
      The meal is for the ${context.timeOfDay}.
      `;

    return instructions;
  },
});

const createMeal = createStep({
  id: "create-meal",
  description: "Creates a meal based on the family info",
  inputSchema: z.string().describe("The instructions"),
  outputSchema: z.string().describe("The recipe"),
  execute: async ({ inputData: instructions, getInitData }) => {
    const context: z.infer<typeof contextSchema> = getInitData();

    const prompt = `
      ${instructions}

      # Instructions
      Now that you know more about the family and the people who will be eating the meal, create a meal for them that will follow the cook level.

      # Recipe
      The recipe should contain the following information:
      - Name
      - Description
      - Number of people
      - Meal type: ${context.timeOfDay}
      - Complexity: easy|medium|hard
      - Time
      - Special requirements for the utensils (if any) (basic utensils should be not mentioned)
      - Ingredients divided by recipe parts (with quantity and unit)
      - Instructions
      - Notes for the family (optional)

      # Rule
      The recipe should be given in the language of the family with the units of the country that the family is from.
      The recipe should be in the language of the family with the units of the country that the family is from.
      The recipe should be for the number of people that will be eating the meal.
      Don't mention the family members in the recipe, recipe should usable for other people.
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

const recipeReviewSchema = z.object({
  good: z.boolean().describe("If the recipe is good, or does it need changes"),
  review: z
    .string()
    .describe("Only if the recipe is not good, give a review of the recipe")
    .optional(),
});

const reviewRecipe = createStep({
  id: "review-recipe",
  description: "Reviews the recipe",
  inputSchema: z.string().describe("The recipe to check"),
  outputSchema: recipeReviewSchema,
  execute: async ({ inputData: recipe, getStepResult }) => {
    const instructions = getStepResult(summarizeInstructions);

    const prompt = `
      ${instructions}
     
      # Recipe created by the chef
      ${recipe}

      # Your responsibilities
      - Reviewing recipes for logical flow and consistency in cooking steps
      - Verifying that all ingredients and techniques align with the family's dietary restrictions and preferences
      - Checking that cooking times, temperatures, and measurements are accurate and realistic.
      - Ensuring recipes match the meal planner's specific requests and constraints.
      - Identifying any potential issues, mistakes, or unclear instructions.
      - Suggesting improvements to the recipe.
      - If the recipe is good, do not over think just say it.

      # Instructions
      Give a review for the recipe.
    `;

    const { object } = await sousChefAgent.generate(
      [
        {
          role: "user",
          content: prompt,
        },
      ],
      {
        output: recipeReviewSchema,
      }
    );

    return object;
  },
});

const correctRecipe = createStep({
  id: "correct-recipe",
  description: "Corrects the recipe",
  inputSchema: recipeReviewSchema,
  outputSchema: z.string().describe("The corrected recipe"),
  execute: async ({ inputData: { review, good }, getStepResult }) => {
    const recipe = getStepResult(createMeal);
    const instructions = getStepResult(summarizeInstructions);

    if (good) return recipe;

    const prompt = `
      ${instructions}

      # Recipe you created
      ${recipe}

      # Review of the recipe by the sous chef
      ${review}

      # Instructions
      Correct the recipe based on the review made by your sous chef.
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
  .then(getFamilyEatersInfo)
  .then(summarizeInstructions)
  .then(createMeal)
  .then(reviewRecipe)
  .then(correctRecipe)
  .then(recipeToJson);

mealCreationWorkflow.commit();

export { mealCreationWorkflow };
