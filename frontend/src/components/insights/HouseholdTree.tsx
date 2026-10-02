import ReactECharts from 'echarts-for-react';
import { paletteSlotForModule, useChartTheme } from '@/lib/chartPalette';
import type { HouseholdDetail, HouseholdMember, PersonCategory } from '@/lib/api';

type TreeNode = {
  name: string;
  itemStyle: { color: string };
  categories: PersonCategory[];
  children?: TreeNode[];
};

function categoryTagString(categories: PersonCategory[]): string {
  return categories.length > 0 ? categories.map((c) => c.moduleName).join(', ') : 'No office record';
}

function memberNode(
  member: Pick<HouseholdMember, 'personLname' | 'personFname' | 'personRelationToHead' | 'categories'>,
  orderedModuleIds: string[],
  theme: 'light' | 'dark',
): TreeNode {
  const primaryCategory = member.categories[0];
  const color = primaryCategory ? paletteSlotForModule(primaryCategory.moduleId, orderedModuleIds, theme) : 'var(--t-light)';
  const relation = member.personRelationToHead ? ` (${member.personRelationToHead})` : '';
  return {
    name: `${member.personFname} ${member.personLname}${relation}`,
    itemStyle: { color },
    categories: member.categories,
  };
}

// Flat members list (personParentKey === head, some additionally pointing
// at personSubParentKey for a nested grouping, e.g. a grandchild under
// their own parent) -> ECharts tree hierarchy. See adminDashboard.ts's
// /admin/households/:headPersonKey for the exact shape this consumes.
function buildTree(detail: HouseholdDetail, orderedModuleIds: string[], theme: 'light' | 'dark'): TreeNode {
  const root = memberNode(detail.head, orderedModuleIds, theme);
  const nodeByPersonKey = new Map<string, TreeNode>();
  const directChildren: TreeNode[] = [];

  for (const member of detail.members) {
    const node = memberNode(member, orderedModuleIds, theme);
    nodeByPersonKey.set(member.personKey, node);
  }

  for (const member of detail.members) {
    const node = nodeByPersonKey.get(member.personKey)!;
    if (member.personSubParentKey && nodeByPersonKey.has(member.personSubParentKey)) {
      const parent = nodeByPersonKey.get(member.personSubParentKey)!;
      parent.children = [...(parent.children ?? []), node];
    } else {
      directChildren.push(node);
    }
  }

  root.children = directChildren;
  return root;
}

export function HouseholdTree({ detail, orderedModuleIds }: { detail: HouseholdDetail; orderedModuleIds: string[] }) {
  const theme = useChartTheme();
  const tree = buildTree(detail, orderedModuleIds, theme);

  const option = {
    tooltip: {
      formatter: (params: { data: TreeNode }) => `${params.data.name}<br/>${categoryTagString(params.data.categories)}`,
    },
    series: [
      {
        type: 'tree',
        data: [tree],
        top: '5%',
        left: '10%',
        bottom: '5%',
        right: '20%',
        symbolSize: 12,
        orient: 'LR',
        label: { position: 'left', verticalAlign: 'middle', align: 'right', fontSize: 12, color: theme === 'dark' ? '#ECFDF5' : '#1B2230' },
        leaves: { label: { position: 'right', verticalAlign: 'middle', align: 'left' } },
        lineStyle: { color: theme === 'dark' ? '#2B5A4E' : '#D9DCE1' },
        expandAndCollapse: false,
        animation: false, // MOTION 1 (DESIGN.md)
      },
    ],
  };

  return <ReactECharts option={option} notMerge={false} style={{ height: '100%', width: '100%' }} />;
}
