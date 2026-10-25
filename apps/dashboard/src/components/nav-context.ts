"use client";

import { createContext, useContext } from "react";

/** Opens the sidebar drawer below `lg` (the top bar's button). */
export const NavContext = createContext<() => void>(() => {});
export const useOpenNav = () => useContext(NavContext);
