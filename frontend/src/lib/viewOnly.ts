import { createContext, useContext } from 'react';

// True for a 'viewer' account (the mayor, other city officials): the same
// city-wide pages as the administrator, but nothing can be changed and no
// list of people can be opened. The backend enforces it (middleware/auth.ts);
// this only keeps the screens from offering what would be refused.
export const ViewOnlyContext = createContext(false);
export const useViewOnly = () => useContext(ViewOnlyContext);
