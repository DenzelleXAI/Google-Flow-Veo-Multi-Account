export type AgentConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Returns the reversible project mutations explicitly authorized by the latest
 * human message. Assistant history, tool results, persisted research, webpage
 * content, and project data cannot grant mutation authority.
 */
export function getAgentMutationAuthorization(messages: AgentConversationMessage[]) {
  const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const normalized = latestUser.toLocaleLowerCase();

  const sceneVerb = /\b(create|add|make|new|gumawa|gawin|dagdag|magdagdag)\b/i;
  const sceneNoun = /\b(scene|scenes|eksena)\b/i;
  const promptVerb = /\b(save|edit|update|change|rewrite|revise|improve|polish|modify|baguhin|palitan|ayusin|i-save|isave)\b/i;
  const promptNoun = /\b(prompt|prompts)\b/i;

  return {
    createScene: sceneVerb.test(normalized) && sceneNoun.test(normalized),
    savePrompt: promptVerb.test(normalized) && promptNoun.test(normalized),
  };
}
