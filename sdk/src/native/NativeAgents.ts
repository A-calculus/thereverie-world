import type { SomniaAgentKit } from "../agentkit/SomniaAgentKit.js";

export class NativeLlmAgent {
  constructor(private kit: SomniaAgentKit) {}

  execute(options: unknown) {
    return this.kit.executeLLM(options);
  }
}

export class NativeJsonApiAgent {
  constructor(private kit: SomniaAgentKit) {}

  execute(options: unknown) {
    return this.kit.executeJsonApi(options);
  }
}

export class NativeWebParseAgent {
  constructor(private kit: SomniaAgentKit) {}

  execute(options: unknown) {
    return this.kit.executeWebParse(options);
  }
}

export class NativeAgents {
  readonly llm: NativeLlmAgent;
  readonly jsonApi: NativeJsonApiAgent;
  readonly webParse: NativeWebParseAgent;

  constructor(kit: SomniaAgentKit) {
    this.llm = new NativeLlmAgent(kit);
    this.jsonApi = new NativeJsonApiAgent(kit);
    this.webParse = new NativeWebParseAgent(kit);
  }
}
