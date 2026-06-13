import { createContext, useContext } from 'react';

// The wire/port type of an in-progress connection drag (or null). Lets ports
// highlight when they're a compatible target and dim when they're not.
export const ConnectContext = createContext(null);
export const useConnectType = () => useContext(ConnectContext);
