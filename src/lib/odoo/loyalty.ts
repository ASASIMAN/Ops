import { executeKw, searchRead } from "./rpc";

// Odoo POS loyalty. From Odoo 16 the `loyalty` module keeps each customer's
// points on a loyalty.card (one per customer per programme). Odoo 15 and
// earlier kept a single `loyalty_points` number on the customer instead.
// Which one this instance has is detected at run time, since the version
// isn't recorded anywhere - see readLoyalty() below.

export interface LoyaltyProgram {
  id: number;
  name: string;
  pointName: string | null;
}

export interface LoyaltyCard {
  /** Odoo's loyalty.card id (Odoo 16+), or -partner id for an Odoo 15 balance. */
  id: number;
  partnerId: number;
  programId: number | null;
  code: string | null;
  points: number;
  expirationDate: string | null;
}

export interface OdooCustomer {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
}

const PAGE = 2000;
const READ_BATCH = 500;

type Many2one = [number, string] | false;

/** Which of `wanted` the model actually has - field sets differ between Odoo versions. */
async function existingFields(model: string, wanted: string[]): Promise<Set<string>> {
  const fields = await executeKw<Record<string, unknown>>(model, "fields_get", [wanted], { attributes: ["type"] });
  return new Set(Object.keys(fields).filter((f) => wanted.includes(f)));
}

async function searchReadAll<T>(model: string, domain: unknown[], fields: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await searchRead<T>(model, domain, fields, { limit: PAGE, offset, order: "id asc" });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

function isMissingModel(error: unknown, model: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(model) && /doesn't exist|does not exist|KeyError|not found/i.test(message);
}

/** Reads every customer's loyalty balance, whichever loyalty model this Odoo has. */
export async function readLoyalty(): Promise<{
  programs: LoyaltyProgram[];
  cards: LoyaltyCard[];
  model: "loyalty.card" | "res.partner.loyalty_points";
}> {
  try {
    const programFields = await existingFields("loyalty.program", ["name", "program_type", "portal_point_name"]);
    // Only point-collecting programmes: Odoo keeps coupons, gift cards,
    // eWallets and promo codes in the same models, and those aren't member points.
    const domain = programFields.has("program_type") ? [["program_type", "=", "loyalty"]] : [];
    const programs = await searchReadAll<{ id: number; name: string; portal_point_name?: string | false }>(
      "loyalty.program",
      domain,
      ["id", "name", ...(programFields.has("portal_point_name") ? ["portal_point_name"] : [])],
    );
    if (!programs.length) return { programs: [], cards: [], model: "loyalty.card" };

    const cardFields = await existingFields("loyalty.card", ["code", "expiration_date"]);
    const cards = await searchReadAll<{
      id: number;
      partner_id: Many2one;
      program_id: Many2one;
      points: number;
      code?: string | false;
      expiration_date?: string | false;
    }>(
      "loyalty.card",
      [
        ["program_id", "in", programs.map((p) => p.id)],
        ["partner_id", "!=", false],
      ],
      ["id", "partner_id", "program_id", "points", ...cardFields],
    );

    return {
      model: "loyalty.card",
      programs: programs.map((p) => ({ id: p.id, name: p.name, pointName: p.portal_point_name || null })),
      cards: cards
        .filter((c) => c.partner_id)
        .map((c) => ({
          id: c.id,
          partnerId: (c.partner_id as [number, string])[0],
          programId: c.program_id ? c.program_id[0] : null,
          code: c.code || null,
          points: Number(c.points) || 0,
          expirationDate: c.expiration_date || null,
        })),
    };
  } catch (error) {
    if (!isMissingModel(error, "loyalty.program")) throw error;
  }

  // Odoo 15 and earlier: one balance per customer on res.partner.
  const partnerFields = await existingFields("res.partner", ["loyalty_points"]);
  if (!partnerFields.has("loyalty_points")) {
    throw new Error(
      "This Odoo has no POS loyalty data: neither loyalty.program (Odoo 16+) nor res.partner.loyalty_points (Odoo 15) exists. Is the Point of Sale loyalty module installed?",
    );
  }
  const partners = await searchReadAll<{ id: number; loyalty_points: number }>(
    "res.partner",
    [["loyalty_points", "!=", 0]],
    ["id", "loyalty_points"],
  );
  return {
    model: "res.partner.loyalty_points",
    programs: [{ id: 0, name: "POS loyalty", pointName: null }],
    cards: partners.map((p) => ({
      id: -p.id,
      partnerId: p.id,
      programId: 0,
      code: null,
      points: Number(p.loyalty_points) || 0,
      expirationDate: null,
    })),
  };
}

/** Name and contact details for the given customers (archived ones included - they can still hold points). */
export async function readCustomers(partnerIds: number[]): Promise<OdooCustomer[]> {
  if (!partnerIds.length) return [];
  const fields = await existingFields("res.partner", ["name", "email", "phone", "mobile"]);
  const out: OdooCustomer[] = [];
  for (let i = 0; i < partnerIds.length; i += READ_BATCH) {
    const rows = await executeKw<
      { id: number; name: string | false; email?: string | false; phone?: string | false; mobile?: string | false }[]
    >("res.partner", "read", [partnerIds.slice(i, i + READ_BATCH)], {
      fields: ["id", ...fields],
      context: { active_test: false },
    });
    for (const r of rows) {
      out.push({
        id: r.id,
        name: (r.name || "").trim() || `Odoo customer #${r.id}`,
        email: (r.email || "").trim() || null,
        // A mobile is the number customers give at the till; fall back to the landline field.
        phone: (r.mobile || "").trim() || (r.phone || "").trim() || null,
      });
    }
  }
  return out;
}

/** Every POS order that had a customer attached: [odoo order id, odoo partner id]. */
export async function readOrderCustomers(): Promise<[number, number][]> {
  const rows = await searchReadAll<{ id: number; partner_id: Many2one }>(
    "pos.order",
    [["partner_id", "!=", false]],
    ["id", "partner_id"],
  );
  return rows.filter((r) => r.partner_id).map((r) => [r.id, (r.partner_id as [number, string])[0]]);
}
