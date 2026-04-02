import { ProjectDetailClient } from "@/components/project-detail-client";

export default async function ProjectDetailPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <ProjectDetailClient projectId={projectId} />;
}
