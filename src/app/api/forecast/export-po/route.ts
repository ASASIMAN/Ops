import { NextRequest, NextResponse } from "next/server";

/**
 * Exports the PO planning grid as CSV, in the same style/colour/size/qty/
 * CMT-price layout as the source PO sheet (see po_lines_clean.csv) -
 * whatever the user has in the form when they submit, including any
 * manual edits to a suggested qty or price, since the brief asks for an
 * editable grid that exports what's actually on screen, not a
 * recomputed server-side value that could silently differ from it.
 *
 * Not .xlsx: same reasoning as the lead-time estimates importer (see
 * README "Lead times") - the only npm .xlsx writer/parser pulls in the
 * same package with unpatched high-severity CVEs. CSV opens directly in
 * Excel.
 */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const styleName = String(formData.get("styleName") ?? "");
  const rowCount = Number(formData.get("rowCount") ?? 0);

  const header = ["Style", "Colour", "Size", "Qty", "CMT price (IDR)"];
  const lines = [header.map(csvField).join(",")];

  for (let i = 0; i < rowCount; i++) {
    const color = String(formData.get(`color_${i}`) ?? "");
    const size = String(formData.get(`size_${i}`) ?? "");
    const qty = String(formData.get(`qty_${i}`) ?? "");
    const cmt = String(formData.get(`cmt_${i}`) ?? "");
    lines.push([styleName, color, size, qty, cmt].map(csvField).join(","));
  }

  const csv = lines.join("\n") + "\n";
  const safeStyleName = styleName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "po";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="po-${safeStyleName}.csv"`,
    },
  });
}
