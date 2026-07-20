import { AdminPageHeader } from "../_components/admin-ui";
import { PlatformSettingsManager } from "../_components/platform-settings-manager";

export default function AdminSettingsPage() {
  return (
    <>
      <AdminPageHeader
        eyebrow="Settings"
        title="Platform Settings"
        description="Global controls for public FlockFront behavior."
      />
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <PlatformSettingsManager />
      </div>
    </>
  );
}
