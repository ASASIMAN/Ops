import { executeKw, searchRead } from "./rpc";

// NOTE: field names below match standard Odoo POS (v16/17). If your instance
// customizes the POS or product model, these may need adjusting - that's
// expected and is exactly the kind of thing to verify once real credentials
// are wired up (see README "Odoo field verification").

export interface OdooStore {
  id: number;
  name: string;
}

export async function fetchStores(): Promise<OdooStore[]> {
  return searchRead<OdooStore>("pos.config", [], ["id", "name"]);
}

export interface OdooCategory {
  id: number;
  name: string;
  parent_id: [number, string] | false;
}

export async function fetchCategories(): Promise<OdooCategory[]> {
  return searchRead<OdooCategory>("product.category", [], [
    "id",
    "name",
    "parent_id",
  ]);
}

export interface OdooProductVariant {
  id: number;
  product_tmpl_id: [number, string];
  name: string;
  default_code: string | false;
  list_price: number;
  categ_id: [number, string] | false;
  product_template_attribute_value_ids: number[];
}

interface AttributeValue {
  id: number;
  name: string;
  attribute_id: [number, string];
}

/**
 * Fetches product variants and resolves their Color/Size attribute values.
 * Odoo models color/size as product attributes rather than flat fields, so
 * this does a second call to resolve the attribute value ids collected on
 * each variant, then matches them against attribute names "Color"/"Size"
 * (case-insensitive). Adjust the match if your instance names them
 * differently (e.g. "Colour").
 */
export async function fetchProducts() {
  const variants = await searchRead<OdooProductVariant>(
    "product.product",
    [],
    [
      "id",
      "product_tmpl_id",
      "name",
      "default_code",
      "list_price",
      "categ_id",
      "product_template_attribute_value_ids",
    ],
  );

  const attributeValueIds = Array.from(
    new Set(variants.flatMap((v) => v.product_template_attribute_value_ids)),
  );

  const attributeValues = attributeValueIds.length
    ? await executeKw<AttributeValue[]>(
        "product.template.attribute.value",
        "read",
        [attributeValueIds],
        { fields: ["id", "name", "attribute_id"] },
      )
    : [];

  const valueById = new Map(attributeValues.map((v) => [v.id, v]));

  return variants.map((variant) => {
    let color: string | null = null;
    let size: string | null = null;

    for (const valueId of variant.product_template_attribute_value_ids) {
      const value = valueById.get(valueId);
      if (!value) continue;
      const attributeName = value.attribute_id[1]?.toLowerCase() ?? "";
      if (attributeName === "color" || attributeName === "colour") {
        color = value.name;
      } else if (attributeName === "size") {
        size = value.name;
      }
    }

    return {
      odooProductId: variant.id,
      odooTemplateId: variant.product_tmpl_id[0],
      name: variant.name,
      sku: variant.default_code || null,
      listPrice: variant.list_price,
      categoryOdooId: variant.categ_id ? variant.categ_id[0] : null,
      color,
      size,
    };
  });
}

export interface OdooPosSession {
  id: number;
  config_id: [number, string];
}

export interface OdooPosOrder {
  id: number;
  name: string;
  date_order: string;
  session_id: [number, string];
  amount_total: number;
  state: string;
}

/** Orders in [dateFromIso, dateToIso). Odoo datetimes are UTC. */
export async function fetchOrders(dateFromIso: string, dateToIso: string) {
  const orders = await searchRead<OdooPosOrder>(
    "pos.order",
    [
      ["date_order", ">=", dateFromIso],
      ["date_order", "<", dateToIso],
    ],
    ["id", "name", "date_order", "session_id", "amount_total", "state"],
  );

  const sessionIds = Array.from(
    new Set(orders.map((o) => o.session_id[0])),
  );

  const sessions = sessionIds.length
    ? await executeKw<OdooPosSession[]>("pos.session", "read", [sessionIds], {
        fields: ["id", "config_id"],
      })
    : [];

  const configIdBySession = new Map(
    sessions.map((s) => [s.id, s.config_id[0]]),
  );

  return orders.map((order) => ({
    odooOrderId: order.id,
    posReference: order.name,
    orderDate: order.date_order,
    storeOdooId: configIdBySession.get(order.session_id[0]) ?? null,
    totalAmount: order.amount_total,
    state: order.state,
  }));
}

export interface OdooPosOrderLine {
  id: number;
  order_id: [number, string];
  product_id: [number, string];
  qty: number;
  price_unit: number;
  discount: number;
  price_subtotal: number;
}

export async function fetchOrderLines(orderIds: number[]) {
  if (!orderIds.length) return [];

  const lines = await searchRead<OdooPosOrderLine>(
    "pos.order.line",
    [["order_id", "in", orderIds]],
    [
      "id",
      "order_id",
      "product_id",
      "qty",
      "price_unit",
      "discount",
      "price_subtotal",
    ],
  );

  return lines.map((line) => ({
    odooLineId: line.id,
    odooOrderId: line.order_id[0],
    odooProductId: line.product_id[0],
    qty: line.qty,
    unitPrice: line.price_unit,
    discountPercent: line.discount,
    subtotal: line.price_subtotal,
  }));
}
