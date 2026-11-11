import QRCode from "qrcode";

export function qrSvg(text: string, opts?: { margin?: number }): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: opts?.margin ?? 1,
    color: { dark: "#111111", light: "#ffffff" },
  });
}
