// The prompt builder lives in shared/ so the server's phone call uses the same per-candidate script.
export {
  buildAssistantOverrides,
  buildFirstMessage,
  experienceText,
  firstNameOf,
  missingResumeFields,
  type AssistantOverrides,
} from "../../shared/agentPrompt";
