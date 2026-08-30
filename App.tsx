/**
 * Store Price List - Application Root
 * Wraps reactive state provider and renders main screen.
 */

import React from "react";
import { StoreProvider } from "./context/StoreContext";
import { MainScreen } from "./components/MainScreen";

export default function App() {
  return (
    <StoreProvider>
      <MainScreen />
    </StoreProvider>
  );
}
