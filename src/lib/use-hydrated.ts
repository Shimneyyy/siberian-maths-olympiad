"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
// Prevent a native submit before the client event handlers have attached.
export function useHydrated() { return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot); }
