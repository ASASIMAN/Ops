import Papa from "papaparse";

export type Confidence = "Strong" | "Directional" | "Anecdote";

export interface Observation {
  sentence: string;
  confidence: Confidence;
  evidence: string[];
}

/**
 * notes.md convention (this app's own, documented here since nothing
 * upstream defines one): a numbered list, one plain sentence per item,
 * an optional "[Confidence]" tag at the end of that line, and zero or
 * more indented "- " evidence lines underneath. Multiple evidence lines
 * are kept separate rather than merged into one sentence - needed for
 * observations that join two different measurements (e.g. weakest
 * content + low Instagram visits), which must not read as one proven
 * causal claim.
 *
 * Example:
 *   1. Shop videos perform best when posted early in the month [Directional]
 *      - best month on record came on the second-lowest spend
 */
const BEST_ADS_HEADING_RE = /^#{1,6}\s*.*(best performing|nominated).*$/i;

/**
 * notes.md can optionally carry a second section (a heading containing
 * "best performing" or "nominated") listing team-picked ad links, used
 * for Block B when there's no ad-links.csv yet. Split it off first so
 * its own numbered list isn't mistaken for content observations.
 */
function splitObservationsFromNominatedAds(notesMd: string): { observationsText: string; nominatedText: string | null } {
  const lines = notesMd.split(/\r?\n/);
  const headingIndex = lines.findIndex((l) => BEST_ADS_HEADING_RE.test(l));
  if (headingIndex === -1) return { observationsText: notesMd, nominatedText: null };
  return {
    observationsText: lines.slice(0, headingIndex).join("\n"),
    nominatedText: lines.slice(headingIndex + 1).join("\n"),
  };
}

export function parseNotesObservations(notesMd: string | null): Observation[] {
  if (!notesMd) return [];
  const { observationsText } = splitObservationsFromNominatedAds(notesMd);
  const lines = observationsText.split(/\r?\n/);
  const observations: Observation[] = [];
  let current: Observation | null = null;

  const itemRe = /^\s*\d+\.\s+(.*)$/;
  const evidenceRe = /^\s*[-*]\s+(.*)$/;
  const confidenceRe = /\s*\[(Strong|Directional|Anecdote)\]\s*$/i;

  for (const rawLine of lines) {
    const itemMatch = rawLine.match(itemRe);
    if (itemMatch) {
      if (current) observations.push(current);
      let sentence = itemMatch[1].trim();
      let confidence: Confidence = "Anecdote"; // default per the honesty rule
      const confMatch = sentence.match(confidenceRe);
      if (confMatch) {
        confidence = (confMatch[1][0].toUpperCase() + confMatch[1].slice(1).toLowerCase()) as Confidence;
        sentence = sentence.replace(confidenceRe, "").trim();
      }
      current = { sentence, confidence, evidence: [] };
      continue;
    }
    const evidenceMatch = rawLine.match(evidenceRe);
    if (evidenceMatch && current) {
      current.evidence.push(evidenceMatch[1].trim());
    }
  }
  if (current) observations.push(current);
  return observations;
}

export type ReviewSectionKey =
  | "campaign_standing"
  | "changes_made"
  | "attribution"
  | "creative_test"
  | "open_questions";

const SECTION_MATCHERS: Record<ReviewSectionKey, string[]> = {
  campaign_standing: ["campaign standing", "standing"],
  changes_made: ["changes made", "changes"],
  attribution: ["attribution"],
  creative_test: ["creative test"],
  open_questions: ["open question"],
};

/** Pulls review.md sections by heading text, matching loosely since exact wording can drift. */
export function parseReviewSections(reviewMd: string | null): Record<ReviewSectionKey, string | null> {
  const result: Record<ReviewSectionKey, string | null> = {
    campaign_standing: null,
    changes_made: null,
    attribution: null,
    creative_test: null,
    open_questions: null,
  };
  if (!reviewMd) return result;

  const lines = reviewMd.split(/\r?\n/);
  const headingRe = /^(#{1,6})\s+(.*)$/;

  let currentKey: ReviewSectionKey | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentKey && buffer.length) {
      const text = buffer.join("\n").trim();
      result[currentKey] = text || null;
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(headingRe);
    if (headingMatch) {
      flush();
      const headingText = headingMatch[2].trim().toLowerCase();
      currentKey =
        (Object.entries(SECTION_MATCHERS).find(([, keywords]) =>
          keywords.some((k) => headingText.includes(k)),
        )?.[0] as ReviewSectionKey | undefined) ?? null;
      continue;
    }
    if (currentKey) buffer.push(line);
  }
  flush();

  return result;
}

export interface TestBrief {
  text: string;
  owner: string | null;
  due: string | null;
  source: "creative_test" | "open_questions";
}

const OWNER_RE = /owner:\s*([^,;—-]+)/i;
const DUE_RE = /(?:due|by):?\s*([^,;]+)/i;

function toTestBriefs(sectionText: string | null, source: TestBrief["source"]): TestBrief[] {
  if (!sectionText) return [];
  const bulletRe = /^\s*[-*]\s+(.*)$/;
  const briefs: TestBrief[] = [];
  for (const line of sectionText.split(/\r?\n/)) {
    const m = line.match(bulletRe);
    if (!m) continue;
    const raw = m[1].trim();
    const ownerMatch = raw.match(OWNER_RE);
    const dueMatch = raw.match(DUE_RE);
    briefs.push({
      text: raw,
      owner: ownerMatch ? ownerMatch[1].trim() : null,
      due: dueMatch ? dueMatch[1].trim() : null,
      source,
    });
  }
  return briefs;
}

/** Block C: experiments to run, pulled from the review doc's creative-test and open-questions sections. */
export function parseTestBriefs(reviewMd: string | null): TestBrief[] {
  const sections = parseReviewSections(reviewMd);
  return [
    ...toTestBriefs(sections.creative_test, "creative_test"),
    ...toTestBriefs(sections.open_questions, "open_questions"),
  ];
}

export interface NominatedAd {
  permalink: string;
  note: string | null;
}

/** Block B fallback source when there's no ad-links.csv: a numbered list of links the team picked by hand. */
export function parseNominatedAds(notesMd: string | null): NominatedAd[] {
  if (!notesMd) return [];
  const { nominatedText } = splitObservationsFromNominatedAds(notesMd);
  if (!nominatedText) return [];
  const itemRe = /^\s*\d+\.\s*(\S+)\s*(?:[—-]\s*(.*))?$/;
  const ads: NominatedAd[] = [];
  for (const line of nominatedText.split(/\r?\n/)) {
    const m = line.match(itemRe);
    if (m) ads.push({ permalink: m[1].trim(), note: m[2]?.trim() || null });
  }
  return ads;
}

export interface AdLink {
  adName: string;
  permalink: string;
}

/** ad-links.csv: two columns, ad_name and permalink - the only bridge from CSV ad names to real Instagram URLs. */
export function parseAdLinksCsv(csvText: string): AdLink[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const links: AdLink[] = [];
  for (const row of parsed.data) {
    const adName = (row.ad_name ?? row["Ad name"] ?? "").trim();
    const permalink = (row.permalink ?? row["Permalink"] ?? "").trim();
    if (adName && permalink) links.push({ adName, permalink });
  }
  return links;
}
