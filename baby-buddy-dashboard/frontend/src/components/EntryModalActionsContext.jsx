import { createContext, useContext } from "react";

const EntryModalActionsContext = createContext(null);

export function EntryModalActionsProvider({ value, children }) {
  return (
    <EntryModalActionsContext.Provider value={value}>
      {children}
    </EntryModalActionsContext.Provider>
  );
}

export function useEntryModalActions() {
  return useContext(EntryModalActionsContext);
}
