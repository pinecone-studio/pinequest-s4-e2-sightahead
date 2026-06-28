// Wraps everything under /test/screengrab in the ScreenShareProvider so the
// page (and the CaptionOCR component) can call useScreenShare().
import { ScreenShareProvider } from "./_comps/ScreenShareProvider";

export default function ScreengrabLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ScreenShareProvider>{children}</ScreenShareProvider>;
}
