/**
 * Shapes shared by every stage. A stage is a pure function of these types — see
 * docs/adr/0006-agents-communicate-through-artifacts.md. No stage type carries a
 * conversation transcript; each carries only what the next stage is allowed to see.
 */

export interface ChangeRequest {
  apiVersion: "factory/v1";
  kind: "ChangeRequest";
  metadata: {
    title: string;
    requestedBy: string;
    ticket?: string;
    labels?: string[];
  };
  spec: {
    goal: string;
    inScope: string[];
    outOfScope?: string[];
    acceptanceCriteria: Array<{ id: string; given: string; when: string; then: string }>;
    constraints?: string[];
    targetBranch: string;
    branchPrefix: string;
    testCommands: { unit: string; functional?: string; lint?: string; setup?: string };
    definitionOfDone: string[];
    budget?: { maxUsd: number; maxDurationHours: number; onExceed: "park" | "abort" };
    gates?: { prePush: boolean; approvers?: string[]; expiryDays: number };
    models?: Record<string, { provider: "bedrock" | "anthropic" | "openai" | "google"; model: string }>;
  };
}

export interface RunRef {
  runId: string;
  revision: string;
  repo: { owner: string; name: string };
}

export interface IntakeArtifact {
  request: ChangeRequest;
  repo: { owner: string; name: string };
  validatedAt: string;
}

export interface RepoFactsArtifact {
  /** Everything below is repo-derived and therefore untrusted — see docs/02 §11. */
  provenance: "untrusted-repo-content";
  languages: string[];
  frameworks: string[];
  manifestFiles: string[];
  suggestedTestCommand: string | null;
  moduleMap: string[];
  notes: string[];
}

export interface OpenQuestion {
  id: string;
  question: string;
}

export interface AnswerToQuestion {
  id: string;
  answer: string;
}

export interface RequirementsArtifact {
  stories: string[];
  acceptanceCriteria: Array<{ id: string; given: string; when: string; then: string }>;
  nonFunctionalRequirements: string[];
  openQuestions: OpenQuestion[];
  markdown: string;
}

export interface GateDecision {
  decision: "approve" | "revise";
  note?: string;
  answers?: AnswerToQuestion[];
  decidedBy: string;
  decidedAt: string;
}

export interface PublisherResult {
  branch: string;
  prNumber: number;
  prUrl: string;
}

export type StageName = "intake" | "recon" | "analyst" | "gateA" | "publisher";

export interface StageContext {
  run: RunRef;
}
