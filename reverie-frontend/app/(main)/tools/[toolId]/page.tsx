import { ToolEditor } from '@/components/tools/tool-editor';

interface Props {
  params: Promise<{ toolId: string }>;
}

export default async function EditToolPage({ params }: Props) {
  const { toolId } = await params;
  return <ToolEditor key={toolId} toolId={toolId} />;
}
