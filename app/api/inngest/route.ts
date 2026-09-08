import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { monitorVeoGeneration, submitVeoGenerationJob } from "@/lib/generation-worker";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [submitVeoGenerationJob, monitorVeoGeneration],
});
