/**
 * The ASASI wordmark (public/brand/asasi-logo.png - black lettering on a
 * transparent background, trimmed to the glyphs).
 *
 * Drawn as a CSS mask over `currentColor` rather than an <img>, so one file
 * takes whatever text colour it sits in: olive on the beige /operations
 * workspace, light on the dark hub. Size it with a height class; the width
 * follows the image's aspect ratio.
 */
const LOGO_URL = "url(/brand/asasi-logo.png)";

export function AsasiLogo({ className = "h-6" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="ASASI"
      className={`inline-block shrink-0 bg-current align-middle ${className}`}
      style={{
        aspectRatio: "355 / 96",
        WebkitMaskImage: LOGO_URL,
        maskImage: LOGO_URL,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "left center",
        maskPosition: "left center",
      }}
    />
  );
}
