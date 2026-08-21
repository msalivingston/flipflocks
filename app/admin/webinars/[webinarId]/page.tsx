import { AdminWebinarDetail } from "../../_components/admin-webinar-detail";
export default async function Page({ params }: { params: Promise<{ webinarId: string }> }) { const { webinarId } = await params; return <AdminWebinarDetail webinarId={webinarId} />; }
