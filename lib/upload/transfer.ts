import type { BatchFileOutcome } from "@/lib/upload/batch";

export type MintResult = { ok: true; path: string; token: string } | { ok: false; status: number };
export type ClaimResponse = { status: number; body: unknown };
export interface TransferDeps {
  fileName: string;
  mint(): Promise<MintResult>;
  put(path: string, token: string): Promise<boolean>;
  claim(path: string): Promise<ClaimResponse>;
  onStage?(stage: "uploading" | "checking"): void;
}

// RED stub: replaced by the real implementation in the GREEN commit.
export async function uploadViaStorage(deps: TransferDeps): Promise<BatchFileOutcome> {
  return { fileName: deps.fileName, kind: "skipped", message: "stub" };
}
