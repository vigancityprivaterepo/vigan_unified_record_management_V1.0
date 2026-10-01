import ReactECharts from 'echarts-for-react';
import { paletteSlotForModule, useChartTheme } from '@/lib/chartPalette';
import type { SankeyData } from '@/lib/api';

// Left nodes = each membership category on its own; right nodes = the
// combination it's part of. A single-category bucket gets its own
// "<name> only" right node (so it never collides with the left node of the
// same name, which ECharts' sankey would otherwise treat as one node via a
// self-loop) -- a multi-category bucket instead gets one right node with an
// incoming edge from EVERY category in that combination, each edge weighted
// by the bucket's full count. This is the standard co-membership/alluvial
// convention: a bucket's node width sums its edges, so a 2-category bucket
// reads as 2x its count on the combination side -- correct per-edge ("N
// Seniors are also Farmers"), not a literal population width. Hover shows
// the real count either way.
function buildOption(data: SankeyData, theme: ReturnType<typeof useChartTheme>) {
  const orderedIds = data.modules.map((m) => m.id);
  const nameById = new Map(data.modules.map((m) => [m.id, m.name]));
  const otherColor = theme === 'dark' ? '#6F9C8D' : '#9CA3AF';

  const nodes: Array<{ name: string; itemStyle: { color: string } }> = [];
  const seenNames = new Set<string>();
  function addNode(name: string, color: string) {
    if (seenNames.has(name)) return;
    seenNames.add(name);
    nodes.push({ name, itemStyle: { color } });
  }

  for (const m of data.modules) {
    addNode(m.name, paletteSlotForModule(m.id, orderedIds, theme));
  }

  const links: Array<{ source: string; target: string; value: number; bucketModuleIds: string[]; label: string }> = [];
  for (const bucket of data.buckets) {
    if (bucket.moduleIds.length === 0) {
      // "Other combinations" fold -- no real category to link from.
      addNode(bucket.label, otherColor);
      continue;
    }
    const rightName = bucket.moduleIds.length === 1 ? `${bucket.label} only` : bucket.label;
    const rightColor = bucket.moduleIds.length === 1 ? paletteSlotForModule(bucket.moduleIds[0]!, orderedIds, theme) : otherColor;
    addNode(rightName, rightColor);
    for (const moduleId of bucket.moduleIds) {
      const sourceName = nameById.get(moduleId);
      if (!sourceName) continue;
      links.push({ source: sourceName, target: rightName, value: bucket.count, bucketModuleIds: bucket.moduleIds, label: bucket.label });
    }
  }

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: { dataType: string; data: { source?: string; target?: string; value?: number; label?: string; name?: string } }) => {
        if (params.dataType === 'edge') {
          return `${params.data.source} in "${params.data.label}": ${params.data.value}`;
        }
        return params.data.name ?? '';
      },
    },
    animation: false, // MOTION 1 (DESIGN.md)
    series: [
      {
        type: 'sankey',
        data: nodes,
        links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'source', opacity: 0.35, curveness: 0.5 },
        label: { color: theme === 'dark' ? '#ECFDF5' : '#1B2230', fontSize: 12, fontFamily: 'Source Sans 3, system-ui, sans-serif' },
        nodeWidth: 16,
        nodeGap: 10,
      },
    ],
  };
}

export function CategorySankeyChart({
  data,
  onBucketClick,
}: {
  data: SankeyData;
  onBucketClick: (bucketModuleIds: string[]) => void;
}) {
  const theme = useChartTheme();

  if (data.buckets.length === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--t-muted)', textAlign: 'center', padding: '48px 0' }}>
        No cross-office category data yet -- this fills in once citizens have records under more than one office.
      </p>
    );
  }

  return (
    <ReactECharts
      option={buildOption(data, theme)}
      notMerge={false}
      style={{ height: '100%', width: '100%' }}
      onEvents={{
        click: (params: { dataType: string; data: { bucketModuleIds?: string[] } }) => {
          if (params.dataType === 'edge' && params.data.bucketModuleIds) {
            onBucketClick(params.data.bucketModuleIds);
          }
        },
      }}
    />
  );
}
