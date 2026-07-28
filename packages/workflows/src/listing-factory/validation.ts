import { type ListingProperty, type ListingScript } from "./types";

/**
 * Deterministic content checks that run on every script — generated or
 * user-edited — before render. Two classes:
 *
 *  - fair-housing: language expressing who should live in the property or
 *    describing people/neighborhood demographics instead of the property.
 *  - unsupported-claim: statements the supplied listing facts don't back up.
 *
 * These are warnings surfaced to the user (who remains the editor of
 * record), never silent rewrites.
 */

export interface ContentWarning {
  kind: "fair-housing" | "unsupported-claim";
  /** Scene index, or -1 for hook/outro/cta. */
  sceneIndex: number;
  matched: string;
  message: string;
}

interface PhraseRule {
  pattern: RegExp;
  message: string;
}

/** Buyer-focused / protected-class phrasing (HUD advertising guidance). */
const FAIR_HOUSING_RULES: PhraseRule[] = [
  {
    pattern:
      /\b(perfect|ideal|great|suited|designed)\s+for\s+(young\s+)?(famil(y|ies)|couples?|singles?|professionals?|students?|retirees?|seniors?|christians?|adults?|kids|children|bachelors?|newlyweds?)\b/i,
    message: "Describes who should live here — describe the property instead.",
  },
  {
    pattern:
      /\b(family|couple|single|professional|student|retiree|senior)[- ]?(friendly|oriented)\b/i,
    message: "Buyer-profile phrasing — prefer property features (e.g. “flexible bedroom layout”).",
  },
  {
    pattern:
      /\b(christian|jewish|muslim|catholic|hindu|buddhist|religious)\s+(neighborhood|community|area)\b/i,
    message: "References religion — protected class under the Fair Housing Act.",
  },
  {
    pattern:
      /\b(ethnic|hispanic|latino|asian|black|white|integrated)\s+(neighborhood|community|area)\b/i,
    message: "References race or national origin — protected class.",
  },
  {
    pattern:
      /\bsafe\s+(neighborhood|area|community|street)|\bsafe\s+for\s+(kids|children|families)\b/i,
    message: "Safety claims imply demographics and can’t be substantiated — remove.",
  },
  {
    pattern: /\bexclusive\s+(community|neighborhood|enclave|area)\b/i,
    message: "“Exclusive” community phrasing can imply exclusion — describe amenities instead.",
  },
  {
    pattern: /\bno\s+(kids|children|section\s*8)\b/i,
    message: "Excludes protected groups — not permitted in advertising.",
  },
  {
    pattern: /\b(able[- ]bodied|no\s+wheelchairs?)\b/i,
    message: "References disability — protected class.",
  },
];

/** Claims that need explicit support in the supplied facts. `supported`
 *  decides whether the property data backs the phrase up. */
interface ClaimRule extends PhraseRule {
  supported?: (property: ListingProperty, fullText: string) => boolean;
}

const factsBlob = (p: ListingProperty): string =>
  [p.description, p.neighborhood, p.callToAction].join(" ").toLowerCase();

const CLAIM_RULES: ClaimRule[] = [
  {
    pattern: /\b(best|top[- ]rated|award[- ]winning)\s+school/i,
    message: "School-quality claims are unsupported and touch fair-housing steering — remove.",
  },
  {
    pattern: /\b(guaranteed|can'?t[- ]miss|no[- ]risk)\s+(investment|return|appreciation)\b/i,
    message: "Investment guarantees can’t be made in listing marketing.",
  },
  {
    pattern: /\bup[- ]and[- ]coming\s+(neighborhood|area)\b/i,
    message: "Speculative neighborhood claims are unsupported — describe what’s actually nearby.",
  },
  {
    pattern: /\bwalking\s+distance\b/i,
    message: "“Walking distance” needs support in the listing details you provided.",
    supported: (p) => /walk(ing|able)?[- ]?(distance|score)?/i.test(factsBlob(p)),
  },
  {
    pattern: /\b(newly|recently|fully|just)\s+(renovated|remodeled|updated|rebuilt)\b/i,
    message: "Renovation claims need confirmation in the listing details you provided.",
    supported: (p) =>
      /(renovat|remodel|updated|rebuil|new\s+(kitchen|bath|roof|floor))/i.test(factsBlob(p)),
  },
  {
    pattern: /\b\d{2,4}(\.\d+)?\s*(sq\.?\s?(ft|feet)|square\s+feet)\b/i,
    message: "Square footage appears in the script but wasn’t provided in the property facts.",
    supported: (p) => Boolean(p.sqft && p.sqft.trim()),
  },
  {
    pattern: /\bocean|lake|mountain|skyline|city\s+view/i,
    message: "View claims need support in the listing details you provided.",
    supported: (p) => /view|ocean|lake|mountain|skyline|waterfront/i.test(factsBlob(p)),
  },
];

function checkText(text: string, sceneIndex: number, property: ListingProperty): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  if (!text) return warnings;
  for (const rule of FAIR_HOUSING_RULES) {
    const m = text.match(rule.pattern);
    if (m) {
      warnings.push({ kind: "fair-housing", sceneIndex, matched: m[0], message: rule.message });
    }
  }
  for (const rule of CLAIM_RULES) {
    const m = text.match(rule.pattern);
    if (m && !(rule.supported?.(property, text) ?? false)) {
      warnings.push({
        kind: "unsupported-claim",
        sceneIndex,
        matched: m[0],
        message: rule.message,
      });
    }
  }
  return warnings;
}

/** Validate a whole script against the property facts. */
export function validateScript(script: ListingScript, property: ListingProperty): ContentWarning[] {
  const warnings: ContentWarning[] = [
    ...checkText(script.hook, -1, property),
    ...checkText(script.outro, -1, property),
    ...checkText(script.cta, -1, property),
  ];
  script.scenes.forEach((scene, i) => {
    warnings.push(...checkText(`${scene.narration} ${scene.caption}`, i, property));
  });
  return warnings;
}
