import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { monitorVeoGeneration, submitVeoGenerationJob } from "@/lib/generation-worker";
import { cleanupVerifiedRelayObjects } from "@/lib/relay-cleanup";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [submitVeoGenerationJob, monitorVeoGeneration, cleanupVerifiedRelayObjects],
});
