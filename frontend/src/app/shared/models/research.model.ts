export interface Node {
  id: string;
  label?: string;
  type: 'source' | 'fact' | 'question' | 'subquestion';
  iteration?: number;
}

export interface Edge {
  id?: string;
  label?: string;
  from: string;
  to: string;
}

export interface KnowledgeGraph {
  nodes: Node[];
  edges: Edge[];
}

export interface EvidenceSupportMatrix {
  sources: { id: string; label: string }[];
  facts: { id: string; label: string; sourceId: string }[];
  scores: number[][];
}

export interface ProgressUpdate {
  researchId: string;
  message: string;
  isComplete: boolean;
  finalReport?: string;
  knowledgeGraph?: KnowledgeGraph;
}
