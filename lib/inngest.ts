import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "persistent-ai-video-studio",
  checkpointing: {
    maxRuntime: "210s",
  },
});
