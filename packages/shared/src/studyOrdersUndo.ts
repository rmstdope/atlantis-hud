/**
 * What Undo on the study planner's Orders tab may take back, and every word it says about it
 * (ah-n3j1q).
 *
 * Pure, for the reason `studyOrdersWrite.ts` is: `packages/shared` has no jsdom by decision
 * (ah-nass), so the rule and the sentences live here and the dialog draws what this returned.
 *
 * Undo answers for mages rather than for the document: anything an assistant or the player wrote
 * after the study write stays, and a mage whose orders moved at all is left as he is and named.
 */

import {
  readUnitOrders,
  regionBanners,
  withoutUnitBlock,
  writeUnitOrders
} from "./ordersDocument";
import type { OrderCommentSyntax } from "./rulesets";
import type { StudyWritePlan } from "./studyOrdersWrite";

/** One mage the write changed: what his orders were, and exactly what it left them. */
type WrittenMage = {
  unitId: string;
  /** `Ereb (1234)`, as the confirmation named him. */
  who: string;
  /** His orders before the write, or null when the write made his block. */
  had: string | null;
  wrote: string;
};

/** What Undo needs to know about one "Put into my orders". */
export type StudyWrite = {
  before: string;
  after: string;
  /** Region banners this write added to the document. */
  banners: string[];
  mages: WrittenMage[];
};

/** The document's line about the write while Undo may still be pressed. */
export type StudyWriteStanding = {
  undoable: boolean;
  /** The second sentence under the result line, or null when nothing has changed. */
  detail: string | null;
};

/** `a`, `a and b`, `a, b and c`. */
function namesInASentence(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

function magesCount(count: number): string {
  return `${count} mage${count === 1 ? "" : "s"}`;
}

/** Takes the record at the moment of writing, from the same plan the write committed. */
export function recordStudyWrite(input: {
  before: string;
  plan: StudyWritePlan;
  syntax: OrderCommentSyntax;
}): StudyWrite {
  const { before, plan, syntax } = input;
  const after = plan.next;
  // The same rows `studyWritePlan` counts into `changed`, so every count here agrees with the
  // "Wrote study orders for N mages" the player has just read.
  const mages = plan.rows
    .filter((row) => row.writes || row.cast?.writes === true)
    .map((row) => ({
      unitId: row.unitId,
      who: row.who,
      had: readUnitOrders(before, row.unitId, undefined, syntax),
      wrote: readUnitOrders(after, row.unitId, undefined, syntax) ?? ""
    }));
  const had = new Set(regionBanners(before));
  return { before, after, banners: regionBanners(after).filter((banner) => !had.has(banner)), mages };
}

/** Whether a mage still holds exactly what the write left him: all of it, byte for byte. */
function isUntouched(mage: WrittenMage, current: string, syntax: OrderCommentSyntax): boolean {
  return readUnitOrders(current, mage.unitId, undefined, syntax) === mage.wrote;
}

export function studyWriteStanding(
  write: StudyWrite,
  current: string,
  syntax: OrderCommentSyntax
): StudyWriteStanding {
  if (current === write.after) {
    return { undoable: true, detail: null };
  }
  const left = write.mages.filter((mage) => !isUntouched(mage, current, syntax));
  if (left.length === write.mages.length) {
    const who = left.length === 1 ? "1 mage has" : `All ${left.length} mages have`;
    return { undoable: false, detail: `${who} changed since, so there is nothing left to undo.` };
  }
  if (left.length === 0) {
    return { undoable: true, detail: "Your orders have changed since. Undo takes back only these mages." };
  }
  const names = namesInASentence(left.map((mage) => mage.who));
  return {
    undoable: true,
    detail:
      left.length === 1
        ? `${names} has changed since, so Undo will leave him as he is.`
        : `${names} have changed since, so Undo will leave them as they are.`
  };
}

/**
 * The document and the line after pressing Undo against `current`, or null when no mage is left to
 * take back - which writes nothing, rather than reporting having taken back no one.
 */
export function takeBackStudyWrite(
  write: StudyWrite,
  current: string,
  syntax: OrderCommentSyntax
): { next: string; text: string } | null {
  if (current === write.after) {
    return { next: write.before, text: "Put your orders back as they were." };
  }
  const taken = write.mages.filter((mage) => isUntouched(mage, current, syntax));
  if (taken.length === 0) {
    return null;
  }
  const next = taken.reduce(
    (document, mage) =>
      mage.had === null
        ? withoutUnitBlock(document, mage.unitId, write.banners, syntax)
        : writeUnitOrders(document, mage.unitId, mage.had, undefined, syntax),
    current
  );
  const tookBack = `Took back the study orders for ${magesCount(taken.length)}.`;
  const left = write.mages.filter((mage) => !taken.includes(mage));
  if (left.length === 0) {
    return { next, text: `${tookBack} Your later changes are still there.` };
  }
  const names = namesInASentence(left.map((mage) => mage.who));
  return {
    next,
    text:
      left.length === 1
        ? `${tookBack} Left ${names} as he is: his orders changed after the write.`
        : `${tookBack} Left ${names} as they are: their orders changed after the write.`
  };
}
