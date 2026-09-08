import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { runVeoGeneration } from "@/lib/generation-worker";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runVeoGeneration],
});
