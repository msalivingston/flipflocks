import { HatchingEggsStandaloneOnePageForm } from "../../hatching-eggs-standalone/hatching-eggs-standalone-one-page-form";

type HatchingEggsEditPageProps = {
  params: Promise<{
    hatchingEggItemId: string;
  }>;
};

export default async function HatchingEggsEditPage({
  params,
}: HatchingEggsEditPageProps) {
  const { hatchingEggItemId } = await params;

  return (
    <HatchingEggsStandaloneOnePageForm
      hatchingEggItemId={hatchingEggItemId}
      mode="edit"
    />
  );
}
