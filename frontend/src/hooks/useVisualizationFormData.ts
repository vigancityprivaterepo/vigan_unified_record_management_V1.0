import { useEffect, useState } from 'react';
import { api, type Office, type OfficeModule } from '@/lib/api';

// Shared by CreateVisualizationPage and AllVisualizationsPage (its edit
// modal) -- both need the same offices/modules/barangays lookups to feed
// VisualizationForm, and neither should have to fetch it twice.
// office: an office staff board -- only that office and its programs (the
// admin office/module lists aren't available to office staff).
export function useVisualizationFormData(office?: { office: Office; modules: OfficeModule[] }) {
  const [offices, setOffices] = useState<Office[]>([]);
  const [modulesByOffice, setModulesByOffice] = useState<Record<string, OfficeModule[]>>({});
  const [barangays, setBarangays] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    api.barangays().then(setBarangays).catch(() => setBarangays([]));
    if (office) {
      setOffices([office.office]);
      setModulesByOffice({ [office.office.id]: office.modules });
      return;
    }
    api
      .listOffices()
      .then(async (offs) => {
        setOffices(offs);
        const entries = await Promise.all(
          offs.map(async (o) => [o.id, await api.listOfficeModules(o.id).catch(() => [])] as const),
        );
        setModulesByOffice(Object.fromEntries(entries));
      })
      .catch(() => {
        setOffices([]);
        setModulesByOffice({});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office?.office.id, office?.modules]);

  return { offices, modulesByOffice, barangays };
}
