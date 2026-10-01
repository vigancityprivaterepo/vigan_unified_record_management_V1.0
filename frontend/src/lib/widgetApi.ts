import { api, type DashboardWidget, type DashboardWidgetPayload, type OfficeFormField, type WidgetSeriesRow } from '@/lib/api';

// Where a chart board reads/writes: admin's city-wide routes, or one office's
// own routes (office staff story-telling their office's data). The board,
// cards, previews and form take one of these instead of calling api directly.
export type WidgetApi = {
  list: () => Promise<DashboardWidget[]>;
  create: (data: DashboardWidgetPayload) => Promise<unknown>;
  update: (id: string, data: DashboardWidgetPayload) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  setOnDashboard: (id: string, on: boolean) => Promise<unknown>;
  data: (id: string) => Promise<WidgetSeriesRow[]>;
  loadFields: (officeId: string, moduleId: string) => Promise<OfficeFormField[]>;
};

export const adminWidgetApi: WidgetApi = {
  list: api.listDashboardWidgets,
  create: api.createDashboardWidget,
  update: api.updateDashboardWidget,
  remove: api.deleteDashboardWidget,
  setOnDashboard: api.setWidgetOnDashboard,
  data: api.getDashboardWidgetData,
  loadFields: api.listOfficeModuleFields,
};

export function officeWidgetApi(officeId: string): WidgetApi {
  return {
    list: () => api.listOfficeWidgets(officeId),
    create: (data) => api.createOfficeWidget(officeId, data),
    update: (id, data) => api.updateOfficeWidget(officeId, id, data),
    remove: (id) => api.deleteOfficeWidget(officeId, id),
    setOnDashboard: (id, on) => api.setOfficeWidgetOnDashboard(officeId, id, on),
    data: (id) => api.getOfficeWidgetData(officeId, id),
    loadFields: (_officeId, moduleId) => api.getOfficeModuleFields(officeId, moduleId),
  };
}
